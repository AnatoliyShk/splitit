import { expect, test } from '@playwright/test'
import type { Network } from '../src/types/connections'
import { ADMIN, makeOccasion, mockApi, USER, type TestConnection } from './fixtures/user'

const connections: TestConnection[] = [
  { uuid: '0190a1b2-0000-7000-8000-000000000001', name: 'Grace Hopper', strength: 2.5, shared_occasions: 3 },
  { uuid: '0190a1b2-0000-7000-8000-000000000002', name: 'Alan Turing', strength: 0.5, shared_occasions: 1 },
]

const graph: Network = {
  nodes: [
    { uuid: USER.uuid, name: USER.name, degree: 0 },
    { uuid: connections[0].uuid, name: 'Grace Hopper', degree: 1 },
    { uuid: connections[1].uuid, name: 'Alan Turing', degree: 1 },
  ],
  edges: [
    { source: USER.uuid, target: connections[0].uuid, strength: 2.5 },
    { source: USER.uuid, target: connections[1].uuid, strength: 0.5 },
  ],
}

test.describe('logged out', () => {
  test('redirects to the login page', async ({ page }) => {
    await mockApi(page, { user: null })
    await page.goto('/profile')
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('hero', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { user: USER, occasions: [], connections: [] })
  })

  test('shows name, email and member-since date', async ({ page }) => {
    await page.goto('/profile')
    await expect(page.getByRole('heading', { level: 1, name: 'Ada Lovelace' })).toBeVisible()
    await expect(page.getByText('ada@example.com')).toBeVisible()
    await expect(page.getByText('Member since Mar 15, 2025')).toBeVisible()
  })

  test('hides the Admin tag for regular users', async ({ page }) => {
    await page.goto('/profile')
    await expect(page.getByRole('heading', { level: 1, name: 'Ada Lovelace' })).toBeVisible()
    await expect(page.getByRole('main').getByText('Admin', { exact: true })).toHaveCount(0)
  })

  test('links to the settings page', async ({ page }) => {
    await page.goto('/profile')
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/\/profile\/settings$/)
  })
})

test('shows the Admin tag for staff users', async ({ page }) => {
  await mockApi(page, { user: ADMIN, occasions: [], connections: [] })
  await page.goto('/profile')
  await expect(page.getByRole('main').getByText('Admin', { exact: true })).toBeVisible()
})

test.describe('your occasions', () => {
  test('splits occasions into upcoming and past, most recent past first', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      connections: [],
      // The API sends soonest first
      occasions: [
        makeOccasion(1, 'Old Meetup', -30),
        makeOccasion(2, 'Last Week Picnic', -7),
        makeOccasion(3, 'Board Game Night', 2, { attendees_count: 4, tags: ['games', 'social'] }),
        makeOccasion(4, 'Hike Day', 9, { attendees_count: 1 }),
      ],
    })
    await page.goto('/profile')

    const occasions = page.getByRole('region', { name: 'Your occasions' })
    const upcoming = occasions.locator('.profile-occasions', { has: page.getByRole('heading', { name: 'Upcoming' }) })
    const past = occasions.locator('.profile-occasions', { has: page.getByRole('heading', { name: 'Past' }) })

    await expect(upcoming.getByRole('link')).toHaveCount(2)
    await expect(upcoming.getByRole('link').nth(0)).toContainText('Board Game Night')
    await expect(upcoming.getByRole('link').nth(1)).toContainText('Hike Day')

    await expect(past.getByRole('link')).toHaveCount(2)
    await expect(past.getByRole('link').nth(0)).toContainText('Last Week Picnic')
    await expect(past.getByRole('link').nth(1)).toContainText('Old Meetup')
    await expect(occasions.getByText("You're not going to any occasions yet.")).toHaveCount(0)
  })

  test('shows attendee counts and tags on each occasion', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      connections: [],
      occasions: [makeOccasion(3, 'Board Game Night', 2, { attendees_count: 4, tags: ['games', 'social'] })],
    })
    await page.goto('/profile')
    // Each occasion row is one link (its tags are a nested list)
    const row = page.getByRole('region', { name: 'Your occasions' }).getByRole('link')
    await expect(row).toContainText('Board Game Night')
    await expect(row).toContainText('4 going')
    await expect(row.getByText('games', { exact: true })).toBeVisible()
    await expect(row.getByText('social', { exact: true })).toBeVisible()
  })

  test('marks cancelled occasions', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      connections: [],
      occasions: [
        makeOccasion(3, 'Board Game Night', 2),
        makeOccasion(4, 'Hike Day', 9, { cancelled_at: new Date().toISOString(), tags: ['outdoors'] }),
      ],
    })
    await page.goto('/profile')
    const rows = page.getByRole('region', { name: 'Your occasions' }).getByRole('link')
    await expect(rows.nth(0).getByText('Cancelled', { exact: true })).toHaveCount(0)
    await expect(rows.nth(1).getByText('Cancelled', { exact: true })).toBeVisible()
    await expect(rows.nth(1).getByText('outdoors', { exact: true })).toBeVisible()
  })

  test('omits the Past heading when every occasion is upcoming', async ({ page }) => {
    await mockApi(page, { user: USER, connections: [], occasions: [makeOccasion(4, 'Hike Day', 9)] })
    await page.goto('/profile')
    const occasions = page.getByRole('region', { name: 'Your occasions' })
    await expect(occasions.getByRole('heading', { name: 'Upcoming' })).toBeVisible()
    await expect(occasions.getByRole('heading', { name: 'Past' })).toHaveCount(0)
  })

  test('treats an occasion without an end as past once it started', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      connections: [],
      occasions: [makeOccasion(5, 'No End Yesterday', -1, { end_datetime: null })],
    })
    await page.goto('/profile')
    const occasions = page.getByRole('region', { name: 'Your occasions' })
    await expect(occasions.getByRole('heading', { name: 'Past' })).toBeVisible()
    await expect(occasions.getByRole('heading', { name: 'Upcoming' })).toHaveCount(0)
  })

  test('shows an empty state with a link to find occasions', async ({ page }) => {
    await mockApi(page, { user: USER, connections: [], occasions: [] })
    await page.goto('/profile')
    const occasions = page.getByRole('region', { name: 'Your occasions' })
    await expect(occasions.getByText("You're not going to any occasions yet.")).toBeVisible()
    await expect(occasions.getByRole('link', { name: 'Find occasions' })).toHaveAttribute('href', '/')
    await expect(occasions.getByRole('heading', { name: 'Upcoming' })).toHaveCount(0)
    await expect(occasions.getByRole('heading', { name: 'Past' })).toHaveCount(0)
  })

  test('shows an alert when the occasions request fails', async ({ page }) => {
    await mockApi(page, { user: USER, connections: [], occasions: 500 })
    await page.goto('/profile')
    const occasions = page.getByRole('region', { name: 'Your occasions' })
    await expect(occasions.getByRole('alert')).toHaveText('Mocked failure.')
    await expect(occasions.getByText('Loading…')).toHaveCount(0)
  })
})

