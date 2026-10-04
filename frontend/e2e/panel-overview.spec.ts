import { expect, test } from '@playwright/test'
import { mockApi, mockStaffSession } from './fixtures/panel'

// Dates are shown in the viewer's zone; pin it so the text is predictable
test.use({ timezoneId: 'UTC', locale: 'en-US' })

const stats = {
  users: { total: 42, active: 40, staff: 3, new_this_week: 5 },
  occasions: { total: 17, upcoming: 2 },
  next_occasions: [
    {
      id: 7,
      name: 'Rooftop picnic',
      start_datetime: '2099-10-10T12:00:00Z',
      end_datetime: '2099-10-10T15:00:00Z',
      attendees_count: 4,
    },
    {
      id: 8,
      name: 'Open mic',
      start_datetime: '2099-11-02T19:30:00Z',
      end_datetime: null,
      attendees_count: 1,
    },
  ],
}

test.describe('panel overview', () => {
  test.beforeEach(async ({ page }) => {
    await mockStaffSession(page)
  })

  test('shows the totals tiles with their notes', async ({ page }) => {
    await mockApi(page, '/api/panel/stats/', { GET: () => ({ body: stats }) })
    await page.goto('/admin')

    const totals = page.getByRole('list', { name: 'Totals' })
    await expect(totals.getByRole('listitem')).toHaveCount(4)
    await expect(totals.getByRole('listitem').filter({ hasText: 'Users' })).toContainText('42')
    await expect(totals.getByRole('listitem').filter({ hasText: 'Users' })).toContainText('40 active')
    await expect(totals.getByRole('listitem').filter({ hasText: 'Admins' })).toContainText('3')
    await expect(totals.getByRole('listitem').filter({ hasText: 'Admins' })).toContainText('with panel access')
    await expect(totals.getByRole('listitem').filter({ hasText: 'New this week' })).toContainText('5')
    await expect(totals.getByRole('listitem').filter({ hasText: 'Occasions' })).toContainText('17')
    await expect(totals.getByRole('listitem').filter({ hasText: 'Occasions' })).toContainText('2 upcoming')
  })

  test('shows a loading message until stats arrive', async ({ page }) => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    await mockApi(page, '/api/panel/stats/', {
      GET: async () => {
        await gate
        return { body: stats }
      },
    })
    await page.goto('/admin')

    await expect(page.getByText('Loading…')).toBeVisible()
    release()
    await expect(page.getByRole('list', { name: 'Totals' })).toBeVisible()
    await expect(page.getByText('Loading…')).toHaveCount(0)
  })

  test('lists next occasions with date, time range and attendee count', async ({ page }) => {
    await mockApi(page, '/api/panel/stats/', { GET: () => ({ body: stats }) })
    await page.goto('/admin')

    const picnic = page.getByRole('link', { name: /Rooftop picnic/ })
    await expect(picnic).toContainText('Oct 10, 2099')
    // Same day: the date is shown once, then only the end time
    await expect(picnic).toContainText(/12:00\sPM\s–\s3:00\sPM/)
    await expect(picnic).toContainText('4 going')
    await expect(picnic).toHaveAttribute('href', '/admin/occasions/7')

    // No end time: only the start is shown
    const openMic = page.getByRole('link', { name: /Open mic/ })
    await expect(openMic).toContainText('Nov 2, 2099')
    await expect(openMic).toContainText('1 going')
    await expect(page.getByText('2 upcoming occasions in total.')).toBeVisible()
  })

  test('clicking a next occasion opens its edit form', async ({ page }) => {
    await mockApi(page, '/api/panel/stats/', { GET: () => ({ body: stats }) })
    await mockApi(page, '/api/panel/occasions/7/', {
      GET: () => ({
        body: {
          id: 7,
          name: 'Rooftop picnic',
          start_datetime: '2099-10-10T12:00:00Z',
          end_datetime: '2099-10-10T15:00:00Z',
          duration_minutes: 180,
          attendees: [],
          created_at: '2025-05-01T12:00:00Z',
          updated_at: '2025-05-02T12:00:00Z',
        },
      }),
    })
    await page.goto('/admin')
    await page.getByRole('link', { name: /Rooftop picnic/ }).click()

    await expect(page).toHaveURL(/\/admin\/occasions\/7$/)
    await expect(page.getByRole('heading', { name: 'Edit occasion' })).toBeVisible()
  })

  test('"All occasions" link goes to the occasions list', async ({ page }) => {
    await mockApi(page, '/api/panel/stats/', { GET: () => ({ body: stats }) })
    await mockApi(page, '/api/panel/occasions/', {
      GET: () => ({ body: { count: 0, next: null, previous: null, results: [] } }),
    })
    await page.goto('/admin')
    await page.getByRole('link', { name: 'All occasions' }).click()

    await expect(page).toHaveURL(/\/admin\/occasions$/)
    await expect(page.getByRole('heading', { name: 'Occasions' })).toBeVisible()
  })

  test('with no upcoming occasions it offers to create one', async ({ page }) => {
    await mockApi(page, '/api/panel/stats/', {
      GET: () => ({ body: { ...stats, occasions: { total: 3, upcoming: 0 }, next_occasions: [] } }),
    })
    await page.goto('/admin')

    await expect(page.getByText('No upcoming occasions.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Create an occasion' })).toHaveAttribute(
      'href',
      '/admin/occasions/new',
    )
    await expect(page.getByText('0 upcoming occasions in total.')).toBeVisible()
  })

  test('uses singular wording for a single upcoming occasion', async ({ page }) => {
    await mockApi(page, '/api/panel/stats/', {
      GET: () => ({
        body: { ...stats, occasions: { total: 3, upcoming: 1 }, next_occasions: [stats.next_occasions[0]] },
      }),
    })
    await page.goto('/admin')

    await expect(page.getByText('1 upcoming occasion in total.')).toBeVisible()
  })

  test('shows an alert when stats fail to load', async ({ page }) => {
    await mockApi(page, '/api/panel/stats/', { GET: () => ({ status: 500, body: { detail: 'Stats are down.' } }) })
    await page.goto('/admin')

    await expect(page.getByRole('alert')).toHaveText('Stats are down.')
    await expect(page.getByRole('list', { name: 'Totals' })).toHaveCount(0)
    await expect(page.getByText('Loading…')).toHaveCount(0)
  })

  test('shows a connection error when the server is unreachable', async ({ page }) => {
    await page.route('**/api/panel/stats/', (route) => route.abort('connectionrefused'))
    await page.goto('/admin')

    await expect(page.getByRole('alert')).toHaveText("Can't reach the server. Check your connection and try again.")
  })
})
