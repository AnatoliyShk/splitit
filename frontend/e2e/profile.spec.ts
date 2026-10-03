import { expect, test } from '@playwright/test'
import { ADMIN, makeEvent, mockApi, USER, type TestConnection } from './fixtures/user'

const connections: TestConnection[] = [
  { uuid: '0190a1b2-0000-7000-8000-000000000001', name: 'Grace Hopper', strength: 2.5, shared_events: 3 },
  { uuid: '0190a1b2-0000-7000-8000-000000000002', name: 'Alan Turing', strength: 0.5, shared_events: 1 },
]

const graph = {
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
    await mockApi(page, { user: USER, events: [], connections: [] })
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
  await mockApi(page, { user: ADMIN, events: [], connections: [] })
  await page.goto('/profile')
  await expect(page.getByRole('main').getByText('Admin', { exact: true })).toBeVisible()
})

test.describe('your events', () => {
  test('splits events into upcoming and past, most recent past first', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      connections: [],
      // The API sends soonest first
      events: [
        makeEvent(1, 'Old Meetup', -30),
        makeEvent(2, 'Last Week Picnic', -7),
        makeEvent(3, 'Board Game Night', 2, { attendees_count: 4, tags: ['games', 'social'] }),
        makeEvent(4, 'Hike Day', 9, { attendees_count: 1 }),
      ],
    })
    await page.goto('/profile')

    const events = page.getByRole('region', { name: 'Your events' })
    const upcoming = events.locator('.profile-events', { has: page.getByRole('heading', { name: 'Upcoming' }) })
    const past = events.locator('.profile-events', { has: page.getByRole('heading', { name: 'Past' }) })

    await expect(upcoming.getByRole('listitem')).toHaveCount(2)
    await expect(upcoming.getByRole('listitem').nth(0)).toContainText('Board Game Night')
    await expect(upcoming.getByRole('listitem').nth(1)).toContainText('Hike Day')

    await expect(past.getByRole('listitem')).toHaveCount(2)
    await expect(past.getByRole('listitem').nth(0)).toContainText('Last Week Picnic')
    await expect(past.getByRole('listitem').nth(1)).toContainText('Old Meetup')
    await expect(events.getByText("You're not going to any events yet.")).toHaveCount(0)
  })

  test('shows attendee counts and tags on each event', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      connections: [],
      events: [makeEvent(3, 'Board Game Night', 2, { attendees_count: 4, tags: ['games', 'social'] })],
    })
    await page.goto('/profile')
    const row = page.getByRole('region', { name: 'Your events' }).getByRole('listitem')
    await expect(row).toContainText('Board Game Night')
    await expect(row).toContainText('4 going')
    await expect(row.getByText('games', { exact: true })).toBeVisible()
    await expect(row.getByText('social', { exact: true })).toBeVisible()
  })

  test('omits the Past heading when every event is upcoming', async ({ page }) => {
    await mockApi(page, { user: USER, connections: [], events: [makeEvent(4, 'Hike Day', 9)] })
    await page.goto('/profile')
    const events = page.getByRole('region', { name: 'Your events' })
    await expect(events.getByRole('heading', { name: 'Upcoming' })).toBeVisible()
    await expect(events.getByRole('heading', { name: 'Past' })).toHaveCount(0)
  })

  test('treats an event without an end as past once it started', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      connections: [],
      events: [makeEvent(5, 'No End Yesterday', -1, { end_datetime: null })],
    })
    await page.goto('/profile')
    const events = page.getByRole('region', { name: 'Your events' })
    await expect(events.getByRole('heading', { name: 'Past' })).toBeVisible()
    await expect(events.getByRole('heading', { name: 'Upcoming' })).toHaveCount(0)
  })

  test('shows an empty state with a link to find events', async ({ page }) => {
    await mockApi(page, { user: USER, connections: [], events: [] })
    await page.goto('/profile')
    const events = page.getByRole('region', { name: 'Your events' })
    await expect(events.getByText("You're not going to any events yet.")).toBeVisible()
    await expect(events.getByRole('link', { name: 'Find events' })).toHaveAttribute('href', '/')
    await expect(events.getByRole('heading', { name: 'Upcoming' })).toHaveCount(0)
    await expect(events.getByRole('heading', { name: 'Past' })).toHaveCount(0)
  })

  test('shows an alert when the events request fails', async ({ page }) => {
    await mockApi(page, { user: USER, connections: [], events: 500 })
    await page.goto('/profile')
    const events = page.getByRole('region', { name: 'Your events' })
    await expect(events.getByRole('alert')).toHaveText('Mocked failure.')
    await expect(events.getByText('Loading…')).toHaveCount(0)
  })
})

