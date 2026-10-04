import { expect, test, type Page } from '@playwright/test'
import {
  attendee,
  deferred,
  mockApi,
  mockStaffSession,
  paginate,
  panelOccasion,
  type PanelOccasion,
} from './fixtures/panel'

test.use({ timezoneId: 'UTC', locale: 'en-US' })

function seed(): PanelOccasion[] {
  return [
    panelOccasion({
      id: 10,
      name: 'Jazz night',
      start_datetime: '2099-10-10T18:00:00Z',
      end_datetime: '2099-10-10T21:00:00Z',
      duration_minutes: 180,
      attendees: [attendee(1, 'Ann Lee'), attendee(2, 'Bob Ray')],
    }),
    panelOccasion({
      id: 11,
      name: 'Open mic',
      start_datetime: '2099-11-02T19:30:00Z',
      end_datetime: null,
      duration_minutes: null,
    }),
    panelOccasion({
      id: 12,
      name: 'Old picnic',
      start_datetime: '2020-06-01T10:00:00Z',
      end_datetime: '2020-06-02T12:30:00Z',
      duration_minutes: 1590,
    }),
  ]
}

// In-memory list endpoint; DELETE removes from the same array
async function openOccasions(page: Page, occasions = seed()) {
  const calls = await mockApi(page, '/api/panel/occasions/', {
    GET: ({ url }) => ({ body: paginate(occasions, url, (e) => [e.name]) }),
  })
  const deletes = await mockApi(page, /^\/api\/panel\/occasions\/\d+\/$/, {
    DELETE: ({ url }) => {
      const id = Number(url.pathname.split('/').at(-2))
      occasions.splice(
        occasions.findIndex((e) => e.id === id),
        1,
      )
      return { status: 204 }
    },
  })
  await page.goto('/admin/occasions')
  await expect(page.getByRole('heading', { name: 'Occasions' })).toBeVisible()
  return { occasions, calls, deletes }
}

const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name })

