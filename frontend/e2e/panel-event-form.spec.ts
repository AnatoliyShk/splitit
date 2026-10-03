import { expect, test, type Page } from '@playwright/test'
import {
  attendee,
  deferred,
  mockApi,
  mockStaffSession,
  pageOf,
  paginate,
  panelEvent,
  panelUser,
  type Attendee,
} from './fixtures/panel'

// datetime-local values are wall-clock time; pin the zone so the UTC payload is predictable
test.use({ timezoneId: 'UTC', locale: 'en-US' })

const people: Attendee[] = [
  attendee(1, 'Ann Lee', 'ann@example.com'),
  attendee(2, 'Bob Ray', 'bob@example.com'),
  attendee(3, 'Anna Fox', 'anna@example.com'),
  { id: 4, name: '', email: 'noname@example.com' },
]

// Every form test needs the user search (attendee picker) and the events list it returns to
async function mockCommon(page: Page) {
  await mockStaffSession(page)
  const searches = await mockApi(page, '/api/panel/users/', {
    GET: ({ url }) => ({
      body: paginate(
        people.map((p) => panelUser({ ...p })),
        url,
        (u) => [u.name, u.email],
      ),
    }),
  })
  await mockApi(page, '/api/panel/events/', {
    GET: () => ({ body: pageOf([panelEvent({ id: 55, name: 'Saved event' })]) }),
  })
  return searches
}

const nameInput = (page: Page) => page.getByLabel('Name', { exact: true })
const startsInput = (page: Page) => page.getByLabel('Starts')
const endsInput = (page: Page) => page.getByLabel('Ends')

