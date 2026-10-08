import { expect, test, type Page } from '@playwright/test'
import {
  attendee,
  deferred,
  mockApi,
  mockMedia,
  mockStaffSession,
  pageOf,
  paginate,
  panelOccasion,
  panelTag,
  panelUser,
  PNG,
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

const tags = [
  panelTag({ id: 1, name: 'Jazz', occasions_count: 3 }),
  panelTag({ id: 2, name: 'Jazz brunch', occasions_count: 1 }),
  panelTag({ id: 3, name: 'Hiking', occasions_count: 0 }),
]

// Every form test needs the user and tag searches (pickers) and the occasions list it returns to
async function mockCommon(page: Page) {
  await mockStaffSession(page)
  await mockApi(page, '/api/admin/tags/', { GET: ({ url }) => ({ body: paginate(tags, url, (tag) => [tag.name]) }) })
  const searches = await mockApi(page, '/api/admin/users/', {
    GET: ({ url }) => ({
      body: paginate(
        people.map((person) => panelUser({ ...person })),
        url,
        (panelUser) => [panelUser.name, panelUser.email],
      ),
    }),
  })
  await mockApi(page, '/api/admin/occasions/', {
    GET: () => ({ body: pageOf([panelOccasion({ id: 55, name: 'Saved occasion' })]) }),
  })
  return searches
}

const nameInput = (page: Page) => page.getByLabel('Name', { exact: true })
const startsInput = (page: Page) => page.getByLabel('Starts')
const endsInput = (page: Page) => page.getByLabel('Ends')

test.describe('new occasion', () => {
  test('starts as an empty form', async ({ page }) => {
    await mockCommon(page)
    await page.goto('/admin/occasions/new')

    await expect(page.getByRole('heading', { name: 'New occasion' })).toBeVisible()
    await expect(nameInput(page)).toHaveValue('')
    await expect(startsInput(page)).toHaveValue('')
    await expect(endsInput(page)).toHaveValue('')
    await expect(page.getByText('Nobody yet. Search below to add people.')).toBeVisible()
    await expect(page.getByText('Your time zone: UTC')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create occasion' })).toBeEnabled()
  })

  test('creates an occasion and returns to the list', async ({ page }) => {
    await mockCommon(page)
    const posts = await mockApi(page, '/api/admin/occasions/', {
      GET: () => ({ body: pageOf([panelOccasion({ id: 55, name: 'Saved occasion' })]) }),
      POST: ({ body }) => ({ status: 201, body: panelOccasion({ id: 77, ...(body as object) }) }),
    })
    await page.goto('/admin/occasions/new')

    await nameInput(page).fill('Board game night')
    await page.getByLabel('Description (optional)').fill('Bring your favourite game.\nSnacks provided.')
    await startsInput(page).fill('2099-10-10T18:00')
    await endsInput(page).fill('2099-10-10T21:30')
    await page.getByRole('button', { name: 'Create occasion' }).click()

    await expect(page).toHaveURL(/\/admin\/occasions$/)
    await expect(page.getByRole('heading', { name: 'Occasions' })).toBeVisible()
    const postCall = posts.find((call) => call.method === 'POST')!
    expect(postCall.body).toEqual({
      name: 'Board game night',
      description: 'Bring your favourite game.\nSnacks provided.',
      start_datetime: '2099-10-10T18:00:00.000Z',
      end_datetime: '2099-10-10T21:30:00.000Z',
      users: [],
      tag_ids: [],
    })
  })

  test('creates an occasion with no end time', async ({ page }) => {
    await mockCommon(page)
    const posts = await mockApi(page, '/api/admin/occasions/', {
      GET: () => ({ body: pageOf([]) }),
      POST: ({ body }) => ({ status: 201, body: panelOccasion({ id: 77, ...(body as object) }) }),
    })
    await page.goto('/admin/occasions/new')

    await nameInput(page).fill('Open mic')
    await startsInput(page).fill('2099-11-02T19:30')
    await page.getByRole('button', { name: 'Create occasion' }).click()

    await expect(page).toHaveURL(/\/admin\/occasions$/)
    expect(posts.find((call) => call.method === 'POST')!.body).toMatchObject({
      name: 'Open mic',
      start_datetime: '2099-11-02T19:30:00.000Z',
      end_datetime: null,
    })
  })

  test('the Ends field constrains its minimum to the start', async ({ page }) => {
    await mockCommon(page)
    await page.goto('/admin/occasions/new')

    await startsInput(page).fill('2099-10-10T18:00')

    await expect(endsInput(page)).toHaveAttribute('min', '2099-10-10T18:00')
  })

  test('Cancel and the back link return to the list without saving', async ({ page }) => {
    await mockCommon(page)
    const posts = await mockApi(page, '/api/admin/occasions/', {
      GET: () => ({ body: pageOf([]) }),
      POST: () => ({ status: 201, body: panelOccasion() }),
    })
    await page.goto('/admin/occasions/new')
    await nameInput(page).fill('Never saved')
    await page.getByRole('link', { name: 'Cancel' }).click()

    await expect(page).toHaveURL(/\/admin\/occasions$/)
    expect(posts.filter((call) => call.method === 'POST')).toHaveLength(0)

    await page.goto('/admin/occasions/new')
    await page.getByRole('link', { name: '← Occasions' }).click()
    await expect(page).toHaveURL(/\/admin\/occasions$/)
  })

  test.describe('validation errors', () => {
    test('end before start shows the server error on the Ends field and focuses it', async ({ page }) => {
      await mockCommon(page)
      await mockApi(page, '/api/admin/occasions/', {
        POST: () => ({ status: 400, body: { end_datetime: ['The end must be after the start.'] } }),
      })
      await page.goto('/admin/occasions/new')

      await nameInput(page).fill('Backwards')
      await startsInput(page).fill('2099-10-10T18:00')
      await endsInput(page).fill('2099-10-10T17:00')
      await page.getByRole('button', { name: 'Create occasion' }).click()

      await expect(page.getByText('The end must be after the start.')).toBeVisible()
      await expect(endsInput(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(endsInput(page)).toBeFocused()
      await expect(endsInput(page)).toHaveAccessibleDescription(/The end must be after the start\./)
      // Stays on the form, and what was typed is kept
      await expect(page).toHaveURL(/\/admin\/occasions\/new$/)
      await expect(nameInput(page)).toHaveValue('Backwards')
      await expect(page.getByRole('button', { name: 'Create occasion' })).toBeEnabled()
    })

    test('sends end-before-start as typed so the server decides', async ({ page }) => {
      await mockCommon(page)
      const posts = await mockApi(page, '/api/admin/occasions/', {
        POST: () => ({ status: 400, body: { end_datetime: ['The end must be after the start.'] } }),
      })
      await page.goto('/admin/occasions/new')

      await nameInput(page).fill('Backwards')
      await startsInput(page).fill('2099-10-10T18:00')
      await endsInput(page).fill('2099-10-10T17:00')
      await page.getByRole('button', { name: 'Create occasion' }).click()

      await expect(page.getByText('The end must be after the start.')).toBeVisible()
      expect(posts).toHaveLength(1)
      expect(posts[0].body).toMatchObject({
        start_datetime: '2099-10-10T18:00:00.000Z',
        end_datetime: '2099-10-10T17:00:00.000Z',
      })
    })

    test('missing name and start show field errors and focus the first invalid field', async ({ page }) => {
      await mockCommon(page)
      await mockApi(page, '/api/admin/occasions/', {
        POST: () => ({
          status: 400,
          body: { name: ['This field may not be blank.'], start_datetime: ['This field may not be null.'] },
        }),
      })
      await page.goto('/admin/occasions/new')
      await page.getByRole('button', { name: 'Create occasion' }).click()

      await expect(page.getByText('This field may not be blank.')).toBeVisible()
      await expect(page.getByText('This field may not be null.')).toBeVisible()
      await expect(nameInput(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(startsInput(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(nameInput(page)).toBeFocused()
    })

    test('a form-wide error shows as an alert', async ({ page }) => {
      await mockCommon(page)
      await mockApi(page, '/api/admin/occasions/', {
        POST: () => ({ status: 403, body: { detail: 'You do not have permission.' } }),
      })
      await page.goto('/admin/occasions/new')
      await nameInput(page).fill('X')
      await startsInput(page).fill('2099-10-10T18:00')
      await page.getByRole('button', { name: 'Create occasion' }).click()

      await expect(page.getByRole('alert')).toHaveText('You do not have permission.')
    })

    test('errors clear on the next submit', async ({ page }) => {
      await mockCommon(page)
      let attempt = 0
      await mockApi(page, '/api/admin/occasions/', {
        GET: () => ({ body: pageOf([]) }),
        POST: ({ body }) => {
          attempt += 1
          return attempt === 1
            ? { status: 400, body: { name: ['This field may not be blank.'] } }
            : { status: 201, body: panelOccasion({ ...(body as object) }) }
        },
      })
      await page.goto('/admin/occasions/new')
      await startsInput(page).fill('2099-10-10T18:00')
      await page.getByRole('button', { name: 'Create occasion' }).click()
      await expect(page.getByText('This field may not be blank.')).toBeVisible()

      await nameInput(page).fill('Fixed')
      await page.getByRole('button', { name: 'Create occasion' }).click()

      await expect(page).toHaveURL(/\/admin\/occasions$/)
    })

    test('the save button shows a busy state while saving', async ({ page }) => {
      await mockCommon(page)
      const gate = deferred()
      await mockApi(page, '/api/admin/occasions/', {
        GET: () => ({ body: pageOf([]) }),
        POST: async ({ body }) => {
          await gate.promise
          return { status: 201, body: panelOccasion({ ...(body as object) }) }
        },
      })
      await page.goto('/admin/occasions/new')
      await nameInput(page).fill('Slow')
      await startsInput(page).fill('2099-10-10T18:00')
      await page.getByRole('button', { name: 'Create occasion' }).click()

      await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled()
      gate.resolve()
      await expect(page).toHaveURL(/\/admin\/occasions$/)
    })
  })

  test.describe('attendee picker', () => {
    test('searches users, adds them as chips and sends their ids', async ({ page }) => {
      const searches = await mockCommon(page)
      const posts = await mockApi(page, '/api/admin/occasions/', {
        GET: () => ({ body: pageOf([]) }),
        POST: ({ body }) => ({ status: 201, body: panelOccasion({ ...(body as object) }) }),
      })
      await page.goto('/admin/occasions/new')

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
      await page.getByRole('button', { name: 'Create occasion' }).click()

      await expect(page).toHaveURL(/\/admin\/occasions$/)
      expect(posts.find((call) => call.method === 'POST')!.body).toMatchObject({ users: [1, 3] })
    })

    test('results show name and email, and hide people who are already added', async ({ page }) => {
      await mockCommon(page)
      await page.goto('/admin/occasions/new')

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
      await page.goto('/admin/occasions/new')

      await page.getByLabel('Add people').fill('zzz')

      await expect(page.getByText('No one else matches “zzz”.')).toBeVisible()
    })

    test('removing a chip drops the person and sends the remaining ids', async ({ page }) => {
      await mockCommon(page)
      const posts = await mockApi(page, '/api/admin/occasions/', {
        GET: () => ({ body: pageOf([]) }),
        POST: ({ body }) => ({ status: 201, body: panelOccasion({ ...(body as object) }) }),
      })
      await page.goto('/admin/occasions/new')

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
      await page.getByRole('button', { name: 'Create occasion' }).click()

      await expect(page).toHaveURL(/\/admin\/occasions$/)
      expect(posts.find((call) => call.method === 'POST')!.body).toMatchObject({ users: [2] })
    })

    test('a user without a name is shown by email', async ({ page }) => {
      await mockCommon(page)
      await page.goto('/admin/occasions/new')

      await page.getByLabel('Add people').fill('noname')
      await page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: /noname@example.com/ }).click()

      await expect(page.getByRole('button', { name: 'Remove noname@example.com' })).toBeVisible()
    })

    test('shows a server error for the attendees', async ({ page }) => {
      await mockCommon(page)
      await mockApi(page, '/api/admin/occasions/', {
        POST: () => ({ status: 400, body: { users: ['Invalid pk "999" - object does not exist.'] } }),
      })
      await page.goto('/admin/occasions/new')
      await nameInput(page).fill('X')
      await startsInput(page).fill('2099-10-10T18:00')
      await page.getByRole('button', { name: 'Create occasion' }).click()

      await expect(page.getByText('Invalid pk "999" - object does not exist.')).toBeVisible()
      await expect(page.getByLabel('Add people')).toHaveAttribute('aria-invalid', 'true')
    })

    test('a failing user search shows no results instead of crashing', async ({ page }) => {
      await mockCommon(page)
      await mockApi(page, '/api/admin/users/', { GET: () => ({ status: 500, body: { detail: 'down' } }) })
      await page.goto('/admin/occasions/new')

      await page.getByLabel('Add people').fill('ann')

      await expect(page.getByText('No one else matches “ann”.')).toBeVisible()
    })
  })

  test.describe('tag picker', () => {
    test('searches tags, adds them as chips and sends their ids', async ({ page }) => {
      await mockCommon(page)
      const posts = await mockApi(page, '/api/admin/occasions/', {
        GET: () => ({ body: pageOf([]) }),
        POST: ({ body }) => ({ status: 201, body: panelOccasion({ ...(body as object) }) }),
      })
      await page.goto('/admin/occasions/new')
      await expect(page.getByText('No tags yet. Search below to add some.')).toBeVisible()

      await page.getByLabel('Add tags').fill('jazz')
      const results = page.getByRole('list', { name: 'Matching tags' })
      await expect(results.getByRole('button')).toHaveCount(2)
      // Each result says how many occasions use it
      await expect(results.getByRole('button', { name: /Jazz brunch/ })).toContainText('1 occasion')
      await results.getByRole('button', { name: /^Jazz 3 occasions$/ }).click()

      const chips = page.getByRole('list', { name: 'Selected tags' })
      await expect(chips.getByRole('listitem')).toHaveCount(1)
      await expect(page.getByLabel('Add tags')).toHaveValue('')
      await expect(results).toHaveCount(0)

      // Added tags drop out of the results
      await page.getByLabel('Add tags').fill('jazz')
      await expect(results.getByRole('button')).toHaveCount(1)
      await results.getByRole('button', { name: /Jazz brunch/ }).click()
      await expect(chips.getByRole('listitem')).toHaveCount(2)

      await page.getByRole('button', { name: 'Remove tag Jazz', exact: true }).click()
      await expect(chips.getByRole('listitem')).toHaveCount(1)

      await nameInput(page).fill('Brunch')
      await startsInput(page).fill('2099-10-10T11:00')
      await page.getByRole('button', { name: 'Create occasion' }).click()

      await expect(page).toHaveURL(/\/admin\/occasions$/)
      expect(posts.find((call) => call.method === 'POST')!.body).toMatchObject({ tag_ids: [2] })
    })

    test('says so when no other tag matches', async ({ page }) => {
      await mockCommon(page)
      await page.goto('/admin/occasions/new')

      await page.getByLabel('Add tags').fill('zzz')

      await expect(page.getByText('No other tags match “zzz”.')).toBeVisible()
    })

    test('shows a server error for the tags', async ({ page }) => {
      await mockCommon(page)
      await mockApi(page, '/api/admin/occasions/', {
        POST: () => ({ status: 400, body: { tag_ids: ['Invalid pk "999" - object does not exist.'] } }),
      })
      await page.goto('/admin/occasions/new')
      await nameInput(page).fill('X')
      await startsInput(page).fill('2099-10-10T18:00')
      await page.getByRole('button', { name: 'Create occasion' }).click()

      await expect(page.getByText('Invalid pk "999" - object does not exist.')).toBeVisible()
      await expect(page.getByLabel('Add tags')).toHaveAttribute('aria-invalid', 'true')
    })
  })
})

test.describe('edit occasion', () => {
  const existing = panelOccasion({
    id: 10,
    name: 'Jazz night',
    description: 'Live trio, two sets.',
    start_datetime: '2099-10-10T18:00:00Z',
    end_datetime: '2099-10-10T21:00:00Z',
    attendees: [attendee(1, 'Ann Lee', 'ann@example.com'), attendee(2, 'Bob Ray', 'bob@example.com')],
    tags: [{ id: 1, name: 'Jazz' }],
    updated_at: '2025-05-02T12:00:00Z',
  })

  test('loads the occasion into the form', async ({ page }) => {
    await mockCommon(page)
    await mockApi(page, '/api/admin/occasions/10/', { GET: () => ({ body: existing }) })
    await page.goto('/admin/occasions/10')

    await expect(page.getByRole('heading', { name: 'Edit occasion' })).toBeVisible()
    await expect(nameInput(page)).toHaveValue('Jazz night')
    await expect(page.getByLabel('Description (optional)')).toHaveValue('Live trio, two sets.')
    await expect(startsInput(page)).toHaveValue('2099-10-10T18:00')
    await expect(endsInput(page)).toHaveValue('2099-10-10T21:00')
    const chips = page.getByRole('list', { name: 'Selected people' })
    await expect(chips).toContainText('Ann Lee')
    await expect(chips).toContainText('Bob Ray')
    await expect(page.getByRole('list', { name: 'Selected tags' })).toHaveText(/Jazz/)
    await expect(page.getByText('Last updated May 2, 2025')).toBeVisible()
  })

  test('leaves Ends empty for an occasion without an end', async ({ page }) => {
    await mockCommon(page)
    await mockApi(page, '/api/admin/occasions/10/', {
      GET: () => ({ body: { ...existing, end_datetime: null, duration_minutes: null } }),
    })
    await page.goto('/admin/occasions/10')

    await expect(nameInput(page)).toHaveValue('Jazz night')
    await expect(endsInput(page)).toHaveValue('')
  })

  test('saves changes with PATCH and returns to the list', async ({ page }) => {
    await mockCommon(page)
    const patches = await mockApi(page, '/api/admin/occasions/10/', {
      GET: () => ({ body: existing }),
      PATCH: ({ body }) => ({ body: { ...existing, ...(body as object) } }),
    })
    await page.goto('/admin/occasions/10')
    await expect(nameInput(page)).toHaveValue('Jazz night')

    await nameInput(page).fill('Jazz brunch')
    await page.getByLabel('Description (optional)').fill('')
    await startsInput(page).fill('2099-10-10T11:00')
    await endsInput(page).fill('')
    await page.getByRole('button', { name: 'Remove Bob Ray' }).click()
    await page.getByLabel('Add people').fill('anna')
    await page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: /Anna Fox/ }).click()
    await page.getByLabel('Add tags').fill('hik')
    await page.getByRole('list', { name: 'Matching tags' }).getByRole('button', { name: /Hiking/ }).click()
    await page.getByRole('button', { name: 'Save changes' }).click()

    await expect(page).toHaveURL(/\/admin\/occasions$/)
    const patchCall = patches.find((call) => call.method === 'PATCH')!
    expect(patchCall.body).toEqual({
      name: 'Jazz brunch',
      // Cleared, so it's sent empty
      description: '',
      start_datetime: '2099-10-10T11:00:00.000Z',
      end_datetime: null,
      users: [1, 3],
      tag_ids: [1, 3],
    })
  })

  test('shows validation errors from the server when saving', async ({ page }) => {
    await mockCommon(page)
    await mockApi(page, '/api/admin/occasions/10/', {
      GET: () => ({ body: existing }),
      PATCH: () => ({ status: 400, body: { end_datetime: ['The end must be after the start.'] } }),
    })
    await page.goto('/admin/occasions/10')
    await expect(nameInput(page)).toHaveValue('Jazz night')

    await endsInput(page).fill('2099-10-10T10:00')
    await page.getByRole('button', { name: 'Save changes' }).click()

    await expect(page.getByText('The end must be after the start.')).toBeVisible()
    await expect(endsInput(page)).toBeFocused()
    await expect(page).toHaveURL(/\/admin\/occasions\/10$/)
  })

  test('an unknown occasion shows the server error', async ({ page }) => {
    await mockCommon(page)
    await mockApi(page, '/api/admin/occasions/404/', {
      GET: () => ({ status: 404, body: { detail: 'No Occasion matches the given query.' } }),
    })
    await page.goto('/admin/occasions/404')

    await expect(page.getByRole('alert')).toHaveText('No Occasion matches the given query.')
  })

  test('shows a loading message until the occasion arrives', async ({ page }) => {
    await mockCommon(page)
    const gate = deferred()
    await mockApi(page, '/api/admin/occasions/10/', {
      GET: async () => {
        await gate.promise
        return { body: existing }
      },
    })
    await page.goto('/admin/occasions/10')

    await expect(page.getByText('Loading…')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
    gate.resolve()
    await expect(nameInput(page)).toHaveValue('Jazz night')
  })
})

test.describe('images', () => {
  const existing = panelOccasion({
    id: 10,
    name: 'Jazz night',
    images: [
      { order: 0, url: '/media/occasions/10/main.png' },
      { order: 1, url: '/media/occasions/10/one.png' },
    ],
  })
  const png = (name = 'photo.png') => ({ name, mimeType: 'image/png', buffer: PNG })
  const slot = (page: Page, label: string) => page.getByRole('group', { name: label, exact: true })

  async function openEdit(page: Page) {
    await mockCommon(page)
    await mockMedia(page)
    await mockApi(page, '/api/admin/occasions/10/', {
      GET: () => ({ body: existing }),
      PATCH: () => ({ body: existing }),
    })
    const uploads = await mockApi(page, '/api/admin/occasions/10/images/', {
      POST: () => ({ status: 201, body: existing }),
    })
    const deletes = await mockApi(page, /^\/api\/admin\/occasions\/10\/images\/\d+\/$/, {
      DELETE: () => ({ body: existing }),
    })
    await page.goto('/admin/occasions/10')
    await expect(nameInput(page)).toHaveValue('Jazz night')
    return { uploads, deletes }
  }

  test('shows saved images in their slots and empty slots as such', async ({ page }) => {
    await openEdit(page)

    await expect(slot(page, 'Main image').getByRole('img', { name: 'Main image preview' })).toHaveAttribute(
      'src',
      '/media/occasions/10/main.png',
    )
    await expect(slot(page, 'Gallery 1').getByRole('img')).toBeVisible()
    await expect(slot(page, 'Gallery 2').getByText('No image')).toBeVisible()
    await expect(slot(page, 'Gallery 3').getByText('No image')).toBeVisible()
    await expect(page.getByText('Changes are saved with the form.')).toBeVisible()
  })

  test('nothing is uploaded until the form is saved', async ({ page }) => {
    const { uploads } = await openEdit(page)

    await page.getByLabel('Add gallery 2').setInputFiles(png())
    await expect(slot(page, 'Gallery 2').getByText('Unsaved')).toBeVisible()
    await expect(slot(page, 'Gallery 2').getByRole('img', { name: 'Gallery 2 preview' })).toHaveAttribute(
      'src',
      /^blob:/,
    )
    expect(uploads).toHaveLength(0)
  })

  test('saving uploads a new image into its slot as multipart', async ({ page }) => {
    const { uploads, deletes } = await openEdit(page)

    await page.getByLabel('Replace main image').setInputFiles(png('cover.png'))
    await page.getByRole('button', { name: 'Save changes' }).click()

    await expect(page).toHaveURL(/\/admin\/occasions$/)
    expect(uploads).toHaveLength(1)
    expect(uploads[0].raw).toMatch(/name="order"\r\n\r\n0\r\n/)
    expect(uploads[0].raw).toContain('filename="cover.png"')
    expect(deletes).toHaveLength(0)
  })

  test('saving deletes a removed image', async ({ page }) => {
    const { uploads, deletes } = await openEdit(page)

    await page.getByRole('button', { name: 'Remove gallery 1' }).click()
    await expect(slot(page, 'Gallery 1').getByText('No image')).toBeVisible()
    await page.getByRole('button', { name: 'Save changes' }).click()

    await expect(page).toHaveURL(/\/admin\/occasions$/)
    expect(deletes.map((call) => call.url.pathname)).toEqual(['/api/admin/occasions/10/images/1/'])
    expect(uploads).toHaveLength(0)
  })

  test('Undo puts the saved image back', async ({ page }) => {
    const { uploads, deletes } = await openEdit(page)

    await page.getByRole('button', { name: 'Remove main image' }).click()
    await page.getByRole('button', { name: 'Undo main image change' }).click()
    await expect(slot(page, 'Main image').getByRole('img')).toHaveAttribute('src', '/media/occasions/10/main.png')
    await expect(slot(page, 'Main image').getByText('Unsaved')).toHaveCount(0)

    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page).toHaveURL(/\/admin\/occasions$/)
    expect(uploads).toHaveLength(0)
    expect(deletes).toHaveLength(0)
  })

  test('removing a picked file from an empty slot just clears it', async ({ page }) => {
    await openEdit(page)

    await page.getByLabel('Add gallery 3').setInputFiles(png())
    await page.getByRole('button', { name: 'Remove gallery 3' }).click()
    await expect(slot(page, 'Gallery 3').getByText('No image')).toBeVisible()
    await expect(slot(page, 'Gallery 3').getByText('Unsaved')).toHaveCount(0)
  })

  test('refuses files that are not JPEG, PNG or WebP before uploading', async ({ page }) => {
    const { uploads } = await openEdit(page)

    await page.getByLabel('Add gallery 2').setInputFiles({ name: 'anim.gif', mimeType: 'image/gif', buffer: PNG })
    await expect(slot(page, 'Gallery 2').getByText('Use a JPEG, PNG or WebP image.')).toBeVisible()
    await expect(slot(page, 'Gallery 2').getByText('No image')).toBeVisible()

    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page).toHaveURL(/\/admin\/occasions$/)
    expect(uploads).toHaveLength(0)
  })

  test('refuses images over 5 MB before uploading', async ({ page }) => {
    await openEdit(page)

    await page.getByLabel('Add gallery 2').setInputFiles({
      name: 'huge.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
    })
    await expect(slot(page, 'Gallery 2').getByText('The image must be 5 MB or smaller.')).toBeVisible()
  })

  test('a new occasion is created first, then its images go to the new id', async ({ page }) => {
    await mockCommon(page)
    const posts = await mockApi(page, '/api/admin/occasions/', {
      GET: () => ({ body: pageOf([]) }),
      POST: ({ body }) => ({ status: 201, body: panelOccasion({ id: 77, ...(body as object) }) }),
    })
    const uploads = await mockApi(page, '/api/admin/occasions/77/images/', {
      POST: () => ({ status: 201, body: panelOccasion({ id: 77 }) }),
    })
    await page.goto('/admin/occasions/new')

    await nameInput(page).fill('Board game night')
    await startsInput(page).fill('2099-10-10T18:00')
    await page.getByLabel('Add main image').setInputFiles(png('main.png'))
    await page.getByLabel('Add gallery 1').setInputFiles(png('one.png'))
    await page.getByRole('button', { name: 'Create occasion' }).click()

    await expect(page).toHaveURL(/\/admin\/occasions$/)
    expect(posts.filter((call) => call.method === 'POST')).toHaveLength(1)
    expect(uploads.map((call) => call.raw!.match(/name="order"\r\n\r\n(\d)/)![1])).toEqual(['0', '1'])
  })

  test('a failed upload keeps the form open, and saving again updates the created occasion', async ({ page }) => {
    await mockCommon(page)
    const posts = await mockApi(page, '/api/admin/occasions/', {
      GET: () => ({ body: pageOf([]) }),
      POST: ({ body }) => ({ status: 201, body: panelOccasion({ id: 77, ...(body as object) }) }),
    })
    const patches = await mockApi(page, '/api/admin/occasions/77/', {
      PATCH: ({ body }) => ({ body: panelOccasion({ id: 77, ...(body as object) }) }),
    })
    let fail = true
    await mockApi(page, '/api/admin/occasions/77/images/', {
      POST: () =>
        fail
          ? { status: 400, body: { image: ['Upload a valid image.'] } }
          : { status: 201, body: panelOccasion({ id: 77, images: [{ order: 0, url: '/media/x.png' }] }) },
    })
    await page.goto('/admin/occasions/new')

    await nameInput(page).fill('Board game night')
    await startsInput(page).fill('2099-10-10T18:00')
    await page.getByLabel('Add main image').setInputFiles(png())
    await page.getByRole('button', { name: 'Create occasion' }).click()

    await expect(page.getByRole('alert')).toHaveText(
      'The occasion was saved, but some images weren’t. Fix them and save again.',
    )
    await expect(slot(page, 'Main image').getByText('Upload a valid image.')).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/occasions\/new$/)

    fail = false
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page).toHaveURL(/\/admin\/occasions$/)
    expect(posts.filter((call) => call.method === 'POST')).toHaveLength(1)
    expect(patches).toHaveLength(1)
  })
})