test.describe('panel occasions list', () => {
  test.beforeEach(async ({ page }) => {
    await mockStaffSession(page)
  })

  test('lists occasions with when, length and going count', async ({ page }) => {
    await openOccasions(page)

    const jazz = row(page, 'Jazz night')
    await expect(jazz.getByRole('link', { name: 'Jazz night' })).toHaveAttribute('href', '/admin/occasions/10')
    // Date over times, with the full range on hover
    const when = jazz.getByRole('cell').nth(1)
    await expect(when.locator('time')).toHaveText('Oct 10, 2099')
    await expect(when).toContainText(/6:00\sPM\s–\s9:00\sPM/)
    await expect(when.locator('.when')).toHaveAttribute('title', /Oct 10, 2099, 6:00\sPM\s–\s9:00\sPM/)
    await expect(jazz).toContainText('3 h')
    await expect(jazz.getByRole('cell').nth(3)).toHaveText('2')
  })

  test('shows "Open" for an occasion without an end and a multi-day length for a long one', async ({ page }) => {
    await openOccasions(page)

    await expect(row(page, 'Open mic')).toContainText('Open')
    // 1590 minutes = 1 day 2 h 30 min
    await expect(row(page, 'Old picnic')).toContainText('1 day 2 h 30 min')
  })

  test('a multi-day occasion shows its end day without the year', async ({ page }) => {
    await openOccasions(page)

    const when = row(page, 'Old picnic').getByRole('cell').nth(1)
    await expect(when.locator('time')).toHaveText('Jun 1, 2020')
    await expect(when).toContainText(/10:00\sAM\s–\sJun 2, 12:30\sPM/)
  })

  test('shows status and every tag on one line under the name, keeping rows the same height', async ({ page }) => {
    const occasions = seed()
    occasions[0] = {
      ...occasions[0],
      cancelled_at: '2099-10-01T12:00:00Z',
      tags: ['Jazz', 'Live music', 'Evening', 'Drinks', 'Downtown', 'Late night', 'Free entry'].map((name, i) => ({
        id: i + 1,
        name,
      })),
    }
    await openOccasions(page, occasions)

    const meta = row(page, 'Jazz night').getByRole('list', { name: 'Status and tags' })
    await expect(meta.getByRole('listitem')).toHaveText([
      'Cancelled',
      'Jazz',
      'Live music',
      'Evening',
      'Drinks',
      'Downtown',
      'Late night',
      'Free entry',
    ])
    await expect(meta).toHaveAttribute('title', 'Cancelled, Jazz, Live music, Evening, Drinks, Downtown, Late night, Free entry')
    // Below the name, not beside it
    const name = await row(page, 'Jazz night').getByRole('link', { name: 'Jazz night' }).boundingBox()
    const metaBox = await meta.boundingBox()
    expect(metaBox!.y).toBeGreaterThanOrEqual(name!.y + name!.height - 1)

    // A row with no tags or status is as tall as one with many (clientHeight leaves out the last row's missing border)
    const heights = await Promise.all(
      ['Jazz night', 'Open mic', 'Old picnic'].map((n) =>
        row(page, n)
          .getByRole('cell')
          .first()
          .evaluate((td) => td.clientHeight),
      ),
    )
    expect(new Set(heights).size).toBe(1)
  })

  test('shows an empty state with a create link when there are no occasions', async ({ page }) => {
    await openOccasions(page, [])

    await expect(page.getByText('No occasions yet.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Create the first occasion' })).toHaveAttribute(
      'href',
      '/admin/occasions/new',
    )
  })

  test('searching by name filters the list', async ({ page }) => {
    const { calls } = await openOccasions(page)

    await page.getByLabel('Search by name').fill('mic')

    await expect(row(page, 'Open mic')).toBeVisible()
    await expect(row(page, 'Jazz night')).toHaveCount(0)
    expect(calls.at(-1)!.url.searchParams.get('search')).toBe('mic')
  })

  test('a search with no match says so and offers no create link', async ({ page }) => {
    await openOccasions(page)

    await page.getByLabel('Search by name').fill('zzz')

    await expect(page.getByText('No occasions match “zzz”.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Create the first occasion' })).toHaveCount(0)
  })

  test('pages through a long list', async ({ page }) => {
    const many = Array.from({ length: 25 }, (_, i) => panelOccasion({ id: 100 + i, name: `Occasion ${i + 1}` }))
    await openOccasions(page, many)
    const pager = page.getByRole('navigation', { name: 'Pagination' })

    await expect(pager.getByText('Page 1 of 2')).toBeVisible()
    await expect(row(page, 'Occasion 20')).toBeVisible()
    await expect(row(page, 'Occasion 21')).toHaveCount(0)
    await pager.getByRole('button', { name: 'Next' }).click()

    await expect(pager.getByText('Page 2 of 2')).toBeVisible()
    await expect(row(page, 'Occasion 21')).toBeVisible()
  })

  test('"New occasion" and "Edit" navigate to the form', async ({ page }) => {
    await openOccasions(page)

    await expect(page.getByRole('link', { name: 'New occasion' })).toHaveAttribute('href', '/admin/occasions/new')
    await expect(row(page, 'Jazz night').getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/admin/occasions/10',
    )
  })

  test('shows an alert when the list fails to load', async ({ page }) => {
    await mockApi(page, '/api/panel/occasions/', { GET: () => ({ status: 500, body: { detail: 'Server error.' } }) })
    await page.goto('/admin/occasions')

    await expect(page.getByRole('alert')).toHaveText('Server error.')
  })

  test.describe('delete', () => {
    test('asks for confirmation before deleting and does nothing until confirmed', async ({ page }) => {
      const { deletes } = await openOccasions(page)

      await row(page, 'Jazz night').getByRole('button', { name: 'Delete' }).click()

      const confirm = page.getByRole('group', { name: 'Delete Jazz night?' })
      await expect(confirm).toBeVisible()
      await expect(confirm.getByText('Delete?')).toBeVisible()
      await expect(confirm.getByRole('button', { name: 'Keep' })).toBeFocused()
      expect(deletes).toHaveLength(0)
    })

    test('"Keep" cancels the delete', async ({ page }) => {
      const { deletes } = await openOccasions(page)
      const jazz = row(page, 'Jazz night')

      await jazz.getByRole('button', { name: 'Delete' }).click()
      await page.getByRole('button', { name: 'Keep' }).click()

      await expect(page.getByRole('group', { name: 'Delete Jazz night?' })).toHaveCount(0)
      await expect(jazz.getByRole('button', { name: 'Delete' })).toBeVisible()
      expect(deletes).toHaveLength(0)
    })

    test('confirming deletes the occasion and reloads the list', async ({ page }) => {
      const { deletes, calls } = await openOccasions(page)
      const before = calls.length

      await row(page, 'Jazz night').getByRole('button', { name: 'Delete' }).click()
      await page.getByRole('group', { name: 'Delete Jazz night?' }).getByRole('button', { name: 'Delete' }).click()

      await expect(row(page, 'Jazz night')).toHaveCount(0)
      await expect(row(page, 'Open mic')).toBeVisible()
      expect(deletes).toHaveLength(1)
      expect(deletes[0].url.pathname).toBe('/api/panel/occasions/10/')
      expect(calls.length).toBeGreaterThan(before)
    })

    test('a failed delete shows the error and keeps the row', async ({ page }) => {
      await openOccasions(page)
      await mockApi(page, '/api/panel/occasions/10/', {
        DELETE: () => ({ status: 500, body: { detail: 'Could not delete.' } }),
      })

      await row(page, 'Jazz night').getByRole('button', { name: 'Delete' }).click()
      await page.getByRole('group', { name: 'Delete Jazz night?' }).getByRole('button', { name: 'Delete' }).click()

      await expect(page.getByRole('alert')).toHaveText('Could not delete.')
      await expect(row(page, 'Jazz night')).toBeVisible()
    })

    test('deleting the last row of a later page steps back a page', async ({ page }) => {
      const many = Array.from({ length: 21 }, (_, i) => panelOccasion({ id: 100 + i, name: `Occasion ${i + 1}` }))
      const { calls } = await openOccasions(page, many)
      const pager = page.getByRole('navigation', { name: 'Pagination' })

      await pager.getByRole('button', { name: 'Next' }).click()
      await expect(row(page, 'Occasion 21')).toBeVisible()
      await row(page, 'Occasion 21').getByRole('button', { name: 'Delete' }).click()
      await page.getByRole('group', { name: 'Delete Occasion 21?' }).getByRole('button', { name: 'Delete' }).click()

      await expect(row(page, 'Occasion 1').first()).toBeVisible()
      await expect(row(page, 'Occasion 20')).toBeVisible()
      await expect(pager).toHaveCount(0)
      expect(calls.at(-1)!.url.searchParams.get('page')).toBe('1')
    })
  })

  test.describe('finish', () => {
    test('only upcoming occasions have a Finish button', async ({ page }) => {
      await openOccasions(page)

      await expect(row(page, 'Jazz night').getByRole('button', { name: 'Finish' })).toBeVisible()
      await expect(row(page, 'Open mic').getByRole('button', { name: 'Finish' })).toBeVisible()
      await expect(row(page, 'Old picnic').getByRole('button', { name: 'Finish' })).toHaveCount(0)
    })

    test('finishing asks for confirmation, then posts to the finish endpoint', async ({ page }) => {
      const { occasions } = await openOccasions(page)
      const finishes = await mockApi(page, '/api/panel/occasions/10/finish/', {
        POST: () => {
          occasions[0].end_datetime = '2020-01-01T00:00:00Z'
          occasions[0].start_datetime = '2019-12-31T00:00:00Z'
          return { body: occasions[0] }
        },
      })

      await row(page, 'Jazz night').getByRole('button', { name: 'Finish' }).click()
      const confirm = page.getByRole('group', { name: 'Finish Jazz night?' })
      await expect(confirm.getByText('Finish now?')).toBeVisible()
      expect(finishes).toHaveLength(0)
      await confirm.getByRole('button', { name: 'Finish' }).click()

      // After reload the occasion is over, so its Finish button is gone
      await expect(page.getByRole('group', { name: 'Finish Jazz night?' })).toHaveCount(0)
      await expect(row(page, 'Jazz night').getByRole('button', { name: 'Finish' })).toHaveCount(0)
      expect(finishes).toHaveLength(1)
    })
  })

  test.describe('cancel', () => {
    test('only upcoming occasions have a Cancel button', async ({ page }) => {
      await openOccasions(page)

      await expect(row(page, 'Jazz night').getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
      await expect(row(page, 'Open mic').getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
      await expect(row(page, 'Old picnic').getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
    })

    test('cancelling asks for confirmation, then marks the row cancelled', async ({ page }) => {
      const { occasions } = await openOccasions(page)
      const cancels = await mockApi(page, '/api/panel/occasions/10/cancel/', {
        POST: () => {
          occasions[0].cancelled_at = '2026-01-01T00:00:00Z'
          return { body: occasions[0] }
        },
      })

      await row(page, 'Jazz night').getByRole('button', { name: 'Cancel', exact: true }).click()
      const confirm = page.getByRole('group', { name: 'Cancel Jazz night?' })
      await expect(confirm.getByText('Cancel it?')).toBeVisible()
      expect(cancels).toHaveLength(0)
      await confirm.getByRole('button', { name: 'Cancel occasion' }).click()

      // After reload it's tagged and can't be finished or cancelled again
      await expect(page.getByRole('group', { name: 'Cancel Jazz night?' })).toHaveCount(0)
      await expect(row(page, 'Jazz night').getByText('Cancelled', { exact: true })).toBeVisible()
      await expect(row(page, 'Jazz night').getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
      await expect(row(page, 'Jazz night').getByRole('button', { name: 'Finish' })).toHaveCount(0)
      expect(cancels).toHaveLength(1)
    })

    test('Keep closes the confirmation without cancelling', async ({ page }) => {
      await openOccasions(page)
      const cancels = await mockApi(page, '/api/panel/occasions/10/cancel/', { POST: () => ({ body: {} }) })

      await row(page, 'Jazz night').getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.getByRole('group', { name: 'Cancel Jazz night?' }).getByRole('button', { name: 'Keep' }).click()

      await expect(row(page, 'Jazz night').getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
      expect(cancels).toHaveLength(0)
    })
  })

  test.describe('create test occasion', () => {
    const created = panelOccasion({
      id: 99,
      name: 'Test occasion 4821',
      start_datetime: '2099-12-24T17:00:00Z',
      end_datetime: '2099-12-24T19:00:00Z',
      attendees: [attendee(1, 'Ann Lee'), attendee(2, 'Bob Ray'), attendee(3, 'Cat Dee')],
    })

    test('posts to the test endpoint, refreshes the table and shows a status message', async ({ page }) => {
      const { occasions, calls } = await openOccasions(page)
      const posts = await mockApi(page, '/api/panel/occasions/test/', {
        POST: () => {
          occasions.push(created)
          return { status: 201, body: created }
        },
      })
      const before = calls.length

      await page.getByRole('button', { name: 'Create test occasion' }).click()

      const status = page.getByRole('status')
      await expect(status).toContainText('Created')
      await expect(status.getByRole('link', { name: 'Test occasion 4821' })).toHaveAttribute('href', '/admin/occasions/99')
      await expect(status).toContainText(/Dec 24, 2099, 5:00\sPM\s–\s7:00\sPM/)
      await expect(status).toContainText('with Ann Lee, Bob Ray, Cat Dee')
      // The table was reloaded before the message appeared, so the new row is there
      await expect(row(page, 'Test occasion 4821')).toBeVisible()
      expect(posts).toHaveLength(1)
      expect(calls.length).toBeGreaterThan(before)
    })

    test('the button shows a busy state while the occasion is being created', async ({ page }) => {
      const { occasions } = await openOccasions(page)
      const gate = deferred()
      await mockApi(page, '/api/panel/occasions/test/', {
        POST: async () => {
          await gate.promise
          occasions.push(created)
          return { status: 201, body: created }
        },
      })

      await page.getByRole('button', { name: 'Create test occasion' }).click()
      await expect(page.getByRole('button', { name: 'Creating…' })).toBeDisabled()
      await expect(page.getByRole('status')).toHaveCount(0)

      gate.resolve()
      await expect(page.getByRole('button', { name: 'Create test occasion' })).toBeEnabled()
      await expect(page.getByRole('status')).toContainText('Test occasion 4821')
    })

    test('a failure shows an alert and no status message', async ({ page }) => {
      await openOccasions(page)
      await mockApi(page, '/api/panel/occasions/test/', {
        POST: () => ({ status: 500, body: { detail: 'Could not create a test occasion.' } }),
      })

      await page.getByRole('button', { name: 'Create test occasion' }).click()

      await expect(page.getByRole('alert')).toHaveText('Could not create a test occasion.')
      await expect(page.getByRole('status')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Create test occasion' })).toBeEnabled()
    })

    test('an unreachable server shows a connection error', async ({ page }) => {
      await openOccasions(page)
      await page.route('**/api/panel/occasions/test/', (route) => route.abort('connectionrefused'))

      await page.getByRole('button', { name: 'Create test occasion' }).click()

      await expect(page.getByRole('alert')).toHaveText("Can't reach the server. Check your connection and try again.")
    })

    test('a second click replaces the previous status message', async ({ page }) => {
      const { occasions } = await openOccasions(page)
      let n = 0
      await mockApi(page, '/api/panel/occasions/test/', {
        POST: () => {
          n += 1
          const e = panelOccasion({ ...created, id: 200 + n, name: `Test occasion ${n}` })
          occasions.push(e)
          return { status: 201, body: e }
        },
      })

      await page.getByRole('button', { name: 'Create test occasion' }).click()
      await expect(page.getByRole('status')).toContainText('Test occasion 1')
      await page.getByRole('button', { name: 'Create test occasion' }).click()

      await expect(page.getByRole('status')).toContainText('Test occasion 2')
      await expect(page.getByRole('status')).not.toContainText('Test occasion 1')
    })
  })
})
