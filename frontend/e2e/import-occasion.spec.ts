import { expect, test, type Page } from '@playwright/test'
import { makeOccasion, mockApi, USER } from './fixtures/user'

const importUrl = 'POST /api/occasions/import/'
const eventLink = 'https://example.com/events/jazz-night'

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

const importForm = (page: Page) => page.getByRole('region', { name: 'Add an occasion from a link' })

test('shows the form on the profile', async ({ page }) => {
  await mockApi(page, { user: USER, occasions: [], connections: [] })
  await page.goto('/profile')
  const form = importForm(page)
  await expect(form).toContainText('Only you and your connections will see it')
  await expect(form.getByLabel('Event link')).toHaveAttribute('type', 'url')
  const add = form.getByRole('button', { name: 'Add occasion' })
  await expect(add).toBeDisabled()
  await form.getByLabel('Event link').fill(eventLink)
  await expect(add).toBeEnabled()
})

test('adds the occasion from the link and opens its page', async ({ page }) => {
  const importedOccasion = {
    ...makeOccasion(41, 'Jazz night', 10, {
      tags: ['Jazz', 'Live music'],
      description: 'A trio on the rooftop.',
      created_by: { uuid: USER.uuid, name: USER.name },
    }),
    gallery: [],
    is_going: true,
  }
  // Held until released, so the "reading" state can be checked
  let releaseImport: () => void = () => {}
  const importReleased = new Promise<void>((resolvePromise) => (releaseImport = resolvePromise))
  const mock = await mockApi(page, {
    user: USER,
    occasions: [],
    connections: [],
    handlers: {
      [importUrl]: async (route) => {
        await importReleased
        await route.fulfill(json(importedOccasion, 201))
      },
      'GET /api/occasions/41/': (route) => route.fulfill(json(importedOccasion)),
    },
  })
  await page.goto('/profile')
  await importForm(page).getByLabel('Event link').fill(`  ${eventLink}  `)
  await importForm(page).getByRole('button', { name: 'Add occasion' }).click()

  await expect(importForm(page).getByText('Reading the page…')).toBeVisible()
  await expect(importForm(page).getByRole('button', { name: 'Adding…' })).toBeDisabled()
  releaseImport()

  await expect(page).toHaveURL(/\/occasions\/41$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Jazz night' })).toBeVisible()
  expect(mock.bodies[importUrl]).toEqual({ url: eventLink })
})

test('shows a problem with the link under the field and focuses it', async ({ page }) => {
  await mockApi(page, {
    user: USER,
    occasions: [],
    connections: [],
    handlers: {
      [importUrl]: (route) =>
        route.fulfill(json({ url: ["Couldn't find an event with a title and a start time on that page."] }, 400)),
    },
  })
  await page.goto('/profile')
  const linkField = importForm(page).getByLabel('Event link')
  await linkField.fill(eventLink)
  await importForm(page).getByRole('button', { name: 'Add occasion' }).click()
  await expect(importForm(page).getByText("Couldn't find an event with a title and a start time")).toBeVisible()
  await expect(linkField).toBeFocused()
  await expect(page).toHaveURL(/\/profile$/)

  // Editing the link clears the message
  await linkField.fill(`${eventLink}?ref=1`)
  await expect(importForm(page).getByText("Couldn't find an event")).toHaveCount(0)
})

test('explains when the user is already going somewhere or the page can not be read', async ({ page }) => {
  const responses = [
    json({ detail: "You're already going to Pottery Class. You can add an occasion once it ends or is cancelled." }, 409),
    json({ detail: "Couldn't read that page right now. Try again in a moment." }, 502),
  ]
  await mockApi(page, {
    user: USER,
    occasions: [],
    connections: [],
    handlers: { [importUrl]: (route) => route.fulfill(responses.shift()!) },
  })
  await page.goto('/profile')
  await importForm(page).getByLabel('Event link').fill(eventLink)
  const add = importForm(page).getByRole('button', { name: 'Add occasion' })

  await add.click()
  await expect(importForm(page).getByRole('alert')).toHaveText(/You're already going to Pottery Class/)
  await add.click()
  await expect(importForm(page).getByRole('alert')).toHaveText("Couldn't read that page right now. Try again in a moment.")
})
