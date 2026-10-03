import { expect, test } from '@playwright/test'
import { memberUser, mockApi, mockSession, pageOf, panelUser, staffUser } from './fixtures/panel'

test.describe('panel access', () => {
  test('logged-out visitor is sent to the login page', async ({ page }) => {
    await mockSession(page, null)
    await page.goto('/admin')

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Overview' })).toHaveCount(0)
  })

  test('logged-out visitor on a deep panel link is sent to the login page', async ({ page }) => {
    await mockSession(page, null)
    await page.goto('/admin/tags')

    await expect(page).toHaveURL(/\/login$/)
  })

  test('logged-out visitor never calls the panel API', async ({ page }) => {
    await mockSession(page, null)
    const calls = await mockApi(page, '/api/panel/stats/', { GET: () => ({ body: {} }) })
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/login$/)

    expect(calls).toHaveLength(0)
  })

  test('failed session check is treated as logged out', async ({ page }) => {
    await mockSession(page, null)
    await mockApi(page, '/api/auth/me/', { GET: () => ({ status: 500, body: { detail: 'boom' } }) })
    await page.goto('/admin')

    await expect(page).toHaveURL(/\/login$/)
  })

  test('logging in from the redirect brings a staff user back to the panel', async ({ page }) => {
    await mockSession(page, null)
    await mockApi(page, '/api/auth/login/', { POST: () => ({ body: { user: staffUser } }) })
    await mockApi(page, '/api/panel/stats/', {
      GET: () => ({
        body: {
          users: { total: 1, active: 1, staff: 1, new_this_week: 0 },
          events: { total: 0, upcoming: 0 },
          next_events: [],
        },
      }),
    })

    await page.goto('/admin')
    await page.getByLabel('Email').fill(staffUser.email)
    await page.getByLabel('Password').fill('secret-pass')
    await page.getByRole('button', { name: /log in/i }).last().click()

    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  })

  test('non-staff user sees the admins-only notice instead of the panel', async ({ page }) => {
    await mockSession(page, memberUser)
    await page.goto('/admin')

    await expect(page.getByRole('heading', { name: 'Admins only' })).toBeVisible()
    await expect(page.getByText(memberUser.email)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
    await expect(page.getByRole('navigation', { name: 'Admin sections' })).toHaveCount(0)
  })

  test('non-staff user is blocked on every panel sub-page', async ({ page }) => {
    await mockSession(page, memberUser)

    for (const path of ['/admin/users', '/admin/events', '/admin/events/new', '/admin/tags']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Admins only' })).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Admin sections' })).toHaveCount(0)
    }
  })

  test('non-staff user never calls the panel API', async ({ page }) => {
    await mockSession(page, memberUser)
    const users = await mockApi(page, '/api/panel/users/', { GET: () => ({ body: pageOf([panelUser()]) }) })
    const stats = await mockApi(page, '/api/panel/stats/', { GET: () => ({ body: {} }) })
    await page.goto('/admin/users')
    await expect(page.getByRole('heading', { name: 'Admins only' })).toBeVisible()

    expect(users).toHaveLength(0)
    expect(stats).toHaveLength(0)
  })

  test('non-staff user has no Admin link in the header', async ({ page }) => {
    await mockSession(page, memberUser)
    await page.goto('/')

    await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0)
  })

  test('"Back to home" leaves the notice', async ({ page }) => {
    await mockSession(page, memberUser)
    await page.goto('/admin')
    await page.getByRole('link', { name: 'Back to home' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Admins only' })).toHaveCount(0)
  })

  test('staff user sees the Admin link and the four panel tabs', async ({ page }) => {
    await mockSession(page, staffUser)
    await mockApi(page, '/api/panel/stats/', {
      GET: () => ({
        body: {
          users: { total: 1, active: 1, staff: 1, new_this_week: 0 },
          events: { total: 0, upcoming: 0 },
          next_events: [],
        },
      }),
    })
    await page.goto('/')
    await page.getByRole('link', { name: 'Admin', exact: true }).click()

    await expect(page).toHaveURL(/\/admin$/)
    const tabs = page.getByRole('navigation', { name: 'Admin sections' })
    for (const label of ['Overview', 'Users', 'Events', 'Tags']) {
      await expect(tabs.getByRole('link', { name: label })).toBeVisible()
    }
  })
})