test.describe('your connections', () => {
  test('lists connections in the order the API returns them, strongest first', async ({ page }) => {
    await mockApi(page, { user: USER, events: [], connections, graph })
    await page.goto('/profile')
    const rows = page.getByRole('region', { name: 'Your connections' }).getByRole('listitem')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('Grace Hopper')
    await expect(rows.nth(0)).toContainText('Strength 2.50')
    await expect(rows.nth(1)).toContainText('Alan Turing')
    await expect(rows.nth(1)).toContainText('Strength 0.50')
  })

  test('pluralizes the shared events count', async ({ page }) => {
    await mockApi(page, { user: USER, events: [], connections, graph })
    await page.goto('/profile')
    const rows = page.getByRole('region', { name: 'Your connections' }).getByRole('listitem')
    await expect(rows.nth(0)).toContainText('3 shared events')
    await expect(rows.nth(1)).toContainText('1 shared event')
    await expect(rows.nth(1)).not.toContainText('1 shared events')
  })

  test('draws the connections graph with its caption', async ({ page }) => {
    await mockApi(page, { user: USER, events: [], connections, graph })
    await page.goto('/profile')
    const section = page.getByRole('region', { name: 'Your connections' })
    await expect(section.getByRole('img', { name: 'Graph of your connections and the people they know' })).toBeVisible()
    await expect(section.getByText("You're the yellow dot and your connections are lilac")).toBeVisible()
  })

  test('still lists connections when the graph request fails', async ({ page }) => {
    await mockApi(page, { user: USER, events: [], connections, graph: 500 })
    await page.goto('/profile')
    const section = page.getByRole('region', { name: 'Your connections' })
    await expect(section.getByRole('listitem')).toHaveCount(2)
    await expect(section.getByRole('img')).toHaveCount(0)
  })

  test('shows an empty state and no graph without connections', async ({ page }) => {
    const mock = await mockApi(page, { user: USER, events: [], connections: [], graph })
    await page.goto('/profile')
    const section = page.getByRole('region', { name: 'Your connections' })
    await expect(section.getByText('Go to an event to start connecting with people.')).toBeVisible()
    await expect(section.getByRole('link', { name: 'Find events' })).toHaveAttribute('href', '/')
    await expect(section.getByRole('img')).toHaveCount(0)
    expect(mock.requests).not.toContain(`GET /api/users/${USER.uuid}/connections/graph/`)
  })

  test('shows an alert when the connections request fails', async ({ page }) => {
    await mockApi(page, { user: USER, events: [], connections: 500 })
    await page.goto('/profile')
    const section = page.getByRole('region', { name: 'Your connections' })
    await expect(section.getByRole('alert')).toHaveText('Mocked failure.')
    await expect(section.getByText('Loading…')).toHaveCount(0)
  })
})

test('requests data for the logged-in user only', async ({ page }) => {
  const mock = await mockApi(page, { user: USER, events: [], connections: [] })
  await page.goto('/profile')
  await expect(page.getByText("You're not going to any events yet.")).toBeVisible()
  expect(mock.requests).toContain(`GET /api/users/${USER.uuid}/events/`)
  expect(mock.requests).toContain(`GET /api/users/${USER.uuid}/connections/`)
})