test.describe('new event', () => {
  test('starts as an empty form', async ({ page }) => {
    await mockCommon(page)
    await page.goto('/admin/events/new')

    await expect(page.getByRole('heading', { name: 'New event' })).toBeVisible()
    await expect(nameInput(page)).toHaveValue('')
    await expect(startsInput(page)).toHaveValue('')
    await expect(endsInput(page)).toHaveValue('')
    await expect(page.getByText('Nobody yet. Search below to add people.')).toBeVisible()
    await expect(page.getByText('Your time zone: UTC')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create event' })).toBeEnabled()
  })

  test('creates an event and returns to the list', async ({ page }) => {
    await mockCommon(page)
    const posts = await mockApi(page, '/api/panel/events/', {
      GET: () => ({ body: pageOf([panelEvent({ id: 55, name: 'Saved event' })]) }),
      POST: ({ body }) => ({ status: 201, body: panelEvent({ id: 77, ...(body as object) }) }),
    })
    await page.goto('/admin/events/new')

    await nameInput(page).fill('Board game night')
    await startsInput(page).fill('2099-10-10T18:00')
    await endsInput(page).fill('2099-10-10T21:30')
    await page.getByRole('button', { name: 'Create event' }).click()

    await expect(page).toHaveURL(/\/admin\/events$/)
    await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible()
    const post = posts.find((c) => c.method === 'POST')!
    expect(post.body).toEqual({
      name: 'Board game night',
      start_datetime: '2099-10-10T18:00:00.000Z',
      end_datetime: '2099-10-10T21:30:00.000Z',
      users: [],
    })
  })

  test('creates an event with no end time', async ({ page }) => {
    await mockCommon(page)
    const posts = await mockApi(page, '/api/panel/events/', {
      GET: () => ({ body: pageOf([]) }),
      POST: ({ body }) => ({ status: 201, body: panelEvent({ id: 77, ...(body as object) }) }),
    })
    await page.goto('/admin/events/new')

    await nameInput(page).fill('Open mic')
    await startsInput(page).fill('2099-11-02T19:30')
    await page.getByRole('button', { name: 'Create event' }).click()

    await expect(page).toHaveURL(/\/admin\/events$/)
    expect(posts.find((c) => c.method === 'POST')!.body).toMatchObject({
      name: 'Open mic',
      start_datetime: '2099-11-02T19:30:00.000Z',
      end_datetime: null,
    })
  })

  test('the Ends field constrains its minimum to the start', async ({ page }) => {
    await mockCommon(page)
    await page.goto('/admin/events/new')

    await startsInput(page).fill('2099-10-10T18:00')

    await expect(endsInput(page)).toHaveAttribute('min', '2099-10-10T18:00')
  })

  test('Cancel and the back link return to the list without saving', async ({ page }) => {
    await mockCommon(page)
    const posts = await mockApi(page, '/api/panel/events/', {
      GET: () => ({ body: pageOf([]) }),
      POST: () => ({ status: 201, body: panelEvent() }),
    })
    await page.goto('/admin/events/new')
    await nameInput(page).fill('Never saved')
    await page.getByRole('link', { name: 'Cancel' }).click()

    await expect(page).toHaveURL(/\/admin\/events$/)
    expect(posts.filter((c) => c.method === 'POST')).toHaveLength(0)

    await page.goto('/admin/events/new')
    await page.getByRole('link', { name: '← Events' }).click()
    await expect(page).toHaveURL(/\/admin\/events$/)
  })

  test.describe('validation errors', () => {
    test('end before start shows the server error on the Ends field and focuses it', async ({ page }) => {
      await mockCommon(page)
      await mockApi(page, '/api/panel/events/', {
        POST: () => ({ status: 400, body: { end_datetime: ['The end must be after the start.'] } }),
      })
      await page.goto('/admin/events/new')

      await nameInput(page).fill('Backwards')
      await startsInput(page).fill('2099-10-10T18:00')
      await endsInput(page).fill('2099-10-10T17:00')
      await page.getByRole('button', { name: 'Create event' }).click()

      await expect(page.getByText('The end must be after the start.')).toBeVisible()
      await expect(endsInput(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(endsInput(page)).toBeFocused()
      await expect(endsInput(page)).toHaveAccessibleDescription(/The end must be after the start\./)
      // Stays on the form, and what was typed is kept
      await expect(page).toHaveURL(/\/admin\/events\/new$/)
      await expect(nameInput(page)).toHaveValue('Backwards')
      await expect(page.getByRole('button', { name: 'Create event' })).toBeEnabled()
    })

    test('sends end-before-start as typed so the server decides', async ({ page }) => {
      await mockCommon(page)
      const posts = await mockApi(page, '/api/panel/events/', {
        POST: () => ({ status: 400, body: { end_datetime: ['The end must be after the start.'] } }),
      })
      await page.goto('/admin/events/new')

      await nameInput(page).fill('Backwards')
      await startsInput(page).fill('2099-10-10T18:00')
      await endsInput(page).fill('2099-10-10T17:00')
      await page.getByRole('button', { name: 'Create event' }).click()

      await expect(page.getByText('The end must be after the start.')).toBeVisible()
      expect(posts).toHaveLength(1)
      expect(posts[0].body).toMatchObject({
        start_datetime: '2099-10-10T18:00:00.000Z',
        end_datetime: '2099-10-10T17:00:00.000Z',
      })
    })

    test('missing name and start show field errors and focus the first invalid field', async ({ page }) => {
      await mockCommon(page)
      await mockApi(page, '/api/panel/events/', {
        POST: () => ({
          status: 400,
          body: { name: ['This field may not be blank.'], start_datetime: ['This field may not be null.'] },
        }),
      })
      await page.goto('/admin/events/new')
      await page.getByRole('button', { name: 'Create event' }).click()

      await expect(page.getByText('This field may not be blank.')).toBeVisible()
      await expect(page.getByText('This field may not be null.')).toBeVisible()
      await expect(nameInput(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(startsInput(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(nameInput(page)).toBeFocused()
    })

    test('a form-wide error shows as an alert', async ({ page }) => {
      await mockCommon(page)
      await mockApi(page, '/api/panel/events/', {
        POST: () => ({ status: 403, body: { detail: 'You do not have permission.' } }),
      })
      await page.goto('/admin/events/new')
      await nameInput(page).fill('X')
      await startsInput(page).fill('2099-10-10T18:00')
      await page.getByRole('button', { name: 'Create event' }).click()

      await expect(page.getByRole('alert')).toHaveText('You do not have permission.')
    })

    test('errors clear on the next submit', async ({ page }) => {
      await mockCommon(page)
      let attempt = 0
      await mockApi(page, '/api/panel/events/', {
        GET: () => ({ body: pageOf([]) }),
        POST: ({ body }) => {
          attempt += 1
          return attempt === 1
            ? { status: 400, body: { name: ['This field may not be blank.'] } }
            : { status: 201, body: panelEvent({ ...(body as object) }) }
        },
      })
      await page.goto('/admin/events/new')
      await startsInput(page).fill('2099-10-10T18:00')
      await page.getByRole('button', { name: 'Create event' }).click()
      await expect(page.getByText('This field may not be blank.')).toBeVisible()

      await nameInput(page).fill('Fixed')
      await page.getByRole('button', { name: 'Create event' }).click()

      await expect(page).toHaveURL(/\/admin\/events$/)
    })

    test('the save button shows a busy state while saving', async ({ page }) => {
      await mockCommon(page)
      const gate = deferred()
      await mockApi(page, '/api/panel/events/', {
        GET: () => ({ body: pageOf([]) }),
        POST: async ({ body }) => {
          await gate.promise
          return { status: 201, body: panelEvent({ ...(body as object) }) }
        },
      })
      await page.goto('/admin/events/new')
      await nameInput(page).fill('Slow')
      await startsInput(page).fill('2099-10-10T18:00')
      await page.getByRole('button', { name: 'Create event' }).click()

      await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled()
      gate.resolve()
      await expect(page).toHaveURL(/\/admin\/events$/)
    })
  })

  test.describe('attendee picker', () => {
    test('searches users, adds them as chips and sends their ids', async ({ page }) => {
      const searches = await mockCommon(page)
      const posts = await mockApi(page, '/api/panel/events/', {
        GET: () => ({ body: pageOf([]) }),
        POST: ({ body }) => ({ status: 201, body: panelEvent({ ...(body as object) }) }),
      })
      await page.goto('/admin/events/new')

      await page.getByLabel('Add people').fill('ann')
      const results = page.getByRole('list', { name: 'Search results' })
      await expect(results.getByRole('button')).toHaveCount(2)
      expect(searches.at(-1)!.url.searchParams.get('search')).toBe('ann')

      await results.getByRole('button', { name: /Ann Lee/ }).click()
      const chips = page.getByRole('list', { name: 'Selected people' })
      await expect(chips).toContainText('Ann Lee')
      // Picking clears the search box and closes the results
      await expect(page.getByLabel('Add people')).toHaveValue('')
      await expect(results).toHaveCount(0)
      await expect(page.getByText('Nobody yet.')).toHaveCount(0)

      await page.getByLabel('Add people').fill('anna')
      await page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: /Anna Fox/ }).click()
      await expect(chips.getByRole('listitem')).toHaveCount(2)

      await nameInput(page).fill('With friends')
      await startsInput(page).fill('2099-10-10T18:00')
      await page.getByRole('button', { name: 'Create event' }).click()

      await expect(page).toHaveURL(/\/admin\/events$/)
      expect(posts.find((c) => c.method === 'POST')!.body).toMatchObject({ users: [1, 3] })
    })

    test('results show name and email, and hide people who are already added', async ({ page }) => {
      await mockCommon(page)
      await page.goto('/admin/events/new')

      await page.getByLabel('Add people').fill('ann')
      const option = page.getByRole('button', { name: /Ann Lee/ })
      await expect(option).toContainText('ann@example.com')
      await option.click()

      await page.getByLabel('Add people').fill('ann')
      const results = page.getByRole('list', { name: 'Search results' })
      await expect(results.getByRole('button')).toHaveCount(1)
      await expect(results.getByRole('button', { name: /Anna Fox/ })).toBeVisible()
      await expect(results.getByRole('button', { name: /Ann Lee/ })).toHaveCount(0)
    })

    test('says so when nobody else matches', async ({ page }) => {
      await mockCommon(page)
      await page.goto('/admin/events/new')

      await page.getByLabel('Add people').fill('zzz')

      await expect(page.getByText('No one else matches “zzz”.')).toBeVisible()
    })

    test('removing a chip drops the person and sends the remaining ids', async ({ page }) => {
      await mockCommon(page)
      const posts = await mockApi(page, '/api/panel/events/', {
        GET: () => ({ body: pageOf([]) }),
        POST: ({ body }) => ({ status: 201, body: panelEvent({ ...(body as object) }) }),
      })
      await page.goto('/admin/events/new')

      for (const [query, name] of [
        ['ann@', /Ann Lee/],
        ['bob', /Bob Ray/],
      ] as const) {
        await page.getByLabel('Add people').fill(query)
        await page.getByRole('list', { name: 'Search results' }).getByRole('button', { name }).click()
      }
      const chips = page.getByRole('list', { name: 'Selected people' })
      await expect(chips.getByRole('listitem')).toHaveCount(2)

      await page.getByRole('button', { name: 'Remove Ann Lee' }).click()
      await expect(chips.getByRole('listitem')).toHaveCount(1)
      await expect(chips).not.toContainText('Ann Lee')

      await page.getByRole('button', { name: 'Remove Bob Ray' }).click()
      await expect(page.getByText('Nobody yet. Search below to add people.')).toBeVisible()

      await page.getByLabel('Add people').fill('bob')
      await page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: /Bob Ray/ }).click()
      await nameInput(page).fill('Just Bob')
      await startsInput(page).fill('2099-10-10T18:00')
      await page.getByRole('button', { name: 'Create event' }).click()

      await expect(page).toHaveURL(/\/admin\/events$/)
      expect(posts.find((c) => c.method === 'POST')!.body).toMatchObject({ users: [2] })
    })

    test('a user without a name is shown by email', async ({ page }) => {
      await mockCommon(page)
      await page.goto('/admin/events/new')

      await page.getByLabel('Add people').fill('noname')
      await page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: /noname@example.com/ }).click()

      await expect(page.getByRole('button', { name: 'Remove noname@example.com' })).toBeVisible()
    })

    test('shows a server error for the attendees', async ({ page }) => {
      await mockCommon(page)
      await mockApi(page, '/api/panel/events/', {
        POST: () => ({ status: 400, body: { users: ['Invalid pk "999" - object does not exist.'] } }),
      })
      await page.goto('/admin/events/new')
      await nameInput(page).fill('X')
      await startsInput(page).fill('2099-10-10T18:00')
      await page.getByRole('button', { name: 'Create event' }).click()

      await expect(page.getByText('Invalid pk "999" - object does not exist.')).toBeVisible()
      await expect(page.getByLabel('Add people')).toHaveAttribute('aria-invalid', 'true')
    })

    test('a failing user search shows no results instead of crashing', async ({ page }) => {
      await mockCommon(page)
      await mockApi(page, '/api/panel/users/', { GET: () => ({ status: 500, body: { detail: 'down' } }) })
      await page.goto('/admin/events/new')

      await page.getByLabel('Add people').fill('ann')

      await expect(page.getByText('No one else matches “ann”.')).toBeVisible()
    })
  })
})

test.describe('edit event', () => {
  const existing = panelEvent({
    id: 10,
    name: 'Jazz night',
    start_datetime: '2099-10-10T18:00:00Z',
    end_datetime: '2099-10-10T21:00:00Z',
    attendees: [attendee(1, 'Ann Lee', 'ann@example.com'), attendee(2, 'Bob Ray', 'bob@example.com')],
    updated_at: '2025-05-02T12:00:00Z',
  })

  test('loads the event into the form', async ({ page }) => {
    await mockCommon(page)
    await mockApi(page, '/api/panel/events/10/', { GET: () => ({ body: existing }) })
    await page.goto('/admin/events/10')

    await expect(page.getByRole('heading', { name: 'Edit event' })).toBeVisible()
    await expect(nameInput(page)).toHaveValue('Jazz night')
    await expect(startsInput(page)).toHaveValue('2099-10-10T18:00')
    await expect(endsInput(page)).toHaveValue('2099-10-10T21:00')
    const chips = page.getByRole('list', { name: 'Selected people' })
    await expect(chips).toContainText('Ann Lee')
    await expect(chips).toContainText('Bob Ray')
    await expect(page.getByText('Last updated May 2, 2025')).toBeVisible()
  })

  test('leaves Ends empty for an event without an end', async ({ page }) => {
    await mockCommon(page)
    await mockApi(page, '/api/panel/events/10/', {
      GET: () => ({ body: { ...existing, end_datetime: null, duration_minutes: null } }),
    })
    await page.goto('/admin/events/10')

    await expect(nameInput(page)).toHaveValue('Jazz night')
    await expect(endsInput(page)).toHaveValue('')
  })

  test('saves changes with PATCH and returns to the list', async ({ page }) => {
    await mockCommon(page)
    const patches = await mockApi(page, '/api/panel/events/10/', {
      GET: () => ({ body: existing }),
      PATCH: ({ body }) => ({ body: { ...existing, ...(body as object) } }),
    })
    await page.goto('/admin/events/10')
    await expect(nameInput(page)).toHaveValue('Jazz night')

    await nameInput(page).fill('Jazz brunch')
    await startsInput(page).fill('2099-10-10T11:00')
    await endsInput(page).fill('')
    await page.getByRole('button', { name: 'Remove Bob Ray' }).click()
    await page.getByLabel('Add people').fill('anna')
    await page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: /Anna Fox/ }).click()
    await page.getByRole('button', { name: 'Save changes' }).click()

    await expect(page).toHaveURL(/\/admin\/events$/)
    const patch = patches.find((c) => c.method === 'PATCH')!
    expect(patch.body).toEqual({
      name: 'Jazz brunch',
      start_datetime: '2099-10-10T11:00:00.000Z',
      end_datetime: null,
      users: [1, 3],
    })
  })

  test('shows validation errors from the server when saving', async ({ page }) => {
    await mockCommon(page)
    await mockApi(page, '/api/panel/events/10/', {
      GET: () => ({ body: existing }),
      PATCH: () => ({ status: 400, body: { end_datetime: ['The end must be after the start.'] } }),
    })
    await page.goto('/admin/events/10')
    await expect(nameInput(page)).toHaveValue('Jazz night')

    await endsInput(page).fill('2099-10-10T10:00')
    await page.getByRole('button', { name: 'Save changes' }).click()

    await expect(page.getByText('The end must be after the start.')).toBeVisible()
    await expect(endsInput(page)).toBeFocused()
    await expect(page).toHaveURL(/\/admin\/events\/10$/)
  })

  test('an unknown event shows the server error', async ({ page }) => {
    await mockCommon(page)
    await mockApi(page, '/api/panel/events/404/', {
      GET: () => ({ status: 404, body: { detail: 'No Event matches the given query.' } }),
    })
    await page.goto('/admin/events/404')

    await expect(page.getByRole('alert')).toHaveText('No Event matches the given query.')
  })

  test('shows a loading message until the event arrives', async ({ page }) => {
    await mockCommon(page)
    const gate = deferred()
    await mockApi(page, '/api/panel/events/10/', {
      GET: async () => {
        await gate.promise
        return { body: existing }
      },
    })
    await page.goto('/admin/events/10')

    await expect(page.getByText('Loading…')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
    gate.resolve()
    await expect(nameInput(page)).toHaveValue('Jazz night')
  })
})
