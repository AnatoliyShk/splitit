import { expect, test, type Page } from '@playwright/test'
import { mockMedia } from './fixtures/panel'
import { makeOccasion, mockApi, USER } from './fixtures/user'

const detail = {
  ...makeOccasion(21, 'Pottery Class', 4, { attendees_count: 3, tags: ['crafts'] }),
  main_image: '/media/occasions/21/main.png',
  gallery: ['/media/occasions/21/one.png', '/media/occasions/21/two.png'],
  is_going: false,
}

const detailUrl = 'GET /api/occasions/21/'

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

async function open(page: Page, body: unknown, status = 200) {
  await mockMedia(page)
  const mock = await mockApi(page, {
    user: USER,
    handlers: { [detailUrl]: (route) => route.fulfill(json(body, status)) },
  })
  await page.goto('/occasions/21')
  return mock
}

test('redirects to the login page when logged out', async ({ page }) => {
  await mockApi(page, { user: null })
  await page.goto('/occasions/21')
  await expect(page).toHaveURL(/\/login$/)
})

test('shows the occasion with its main image and details', async ({ page }) => {
  await open(page, detail)

  const article = page.getByRole('article', { name: 'Pottery Class' })
  await expect(page.getByRole('heading', { level: 1, name: 'Pottery Class' })).toBeVisible()
  await expect(article.locator('img.occasion-hero')).toHaveAttribute('src', '/media/occasions/21/main.png')
  await expect(article.getByText('crafts', { exact: true })).toBeVisible()
  await expect(article).toContainText('3 people are going')
  await expect(article.getByText("You're going", { exact: true })).toHaveCount(0)
  await expect(page).toHaveTitle('Pottery Class · Splitit')
})

test('shows the gallery in order, each photo opening full size', async ({ page }) => {
  await open(page, detail)

  const gallery = page.getByRole('region', { name: 'Gallery' })
  const photos = gallery.getByRole('img')
  await expect(photos).toHaveCount(2)
  await expect(photos.nth(0)).toHaveAccessibleName('Pottery Class, photo 1 of 2')
  await expect(photos.nth(1)).toHaveAttribute('src', '/media/occasions/21/two.png')
  const link = gallery.getByRole('link', { name: 'Pottery Class, photo 1 of 2' })
  await expect(link).toHaveAttribute('href', '/media/occasions/21/one.png')
  await expect(link).toHaveAttribute('target', '_blank')
})

test('leaves out the image and gallery when there are none', async ({ page }) => {
  await open(page, { ...detail, main_image: null, gallery: [] })
  await expect(page.getByRole('heading', { level: 1, name: 'Pottery Class' })).toBeVisible()
  await expect(page.getByRole('img')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Gallery' })).toHaveCount(0)
})

test('says when the user is going and when it was cancelled', async ({ page }) => {
  await open(page, { ...detail, is_going: true, cancelled_at: '2026-01-01T00:00:00Z' })
  const article = page.getByRole('article', { name: 'Pottery Class' })
  await expect(article.getByText("You're going", { exact: true })).toBeVisible()
  await expect(article.getByText('Cancelled', { exact: true })).toBeVisible()
})

test('words a lone attendee and an empty occasion', async ({ page }) => {
  await open(page, { ...detail, attendees_count: 1 })
  await expect(page.getByText('1 person is going')).toBeVisible()
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await open(page, { ...detail, attendees_count: 0 })
  await expect(page.getByText('Nobody is going yet')).toBeVisible()
})

test('an unknown occasion shows a not-found message', async ({ page }) => {
  await open(page, { detail: 'No Occasion matches the given query.' }, 404)
  await expect(page.getByRole('alert')).toHaveText("This occasion doesn't exist or was deleted.")
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0)
})

test('opened directly, the back link goes to Explore', async ({ page }) => {
  await open(page, detail)
  await expect(page.getByRole('link', { name: '← Explore' })).toHaveAttribute('href', '/explore')
})

test('clicking an Explore card opens the occasion, and Back returns', async ({ page }) => {
  await mockMedia(page)
  await mockApi(page, {
    user: USER,
    explore: [makeOccasion(21, 'Pottery Class', 4, { main_image: '/media/occasions/21/main.png' })],
    handlers: { [detailUrl]: (route) => route.fulfill(json(detail)) },
  })
  await page.goto('/explore')
  const card = page.getByRole('article', { name: 'Pottery Class' })
  await expect(card.locator('img.explore-image')).toHaveAttribute('src', '/media/occasions/21/main.png')

  // The title link's overlay covers the card, so a click near the top (on the image) opens it too
  await card.click({ position: { x: 60, y: 60 } })
  await expect(page).toHaveURL(/\/occasions\/21$/)
  await expect(page.getByRole('region', { name: 'Gallery' })).toBeVisible()

  await page.getByRole('button', { name: '← Back' }).click()
  await expect(page).toHaveURL(/\/explore$/)
})

test('a profile row links to the occasion and shows its main image', async ({ page }) => {
  await mockMedia(page)
  await mockApi(page, {
    user: USER,
    connections: [],
    occasions: [
      makeOccasion(21, 'Pottery Class', 4, { main_image: '/media/occasions/21/main.png' }),
      makeOccasion(22, 'Hike Day', 6),
    ],
    handlers: { [detailUrl]: (route) => route.fulfill(json(detail)) },
  })
  await page.goto('/profile')

  const rows = page.getByRole('region', { name: 'Your occasions' }).getByRole('link')
  await expect(rows.nth(0).locator('img.occasion-thumb')).toHaveAttribute('src', '/media/occasions/21/main.png')
  // Without an image the row keeps its date badge
  await expect(rows.nth(1).locator('img')).toHaveCount(0)
  await expect(rows.nth(1).locator('.occasion-date')).toBeVisible()

  await rows.nth(0).click()
  await expect(page).toHaveURL(/\/occasions\/21$/)
})
