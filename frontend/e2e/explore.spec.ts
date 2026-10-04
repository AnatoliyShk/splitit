import { expect, test } from '@playwright/test'
import { makeOccasion, mockApi, USER, type TestOccasion } from './fixtures/user'

const occasions: TestOccasion[] = [
  makeOccasion(11, 'Rooftop Yoga', 1, { attendees_count: 0, tags: ['wellness'] }),
  makeOccasion(12, 'Board Game Night', 3, { attendees_count: 1, tags: ['games', 'social'] }),
  makeOccasion(13, 'Hike Day', 6, { attendees_count: 8 }),
]

const join = (id: number) => `POST /api/occasions/${id}/join/`

test('redirects to the login page when logged out', async ({ page }) => {
  await mockApi(page, { user: null })
  await page.goto('/explore')
  await expect(page).toHaveURL(/\/login$/)
})

test.describe('browsing', () => {
  test('shows the first occasion with its tags and a position counter', async ({ page }) => {
    await mockApi(page, { user: USER, explore: occasions })
    await page.goto('/explore')

    await expect(page.getByRole('heading', { level: 1, name: 'Explore' })).toBeVisible()
    await expect(page.getByText('1 of 3')).toBeVisible()
    const card = page.getByRole('article', { name: 'Rooftop Yoga' })
    await expect(card).toBeVisible()
    await expect(card.getByText('wellness', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Decline' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Accept' })).toBeEnabled()
  })

  test('words the attendee count for none, one and many', async ({ page }) => {
    await mockApi(page, { user: USER, explore: occasions })
    await page.goto('/explore')

    await expect(page.getByText('Nobody is going yet. Be the first!')).toBeVisible()
    await page.getByRole('button', { name: 'Decline' }).click()
    await expect(page.getByText('1 person is going')).toBeVisible()
    await page.getByRole('button', { name: 'Decline' }).click()
    await expect(page.getByText('8 people are going')).toBeVisible()
  })

  test('shows a card without tags for an untagged occasion', async ({ page }) => {
    await mockApi(page, { user: USER, explore: [makeOccasion(13, 'Hike Day', 6, { attendees_count: 8 })] })
    await page.goto('/explore')
    const card = page.getByRole('article', { name: 'Hike Day' })
    await expect(card).toBeVisible()
    await expect(card.locator('.tag')).toHaveCount(0)
  })

  test('shows an alert when the occasions cannot be loaded', async ({ page }) => {
    await mockApi(page, { user: USER, explore: 500 })
    await page.goto('/explore')
    await expect(page.getByRole('alert')).toHaveText('Mocked failure.')
    await expect(page.getByText('Loading…')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0)
  })
})

test.describe('decline', () => {
  test('skips to the next occasion without calling the API', async ({ page }) => {
    const mock = await mockApi(page, { user: USER, explore: occasions })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Decline' }).click()

    await expect(page.getByRole('article', { name: 'Board Game Night' })).toBeVisible()
    await expect(page.getByText('2 of 3')).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Skipped Rooftop Yoga')
    expect(mock.requests.filter((r) => r.startsWith('POST'))).toEqual([])
  })
})

test.describe('accept', () => {
  test('joins the occasion and moves on to the next one', async ({ page }) => {
    const mock = await mockApi(page, {
      user: USER,
      explore: occasions,
      handlers: { [join(11)]: (route) => route.fulfill({ status: 204 }) },
    })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Accept' }).click()

    await expect(page.getByRole('article', { name: 'Board Game Night' })).toBeVisible()
    await expect(page.getByText('2 of 3')).toBeVisible()
    await expect(page.getByRole('status')).toHaveText("You're going to Rooftop Yoga")
    expect(mock.requests).toContain(join(11))
  })

  test('disables both buttons and shows Joining while the request is pending', async ({ page }) => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    await mockApi(page, {
      user: USER,
      explore: occasions,
      handlers: {
        [join(11)]: async (route) => {
          await gate
          await route.fulfill({ status: 204 })
        },
      },
    })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Accept' }).click()

    await expect(page.getByRole('button', { name: 'Joining…' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Decline' })).toBeDisabled()
    release()
    await expect(page.getByRole('article', { name: 'Board Game Night' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Accept' })).toBeEnabled()
  })

  test('stays on the same occasion and shows an alert when joining fails', async ({ page }) => {
    const mock = await mockApi(page, {
      user: USER,
      explore: occasions,
      handlers: {
        [join(11)]: (route) =>
          route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ detail: 'No Occasion matches the given query.' }),
          }),
      },
    })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Accept' }).click()

    await expect(page.getByRole('alert')).toHaveText('No Occasion matches the given query.')
    await expect(page.getByRole('article', { name: 'Rooftop Yoga' })).toBeVisible()
    await expect(page.getByText('1 of 3')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Accept' })).toBeEnabled()
    expect(mock.requests).toContain(join(11))
  })

  test('clears the alert after declining the occasion that failed', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      explore: occasions,
      handlers: {
        [join(11)]: (route) =>
          route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Gone.' }) }),
      },
    })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Accept' }).click()
    await expect(page.getByRole('alert')).toHaveText('Gone.')

    await page.getByRole('button', { name: 'Decline' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('article', { name: 'Board Game Night' })).toBeVisible()
  })

  test('tells the user when the server cannot be reached', async ({ page }) => {
    await mockApi(page, { user: USER, explore: occasions, handlers: { [join(11)]: (route) => route.abort() } })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Accept' }).click()
    await expect(page.getByRole('alert')).toHaveText("Can't reach the server. Check your connection and try again.")
    await expect(page.getByRole('article', { name: 'Rooftop Yoga' })).toBeVisible()
  })
})

test.describe('end of the list', () => {
  test('shows "all caught up" after going through every occasion', async ({ page }) => {
    const mock = await mockApi(page, {
      user: USER,
      explore: occasions,
      handlers: { [join(12)]: (route) => route.fulfill({ status: 204 }) },
    })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Decline' }).click()
    await page.getByRole('button', { name: 'Accept' }).click()
    await page.getByRole('button', { name: 'Decline' }).click()

    await expect(page.getByRole('heading', { name: "You're all caught up" })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Decline' })).toHaveCount(0)
    await expect(page.getByText(/\d of 3/)).toHaveCount(0)
    // Only the accepted occasion was joined
    expect(mock.requests.filter((r) => r.startsWith('POST'))).toEqual([join(12)])
  })

  test('shows the empty state when there are no new occasions', async ({ page }) => {
    await mockApi(page, { user: USER, explore: [] })
    await page.goto('/explore')
    await expect(page.getByRole('heading', { name: 'No new occasions right now' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0)
  })

  test('links on to the profile from the done state', async ({ page }) => {
    await mockApi(page, { user: USER, explore: [], occasions: [], connections: [] })
    await page.goto('/explore')
    await page.getByRole('link', { name: 'Your occasions' }).click()
    await expect(page).toHaveURL(/\/profile$/)
  })
})
