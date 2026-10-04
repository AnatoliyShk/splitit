import { expect, test, type Page } from '@playwright/test'
import { mockApi, mockStaffSession, paginate, panelUser, sessionUser, staffUser, type PanelUser } from './fixtures/panel'

test.use({ timezoneId: 'UTC', locale: 'en-US' })

// The logged-in admin (id 1) is part of the list so the "You" row shows up
const me = panelUser({
  id: staffUser.id,
  email: staffUser.email,
  name: staffUser.name,
  is_staff: true,
  occasions_count: 2,
})

function seed(): PanelUser[] {
  return [
    me,
    panelUser({ id: 2, email: 'ann@example.com', name: 'Ann Lee', occasions_count: 3, date_joined: '2025-03-15T09:00:00Z' }),
    panelUser({ id: 3, email: 'bob@example.com', name: 'Bob Ray', is_staff: true }),
    panelUser({ id: 4, email: 'cat@example.com', name: 'Cat Dee', is_active: false }),
    panelUser({ id: 5, email: 'root@example.com', name: 'Root Boss', is_staff: true, is_superuser: true }),
    panelUser({ id: 6, email: 'noname@example.com', name: '' }),
  ]
}

async function openUsers(page: Page, users = seed()) {
  const calls = await mockApi(page, '/api/panel/users/', {
    GET: ({ url }) => ({ body: paginate(users, url, (u) => [u.email, u.name]) }),
  })
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
  return { users, calls }
}

// PATCH /api/panel/users/<id>/ applies the change to the in-memory list and echoes the user back
function mockPatch(page: Page, users: PanelUser[]) {
  return mockApi(page, /^\/api\/panel\/users\/\d+\/$/, {
    PATCH: ({ url, body }) => {
      const user = users.find((u) => url.pathname === `/api/panel/users/${u.id}/`)!
      Object.assign(user, body)
      return { body: user }
    },
  })
}

const row = (page: Page, email: string) =>
  page.getByRole('row').filter({ hasText: email })

