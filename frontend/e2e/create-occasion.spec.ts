import { expect, test } from '@playwright/test'
import { makeOccasion, mockApi, USER } from './fixtures/user'

const tags = [
  { id: 1, name: 'games' },
  { id: 2, name: 'outdoors' },
]
const createUrl = 'POST /api/occasions/'

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

test('redirects to the login page when logged out', async ({ page }) => {
  await mockApi(page, { user: null })
  await page.goto('/occasions/new')
  await expect(page).toHaveURL(/\/login$/)
})

test('shows the form, saying who will see the occasion', async ({ page }) => {
  await mockApi(page, { user: USER, tags })
  await page.goto('/occasions/new')
  await expect(page).toHaveTitle('Create occasion · Splitit')
  await expect(page.getByRole('heading', { level: 1, name: 'Create occasion' })).toBeVisible()
  await expect(page.getByText(/Only you and the people you're connected with will see it/)).toBeVisible()
  await expect(page.getByLabel('Name')).toBeVisible()
  await expect(page.getByLabel('Starts')).toHaveAttribute('type', 'datetime-local')
  await expect(page.getByRole('group', { name: 'Tags' }).getByRole('checkbox')).toHaveCount(2)
  // Name and start are required
  const create = page.getByRole('button', { name: 'Create occasion' })
  await expect(create).toBeDisabled()
  await page.getByLabel('Name').fill('Board games')
  await expect(create).toBeDisabled()
  await page.getByLabel('Starts').fill('2030-05-01T18:30')
  await expect(create).toBeEnabled()
})

test('creates the occasion and opens its page', async ({ page }) => {
  const createdOccasion = {
    ...makeOccasion(31, 'Board games', 30, { tags: ['games'], created_by: { uuid: USER.uuid, name: USER.name } }),
    gallery: [],
    is_going: true,
  }
  const mock = await mockApi(page, {
    user: USER,
    tags,
    handlers: {
      [createUrl]: (route) => route.fulfill(json(createdOccasion, 201)),
      'GET /api/occasions/31/': (route) => route.fulfill(json(createdOccasion)),
    },
  })
  await page.goto('/occasions/new')
  await page.getByLabel('Name').fill('Board games')
  await page.getByLabel('Description (optional)').fill('Bring a game you love.')
  await page.getByLabel('Starts').fill('2030-05-01T18:30')
  await page.getByRole('checkbox', { name: 'games' }).check()
  await page.getByRole('button', { name: 'Create occasion' }).click()

  await expect(page).toHaveURL(/\/occasions\/31$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Board games' })).toBeVisible()
  const requestBody = mock.bodies[createUrl] as Record<string, unknown>
  expect(requestBody).toMatchObject({
    name: 'Board games',
    description: 'Bring a game you love.',
    end_datetime: null,
    tag_ids: [1],
  })
  // Sent as an absolute UTC time
  expect(new Date(requestBody.start_datetime as string).getTime()).toBe(new Date('2030-05-01T18:30').getTime())
})

test('shows field errors and focuses the first one', async ({ page }) => {
  await mockApi(page, {
    user: USER,
    tags,
    handlers: {
      [createUrl]: (route) => route.fulfill(json({ start_datetime: ['The start must be in the future.'] }, 400)),
    },
  })
  await page.goto('/occasions/new')
  await page.getByLabel('Name').fill('Board games')
  await page.getByLabel('Starts').fill('2030-05-01T18:30')
  await page.getByRole('button', { name: 'Create occasion' }).click()
  await expect(page.getByText('The start must be in the future.')).toBeVisible()
  await expect(page.getByLabel('Starts')).toBeFocused()
  await expect(page).toHaveURL(/\/occasions\/new$/)
})

test('explains when the user is already going somewhere', async ({ page }) => {
  const detail = "You're already going to Pottery Class. You can create an occasion once it ends or is cancelled."
  await mockApi(page, {
    user: USER,
    tags,
    handlers: { [createUrl]: (route) => route.fulfill(json({ detail }, 409)) },
  })
  await page.goto('/occasions/new')
  await page.getByLabel('Name').fill('Board games')
  await page.getByLabel('Starts').fill('2030-05-01T18:30')
  await page.getByRole('button', { name: 'Create occasion' }).click()
  await expect(page.getByRole('alert')).toHaveText(detail)
})

test('is linked from the profile', async ({ page }) => {
  await mockApi(page, { user: USER, occasions: [], connections: [] })
  await page.goto('/profile')
  await page.getByRole('region', { name: 'Your occasions' }).getByRole('link', { name: 'Create occasion' }).click()
  await expect(page).toHaveURL(/\/occasions\/new$/)
})

test.describe('creator on Explore cards', () => {
  test("names a regular user's occasion's creator", async ({ page }) => {
    const deck = [makeOccasion(11, 'Picnic', 1, { created_by: { uuid: '0190a1b2-0000-7000-8000-000000000009', name: 'Ann' } })]
    await mockApi(page, { user: USER, explore: deck })
    await page.goto('/explore')
    await expect(page.getByRole('article', { name: 'Picnic' }).getByText('Created by Ann')).toBeVisible()
  })

  test('shows no creator on an admin-made occasion', async ({ page }) => {
    await mockApi(page, { user: USER, explore: [makeOccasion(11, 'Gala', 1)] })
    await page.goto('/explore')
    await expect(page.getByRole('article', { name: 'Gala' })).toBeVisible()
    await expect(page.getByText(/Created by/)).toHaveCount(0)
  })

  test('offers to create one when the deck is empty', async ({ page }) => {
    await mockApi(page, { user: USER, explore: [] })
    await page.goto('/explore')
    await page.getByRole('link', { name: 'Create occasion' }).click()
    await expect(page).toHaveURL(/\/occasions\/new$/)
  })
})
