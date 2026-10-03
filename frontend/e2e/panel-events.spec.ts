import { expect, test, type Page } from '@playwright/test'
import {
  attendee,
  deferred,
  mockApi,
  mockStaffSession,
  paginate,
  panelEvent,
  type PanelEvent,
} from './fixtures/panel'

test.use({ timezoneId: 'UTC', locale: 'en-US' })

function seed(): PanelEvent[] {
  return [
    panelEvent({
      id: 10,
      name: 'Jazz night',
      start_datetime: '2099-10-10T18:00:00Z',
      end_datetime: '2099-10-10T21:00:00Z',
      duration_minutes: 180,
      attendees: [attendee(1, 'Ann Lee'), attendee(2, 'Bob Ray')],
    }),
    panelEvent({
      id: 11,
      name: 'Open mic',
      start_datetime: '2099-11-02T19:30:00Z',
      end_datetime: null,
      duration_minutes: null,
    }),
    panelEvent({
      id: 12,
      name: 'Old picnic',
      start_datetime: '2020-06-01T10:00:00Z',
      end_datetime: '2020-06-02T12:30:00Z',
      duration_minutes: 1590,
    }),
  ]
}

// In-memory list endpoint; DELETE removes from the same array
async function openEvents(page: Page, events = seed()) {
  const calls = await mockApi(page, '/api/panel/events/', {
    GET: ({ url }) => ({ body: paginate(events, url, (e) => [e.name]) }),
  })
  const deletes = await mockApi(page, /^\/api\/panel\/events\/\d+\/$/, {
    DELETE: ({ url }) => {
      const id = Number(url.pathname.split('/').at(-2))
      events.splice(
        events.findIndex((e) => e.id === id),
        1,
      )
      return { status: 204 }
    },
  })
  await page.goto('/admin/events')
  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible()
  return { events, calls, deletes }
}

const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name })