test.describe('your connections', () => {
  test('lists connections in the order the API returns them, strongest first', async ({ page }) => {
    await mockApi(page, { user: USER, occasions: [], connections, graph })
    await page.goto('/profile')
    const rows = page.getByRole('region', { name: 'Your connections' }).getByRole('listitem')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('Grace Hopper')
    await expect(rows.nth(0)).toContainText('Strength 2.50')
    await expect(rows.nth(1)).toContainText('Alan Turing')
    await expect(rows.nth(1)).toContainText('Strength 0.50')
  })

  test('pluralizes the shared occasions count', async ({ page }) => {
    await mockApi(page, { user: USER, occasions: [], connections, graph })
    await page.goto('/profile')
    const rows = page.getByRole('region', { name: 'Your connections' }).getByRole('listitem')
    await expect(rows.nth(0)).toContainText('3 shared occasions')
    await expect(rows.nth(1)).toContainText('1 shared occasion')
    await expect(rows.nth(1)).not.toContainText('1 shared occasions')
  })

  test('draws the connections graph with its caption', async ({ page }) => {
    await mockApi(page, { user: USER, occasions: [], connections, graph })
    await page.goto('/profile')
    const section = page.getByRole('region', { name: 'Your connections' })
    await expect(section.getByRole('img', { name: 'Graph of your connections and the people they know' })).toBeVisible()
    await expect(section.getByText("You're the yellow dot and your connections are lilac")).toBeVisible()
  })

  test('still lists connections when the graph request fails', async ({ page }) => {
    await mockApi(page, { user: USER, occasions: [], connections, graph: 500 })
    await page.goto('/profile')
    const section = page.getByRole('region', { name: 'Your connections' })
    await expect(section.getByRole('listitem')).toHaveCount(2)
    await expect(section.getByRole('img')).toHaveCount(0)
  })

  test('shows an empty state and no graph without connections', async ({ page }) => {
    const mock = await mockApi(page, { user: USER, occasions: [], connections: [], graph })
    await page.goto('/profile')
    const section = page.getByRole('region', { name: 'Your connections' })
    await expect(section.getByText('Go to an occasion to start connecting with people.')).toBeVisible()
    await expect(section.getByRole('link', { name: 'Find occasions' })).toHaveAttribute('href', '/')
    await expect(section.getByRole('img')).toHaveCount(0)
    expect(mock.requests).not.toContain(`GET /api/users/${USER.uuid}/connections/graph/`)
  })

  test('shows an alert when the connections request fails', async ({ page }) => {
    await mockApi(page, { user: USER, occasions: [], connections: 500 })
    await page.goto('/profile')
    const section = page.getByRole('region', { name: 'Your connections' })
    await expect(section.getByRole('alert')).toHaveText('Mocked failure.')
    await expect(section.getByText('Loading…')).toHaveCount(0)
  })
})

test('requests data for the logged-in user only', async ({ page }) => {
  const mock = await mockApi(page, { user: USER, occasions: [], connections: [] })
  await page.goto('/profile')
  await expect(page.getByText("You're not going to any occasions yet.")).toBeVisible()
  expect(mock.requests).toContain(`GET /api/users/${USER.uuid}/occasions/`)
  expect(mock.requests).toContain(`GET /api/users/${USER.uuid}/connections/`)
})
