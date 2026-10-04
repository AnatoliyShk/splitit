import { expect, test } from '@playwright/test'
import { fakeStaff, fakeUser, json, mockHealth, mockMe } from './fixtures/auth'

test.describe('Home page content', () => {
  test.beforeEach(async ({ page }) => {
    await mockHealth(page)
    await mockMe(page, null)
    await page.goto('/')
  })

  test('shows the hero headline and tagline', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Go to occasions together\. Leave with friends/)
    await expect(page.getByText('Never go alone')).toBeVisible()
    await expect(page.getByText(/Find people heading to the same concerts/)).toBeVisible()
  })

  test('shows the Explore block instead of example occasions', async ({ page }) => {
    const promo = page.getByRole('region', { name: 'Explore occasions' })
    await expect(promo.getByText(/Accept an occasion to save your spot/)).toBeVisible()
    await expect(promo.getByRole('link', { name: 'Start exploring' })).toHaveAttribute('href', '/explore')
    await expect(page.getByText('This weekend')).toHaveCount(0)
  })

  test('Start exploring sends a logged-out visitor to log in first', async ({ page }) => {
    await page.getByRole('link', { name: 'Start exploring' }).click()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('shows the three how-it-works cards', async ({ page }) => {
    const cards = page.getByRole('region', { name: 'How it works' })
    await expect(cards.getByRole('heading', { level: 2 })).toHaveText(['Find occasions', 'Go together', 'Make friends'])
  })
})

test.describe('Home page call to action', () => {
  test('logged-out visitor sees the Create account link to /register', async ({ page }) => {
    await mockHealth(page)
    await mockMe(page, null)
    await page.goto('/')

    const link = page.getByRole('main').getByRole('link', { name: 'Create account' })
    await expect(link).toHaveAttribute('href', '/register')
    await link.click()
    await expect(page).toHaveURL(/\/register$/)
  })

  test('logged-in user does not see Create account', async ({ page }) => {
    await mockHealth(page)
    await mockMe(page, fakeUser)
    await page.goto('/')

    await expect(page.getByRole('button', { name: 'Find occasions' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Create account' })).toHaveCount(0)
  })
})

test.describe('App shell header', () => {
  test('logged-out shows Explore and Log in links but no Profile or Log out', async ({ page }) => {
    await mockHealth(page)
    await mockMe(page, null)
    await page.goto('/')

    const header = page.getByRole('banner')
    await expect(header.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
    await expect(header.getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/explore')
    await expect(header.getByRole('link', { name: 'Profile' })).toHaveCount(0)
    await expect(header.getByRole('button', { name: 'Log out' })).toHaveCount(0)
    await expect(header.getByRole('link', { name: 'Admin' })).toHaveCount(0)
  })

  test('Log in header link navigates to the login page', async ({ page }) => {
    await mockHealth(page)
    await mockMe(page, null)
    await page.goto('/')

    await page.getByRole('banner').getByRole('link', { name: 'Log in' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  test('header Log in link is hidden on the auth pages', async ({ page }) => {
    await mockHealth(page)
    await mockMe(page, null)
    await page.goto('/login')

    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await expect(page.getByRole('banner').getByRole('link', { name: 'Log in' })).toHaveCount(0)
  })

  test('logged-in user sees Profile link and Log out, but no Log in or Admin', async ({ page }) => {
    await mockHealth(page)
    await mockMe(page, fakeUser)
    await page.goto('/')

    const header = page.getByRole('banner')
    await expect(header.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile')
    await expect(header.getByRole('link', { name: 'Profile' })).toHaveAttribute('title', 'Logged in as Ana Smith')
    await expect(header.getByRole('button', { name: 'Log out' })).toBeVisible()
    await expect(header.getByRole('link', { name: 'Log in' })).toHaveCount(0)
    await expect(header.getByRole('link', { name: 'Admin' })).toHaveCount(0)
  })

  test('staff user sees the Admin link', async ({ page }) => {
    await mockHealth(page)
    await mockMe(page, fakeStaff)
    await page.goto('/')

    await expect(page.getByRole('banner').getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin')
  })

  test('Log out posts to the API and returns the header to the logged-out state', async ({ page }) => {
    await mockHealth(page)
    await mockMe(page, fakeUser)
    await page.context().addCookies([{ name: 'csrftoken', value: 'tok', url: 'http://localhost:5173' }])
    let csrfHeader: string | undefined
    await page.route('**/api/auth/logout/', (route) => {
      csrfHeader = route.request().headers()['x-csrftoken']
      return route.fulfill({ status: 204 })
    })
    await page.goto('/')

    await page.getByRole('button', { name: 'Log out' }).click()

    await expect(page.getByRole('banner').getByRole('link', { name: 'Log in' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0)
    expect(csrfHeader).toBe('tok')
  })

  test('failed logout keeps the user logged in', async ({ page }) => {
    await mockHealth(page)
    await mockMe(page, fakeUser)
    await page.context().addCookies([{ name: 'csrftoken', value: 'tok', url: 'http://localhost:5173' }])
    await page.route('**/api/auth/logout/', (route) => json(route, 500, { detail: 'boom' }))
    await page.goto('/')

    await page.getByRole('button', { name: 'Log out' }).click()

    await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
  })

  test('falls back to the logged-out header when /api/auth/me/ fails', async ({ page }) => {
    await mockHealth(page)
    await page.route('**/api/auth/me/', (route) => json(route, 500, { detail: 'error' }))
    await page.goto('/')

    await expect(page.getByRole('banner').getByRole('link', { name: 'Log in' })).toBeVisible()
    await expect(page.getByRole('banner').getByRole('link', { name: 'Profile' })).toHaveCount(0)
  })

  test('logo links back to the home page', async ({ page }) => {
    await mockHealth(page)
    await mockMe(page, null)
    await page.goto('/login')

    await page.getByRole('banner').getByRole('link', { name: /Splitit/ }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Go to occasions together')
  })
})

test.describe('App shell footer API status', () => {
  test('shows ok when the health endpoint responds ok', async ({ page }) => {
    await mockHealth(page, 'ok')
    await mockMe(page, null)
    await page.goto('/')

    await expect(page.getByText('API status: ok')).toBeVisible()
  })

  test('shows unreachable when the health endpoint cannot be reached', async ({ page }) => {
    await mockHealth(page, 'down')
    await mockMe(page, null)
    await page.goto('/')

    await expect(page.getByText('API status: unreachable')).toBeVisible()
  })
})