test.describe('panel events list', () => {
  test.beforeEach(async ({ page }) => {
    await mockStaffSession(page)
  })

  test('lists events with when, length and going count', async ({ page }) => {
    await openEvents(page)

    const jazz = row(page, 'Jazz night')
    await expect(jazz.getByRole('link', { name: 'Jazz night' })).toHaveAttribute('href', '/admin/events/10')
    await expect(jazz).toContainText(/Oct 10, 2099, 6:00\sPM\s–\s9:00\sPM/)
    await expect(jazz).toContainText('3 h')
    await expect(jazz.getByRole('cell').nth(3)).toHaveText('2')
  })

  test('shows "Open" for an event without an end and a multi-day length for a long one', async ({ page }) => {
    await openEvents(page)

    await expect(row(page, 'Open mic')).toContainText('Open')
    // 1590 minutes = 1 day 2 h 30 min
    await expect(row(page, 'Old picnic')).toContainText('1 day 2 h 30 min')
  })

  test('shows an empty state with a create link when there are no events', async ({ page }) => {
    await openEvents(page, [])

    await expect(page.getByText('No events yet.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Create the first event' })).toHaveAttribute(
      'href',
      '/admin/events/new',
    )
  })

  test('searching by name filters the list', async ({ page }) => {
    const { calls } = await openEvents(page)

    await page.getByLabel('Search by name').fill('mic')

    await expect(row(page, 'Open mic')).toBeVisible()
    await expect(row(page, 'Jazz night')).toHaveCount(0)
    expect(calls.at(-1)!.url.searchParams.get('search')).toBe('mic')
  })

  test('a search with no match says so and offers no create link', async ({ page }) => {
    await openEvents(page)

    await page.getByLabel('Search by name').fill('zzz')

    await expect(page.getByText('No events match “zzz”.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Create the first event' })).toHaveCount(0)
  })

  test('pages through a long list', async ({ page }) => {
    const many = Array.from({ length: 25 }, (_, i) => panelEvent({ id: 100 + i, name: `Event ${i + 1}` }))
    await openEvents(page, many)
    const pager = page.getByRole('navigation', { name: 'Pagination' })

    await expect(pager.getByText('Page 1 of 2')).toBeVisible()
    await expect(row(page, 'Event 20')).toBeVisible()
    await expect(row(page, 'Event 21')).toHaveCount(0)
    await pager.getByRole('button', { name: 'Next' }).click()

    await expect(pager.getByText('Page 2 of 2')).toBeVisible()
    await expect(row(page, 'Event 21')).toBeVisible()
  })

  test('"New event" and "Edit" navigate to the form', async ({ page }) => {
    await openEvents(page)

    await expect(page.getByRole('link', { name: 'New event' })).toHaveAttribute('href', '/admin/events/new')
    await expect(row(page, 'Jazz night').getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/admin/events/10',
    )
  })

  test('shows an alert when the list fails to load', async ({ page }) => {
    await mockApi(page, '/api/panel/events/', { GET: () => ({ status: 500, body: { detail: 'Server error.' } }) })
    await page.goto('/admin/events')

    await expect(page.getByRole('alert')).toHaveText('Server error.')
  })

  test.describe('delete', () => {
    test('asks for confirmation before deleting and does nothing until confirmed', async ({ page }) => {
      const { deletes } = await openEvents(page)

      await row(page, 'Jazz night').getByRole('button', { name: 'Delete' }).click()

      const confirm = page.getByRole('group', { name: 'Delete Jazz night?' })
      await expect(confirm).toBeVisible()
      await expect(confirm.getByText('Delete?')).toBeVisible()
      await expect(confirm.getByRole('button', { name: 'Keep' })).toBeFocused()
      expect(deletes).toHaveLength(0)
    })

    test('"Keep" cancels the delete', async ({ page }) => {
      const { deletes } = await openEvents(page)
      const jazz = row(page, 'Jazz night')

      await jazz.getByRole('button', { name: 'Delete' }).click()
      await page.getByRole('button', { name: 'Keep' }).click()

      await expect(page.getByRole('group', { name: 'Delete Jazz night?' })).toHaveCount(0)
      await expect(jazz.getByRole('button', { name: 'Delete' })).toBeVisible()
      expect(deletes).toHaveLength(0)
    })

    test('confirming deletes the event and reloads the list', async ({ page }) => {
      const { deletes, calls } = await openEvents(page)
      const before = calls.length

      await row(page, 'Jazz night').getByRole('button', { name: 'Delete' }).click()
      await page.getByRole('group', { name: 'Delete Jazz night?' }).getByRole('button', { name: 'Delete' }).click()

      await expect(row(page, 'Jazz night')).toHaveCount(0)
      await expect(row(page, 'Open mic')).toBeVisible()
      expect(deletes).toHaveLength(1)
      expect(deletes[0].url.pathname).toBe('/api/panel/events/10/')
      expect(calls.length).toBeGreaterThan(before)
    })

    test('a failed delete shows the error and keeps the row', async ({ page }) => {
      await openEvents(page)
      await mockApi(page, '/api/panel/events/10/', {
        DELETE: () => ({ status: 500, body: { detail: 'Could not delete.' } }),
      })

      await row(page, 'Jazz night').getByRole('button', { name: 'Delete' }).click()
      await page.getByRole('group', { name: 'Delete Jazz night?' }).getByRole('button', { name: 'Delete' }).click()

      await expect(page.getByRole('alert')).toHaveText('Could not delete.')
      await expect(row(page, 'Jazz night')).toBeVisible()
    })

    test('deleting the last row of a later page steps back a page', async ({ page }) => {
      const many = Array.from({ length: 21 }, (_, i) => panelEvent({ id: 100 + i, name: `Event ${i + 1}` }))
      const { calls } = await openEvents(page, many)
      const pager = page.getByRole('navigation', { name: 'Pagination' })

      await pager.getByRole('button', { name: 'Next' }).click()
      await expect(row(page, 'Event 21')).toBeVisible()
      await row(page, 'Event 21').getByRole('button', { name: 'Delete' }).click()
      await page.getByRole('group', { name: 'Delete Event 21?' }).getByRole('button', { name: 'Delete' }).click()

      await expect(row(page, 'Event 1').first()).toBeVisible()
      await expect(row(page, 'Event 20')).toBeVisible()
      await expect(pager).toHaveCount(0)
      expect(calls.at(-1)!.url.searchParams.get('page')).toBe('1')
    })
  })

  test.describe('finish', () => {
    test('only upcoming events have a Finish button', async ({ page }) => {
      await openEvents(page)

      await expect(row(page, 'Jazz night').getByRole('button', { name: 'Finish' })).toBeVisible()
      await expect(row(page, 'Open mic').getByRole('button', { name: 'Finish' })).toBeVisible()
      await expect(row(page, 'Old picnic').getByRole('button', { name: 'Finish' })).toHaveCount(0)
    })

    test('finishing asks for confirmation, then posts to the finish endpoint', async ({ page }) => {
      const { events } = await openEvents(page)
      const finishes = await mockApi(page, '/api/panel/events/10/finish/', {
        POST: () => {
          events[0].end_datetime = '2020-01-01T00:00:00Z'
          events[0].start_datetime = '2019-12-31T00:00:00Z'
          return { body: events[0] }
        },
      })

      await row(page, 'Jazz night').getByRole('button', { name: 'Finish' }).click()
      const confirm = page.getByRole('group', { name: 'Finish Jazz night?' })
      await expect(confirm.getByText('Finish now?')).toBeVisible()
      expect(finishes).toHaveLength(0)
      await confirm.getByRole('button', { name: 'Finish' }).click()

      // After reload the event is over, so its Finish button is gone
      await expect(page.getByRole('group', { name: 'Finish Jazz night?' })).toHaveCount(0)
      await expect(row(page, 'Jazz night').getByRole('button', { name: 'Finish' })).toHaveCount(0)
      expect(finishes).toHaveLength(1)
    })
  })

  test.describe('create test event', () => {
    const created = panelEvent({
      id: 99,
      name: 'Test event 4821',
      start_datetime: '2099-12-24T17:00:00Z',
      end_datetime: '2099-12-24T19:00:00Z',
      attendees: [attendee(1, 'Ann Lee'), attendee(2, 'Bob Ray'), attendee(3, 'Cat Dee')],
    })

    test('posts to the test endpoint, refreshes the table and shows a status message', async ({ page }) => {
      const { events, calls } = await openEvents(page)
      const posts = await mockApi(page, '/api/panel/events/test/', {
        POST: () => {
          events.push(created)
          return { status: 201, body: created }
        },
      })
      const before = calls.length

      await page.getByRole('button', { name: 'Create test event' }).click()

      const status = page.getByRole('status')
      await expect(status).toContainText('Created')
      await expect(status.getByRole('link', { name: 'Test event 4821' })).toHaveAttribute('href', '/admin/events/99')
      await expect(status).toContainText(/Dec 24, 2099, 5:00\sPM\s–\s7:00\sPM/)
      await expect(status).toContainText('with Ann Lee, Bob Ray, Cat Dee')
      // The table was reloaded before the message appeared, so the new row is there
      await expect(row(page, 'Test event 4821')).toBeVisible()
      expect(posts).toHaveLength(1)
      expect(calls.length).toBeGreaterThan(before)
    })

    test('the button shows a busy state while the event is being created', async ({ page }) => {
      const { events } = await openEvents(page)
      const gate = deferred()
      await mockApi(page, '/api/panel/events/test/', {
        POST: async () => {
          await gate.promise
          events.push(created)
          return { status: 201, body: created }
        },
      })

      await page.getByRole('button', { name: 'Create test event' }).click()
      await expect(page.getByRole('button', { name: 'Creating…' })).toBeDisabled()
      await expect(page.getByRole('status')).toHaveCount(0)

      gate.resolve()
      await expect(page.getByRole('button', { name: 'Create test event' })).toBeEnabled()
      await expect(page.getByRole('status')).toContainText('Test event 4821')
    })

    test('a failure shows an alert and no status message', async ({ page }) => {
      await openEvents(page)
      await mockApi(page, '/api/panel/events/test/', {
        POST: () => ({ status: 500, body: { detail: 'Could not create a test event.' } }),
      })

      await page.getByRole('button', { name: 'Create test event' }).click()

      await expect(page.getByRole('alert')).toHaveText('Could not create a test event.')
      await expect(page.getByRole('status')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Create test event' })).toBeEnabled()
    })

    test('an unreachable server shows a connection error', async ({ page }) => {
      await openEvents(page)
      await page.route('**/api/panel/events/test/', (route) => route.abort('connectionrefused'))

      await page.getByRole('button', { name: 'Create test event' }).click()

      await expect(page.getByRole('alert')).toHaveText("Can't reach the server. Check your connection and try again.")
    })

    test('a second click replaces the previous status message', async ({ page }) => {
      const { events } = await openEvents(page)
      let n = 0
      await mockApi(page, '/api/panel/events/test/', {
        POST: () => {
          n += 1
          const e = panelEvent({ ...created, id: 200 + n, name: `Test event ${n}` })
          events.push(e)
          return { status: 201, body: e }
        },
      })

      await page.getByRole('button', { name: 'Create test event' }).click()
      await expect(page.getByRole('status')).toContainText('Test event 1')
      await page.getByRole('button', { name: 'Create test event' }).click()

      await expect(page.getByRole('status')).toContainText('Test event 2')
      await expect(page.getByRole('status')).not.toContainText('Test event 1')
    })
  })
})