test.describe('panel users', () => {
  test.beforeEach(async ({ page }) => {
    await mockStaffSession(page)
  })

  test('lists users with name, email, join date, occasion count and total', async ({ page }) => {
    await openUsers(page)

    await expect(page.getByText('6 total')).toBeVisible()
    const ann = row(page, 'ann@example.com')
    await expect(ann).toContainText('Ann Lee')
    await expect(ann).toContainText('Mar 15, 2025')
    await expect(ann.getByRole('cell').nth(2)).toHaveText('3')
  })

  test('shows access badges for each kind of user', async ({ page }) => {
    await openUsers(page)

    await expect(row(page, staffUser.email)).toContainText('You')
    await expect(row(page, staffUser.email)).toContainText('Admin')
    await expect(row(page, 'ann@example.com')).toContainText('Member')
    await expect(row(page, 'bob@example.com')).toContainText('Admin')
    await expect(row(page, 'cat@example.com')).toContainText('Deactivated')
    await expect(row(page, 'root@example.com')).toContainText('Superuser')
  })

  test('shows a dash for users without a name', async ({ page }) => {
    await openUsers(page)

    await expect(row(page, 'noname@example.com').getByRole('strong')).toHaveText('—')
  })

  test('does not offer access buttons on your own row', async ({ page }) => {
    await openUsers(page)

    await expect(row(page, staffUser.email).getByRole('button')).toHaveCount(0)
  })

  test('does not offer access buttons on a superuser row for a non-superuser admin', async ({ page }) => {
    await openUsers(page)

    await expect(row(page, 'root@example.com').getByRole('button')).toHaveCount(0)
  })

  test('a superuser admin can manage other superusers', async ({ page }) => {
    await mockStaffSession(page, sessionUser({ is_superuser: true }))
    await openUsers(page)

    await expect(row(page, 'root@example.com').getByRole('button', { name: 'Remove admin' })).toBeVisible()
    await expect(row(page, staffUser.email).getByRole('button')).toHaveCount(0)
  })

  test('requests the first page with an empty search on load', async ({ page }) => {
    const { calls } = await openUsers(page)

    await expect(row(page, 'ann@example.com')).toBeVisible()
    expect(calls[0].url.searchParams.get('page')).toBe('1')
    expect(calls[0].url.searchParams.get('search')).toBe('')
  })

  test('searching filters the list by name or email', async ({ page }) => {
    const { calls } = await openUsers(page)

    await page.getByLabel('Search by name or email').fill('ann')

    await expect(page.getByRole('row').filter({ hasText: '@example.com' })).toHaveCount(1)
    await expect(row(page, 'ann@example.com')).toBeVisible()
    await expect(page.getByText('1 total')).toBeVisible()
    expect(calls.at(-1)!.url.searchParams.get('search')).toBe('ann')

    await page.getByLabel('Search by name or email').fill('bob@')
    await expect(row(page, 'bob@example.com')).toBeVisible()
    await expect(row(page, 'ann@example.com')).toHaveCount(0)
  })

  test('search with no match shows an empty message', async ({ page }) => {
    await openUsers(page)

    await page.getByLabel('Search by name or email').fill('zzz')

    await expect(page.getByText('No users match “zzz”.')).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
  })

  test('clearing the search brings the full list back', async ({ page }) => {
    await openUsers(page)
    const search = page.getByLabel('Search by name or email')

    await search.fill('zzz')
    await expect(page.getByText('No users match “zzz”.')).toBeVisible()
    await search.clear()

    await expect(page.getByRole('row').filter({ hasText: '@example.com' })).toHaveCount(6)
  })

  test('there is no pager when everything fits on one page', async ({ page }) => {
    await openUsers(page)

    await expect(page.getByRole('navigation', { name: 'Pagination' })).toHaveCount(0)
  })

  test.describe('pagination', () => {
    const many = () =>
      Array.from({ length: 45 }, (_, i) =>
        panelUser({ id: 200 + i, email: `person${i + 1}@example.com`, name: `Person ${i + 1}` }),
      )

    test('shows 20 users per page and pages through them', async ({ page }) => {
      const { calls } = await openUsers(page, many())
      const pager = page.getByRole('navigation', { name: 'Pagination' })

      await expect(page.getByText('45 total')).toBeVisible()
      await expect(pager.getByText('Page 1 of 3')).toBeVisible()
      await expect(page.getByRole('row').filter({ hasText: '@example.com' })).toHaveCount(20)
      await expect(row(page, 'person1@example.com')).toBeVisible()
      await expect(pager.getByRole('button', { name: 'Previous' })).toBeDisabled()

      await pager.getByRole('button', { name: 'Next' }).click()
      await expect(pager.getByText('Page 2 of 3')).toBeVisible()
      await expect(row(page, 'person21@example.com')).toBeVisible()
      await expect(row(page, 'person1@example.com')).toHaveCount(0)
      expect(calls.at(-1)!.url.searchParams.get('page')).toBe('2')

      await pager.getByRole('button', { name: 'Next' }).click()
      await expect(pager.getByText('Page 3 of 3')).toBeVisible()
      await expect(page.getByRole('row').filter({ hasText: '@example.com' })).toHaveCount(5)
      await expect(pager.getByRole('button', { name: 'Next' })).toBeDisabled()

      await pager.getByRole('button', { name: 'Previous' }).click()
      await expect(pager.getByText('Page 2 of 3')).toBeVisible()
    })

    test('a new search goes back to page 1', async ({ page }) => {
      const { calls } = await openUsers(page, many())
      const pager = page.getByRole('navigation', { name: 'Pagination' })

      await pager.getByRole('button', { name: 'Next' }).click()
      await expect(pager.getByText('Page 2 of 3')).toBeVisible()
      await page.getByLabel('Search by name or email').fill('person4')

      // person4, person40..person45 -> 7 matches, a single page
      await expect(page.getByText('7 total')).toBeVisible()
      await expect(pager).toHaveCount(0)
      const last = calls.at(-1)!.url.searchParams
      expect(last.get('search')).toBe('person4')
      expect(last.get('page')).toBe('1')
    })
  })

  test.describe('access toggles', () => {
    test('"Make admin" promotes a member', async ({ page }) => {
      const { users } = await openUsers(page)
      const patches = await mockPatch(page, users)

      const ann = row(page, 'ann@example.com')
      await expect(ann).toContainText('Member')
      await ann.getByRole('button', { name: 'Make admin' }).click()

      await expect(ann).toContainText('Admin')
      await expect(ann).not.toContainText('Member')
      await expect(ann.getByRole('button', { name: 'Remove admin' })).toBeVisible()
      expect(patches).toHaveLength(1)
      expect(patches[0].url.pathname).toBe('/api/panel/users/2/')
      expect(patches[0].body).toEqual({ is_staff: true })
    })

    test('"Remove admin" demotes an admin', async ({ page }) => {
      const { users } = await openUsers(page)
      const patches = await mockPatch(page, users)

      const bob = row(page, 'bob@example.com')
      await bob.getByRole('button', { name: 'Remove admin' }).click()

      await expect(bob).toContainText('Member')
      await expect(bob.getByRole('button', { name: 'Make admin' })).toBeVisible()
      expect(patches[0].body).toEqual({ is_staff: false })
    })

    test('"Deactivate" marks the user as deactivated', async ({ page }) => {
      const { users } = await openUsers(page)
      const patches = await mockPatch(page, users)

      const ann = row(page, 'ann@example.com')
      await ann.getByRole('button', { name: 'Deactivate' }).click()

      await expect(ann).toContainText('Deactivated')
      await expect(ann.getByRole('button', { name: 'Reactivate' })).toBeVisible()
      expect(patches[0].body).toEqual({ is_active: false })
    })

    test('"Reactivate" restores a deactivated user', async ({ page }) => {
      const { users } = await openUsers(page)
      const patches = await mockPatch(page, users)

      const cat = row(page, 'cat@example.com')
      await cat.getByRole('button', { name: 'Reactivate' }).click()

      await expect(cat).not.toContainText('Deactivated')
      await expect(cat.getByRole('button', { name: 'Deactivate' })).toBeVisible()
      expect(patches[0].body).toEqual({ is_active: true })
    })

    test('buttons are disabled while the change is in flight', async ({ page }) => {
      const { users } = await openUsers(page)
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      await mockApi(page, '/api/panel/users/2/', {
        PATCH: async ({ body }) => {
          await gate
          return { body: { ...users[1], ...(body as object) } }
        },
      })

      const ann = row(page, 'ann@example.com')
      await ann.getByRole('button', { name: 'Make admin' }).click()
      await expect(ann.getByRole('button', { name: 'Make admin' })).toBeDisabled()
      await expect(ann.getByRole('button', { name: 'Deactivate' })).toBeDisabled()

      release()
      await expect(ann.getByRole('button', { name: 'Remove admin' })).toBeEnabled()
    })

    test('a rejected change shows the server message and leaves the row unchanged', async ({ page }) => {
      await openUsers(page)
      await mockApi(page, '/api/panel/users/2/', {
        PATCH: () => ({ status: 403, body: { detail: 'You cannot change this user.' } }),
      })

      const ann = row(page, 'ann@example.com')
      await ann.getByRole('button', { name: 'Make admin' }).click()

      await expect(page.getByRole('alert')).toHaveText('You cannot change this user.')
      await expect(ann).toContainText('Member')
      await expect(ann.getByRole('button', { name: 'Make admin' })).toBeEnabled()
    })
  })

  test('shows an alert when the list fails to load', async ({ page }) => {
    await mockApi(page, '/api/panel/users/', { GET: () => ({ status: 500, body: { detail: 'Server error.' } }) })
    await page.goto('/admin/users')

    await expect(page.getByRole('alert')).toHaveText('Server error.')
    await expect(page.getByRole('table')).toHaveCount(0)
  })
})
