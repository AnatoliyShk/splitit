import { expect, test, type Page } from '@playwright/test'
import { fakeUser, json, mockCsrf, mockHealth, mockMe, setCsrfCookie } from './fixtures/auth'

async function fillAndSubmit(page: Page, email: string, password: string) {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

test.beforeEach(async ({ page }) => {
  await mockHealth(page)
  await mockMe(page, null)
})

test.describe('Login page', () => {
  test('renders the form with email and password fields', async ({ page }) => {
    await page.goto('/login')

    await expect(page).toHaveTitle('Log in · Splitit')
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveAttribute('type', 'email')
    await expect(page.getByLabel('Password')).toHaveAttribute('type', 'password')
    await expect(page.getByRole('button', { name: 'Log in' })).toBeEnabled()
  })

  test('tabs switch between the login and register pages', async ({ page }) => {
    await page.goto('/login')

    const tabs = page.getByRole('navigation', { name: 'Account' })
    await tabs.getByRole('link', { name: 'Create account' }).click()
    await expect(page).toHaveURL(/\/register$/)
    await expect(page.getByRole('heading', { name: 'Never go alone' })).toBeVisible()

    await tabs.getByRole('link', { name: 'Log in' }).click()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('already logged-in visitor is redirected to the home page', async ({ page }) => {
    await mockMe(page, fakeUser) // registered later than beforeEach, so it takes precedence
    await page.goto('/login')

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Go to occasions together')
  })
})

test.describe('Login success', () => {
  test('posts credentials as JSON with the CSRF header and redirects home', async ({ page }) => {
    await setCsrfCookie(page, 'abc123')
    let body: unknown
    let csrfHeader: string | undefined
    await page.route('**/api/auth/login/', (route) => {
      body = route.request().postDataJSON()
      csrfHeader = route.request().headers()['x-csrftoken']
      expect(route.request().method()).toBe('POST')
      return json(route, 200, { user: fakeUser })
    })
    await page.goto('/login')

    await fillAndSubmit(page, 'ana@example.com', 'correct horse')

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
    expect(body).toEqual({ email: 'ana@example.com', password: 'correct horse' })
    expect(csrfHeader).toBe('abc123')
  })

  test('returns to the page that required login', async ({ page }) => {
    await page.route('**/api/occasions/explore/', (route) => json(route, 200, []))
    await page.route('**/api/auth/login/', (route) => json(route, 200, { user: fakeUser }))
    await page.goto('/explore')
    await expect(page).toHaveURL(/\/login$/)

    await fillAndSubmit(page, 'ana@example.com', 'correct horse')

    await expect(page).toHaveURL(/\/explore$/)
  })

  test('disables the submit button and shows progress while the request is pending', async ({ page }) => {
    await setCsrfCookie(page)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    await page.route('**/api/auth/login/', async (route) => {
      await gate
      await json(route, 200, { user: fakeUser })
    })
    await page.goto('/login')

    await page.getByLabel('Email').fill('ana@example.com')
    await page.getByLabel('Password').fill('correct horse')
    await page.getByRole('button', { name: 'Log in' }).click()

    await expect(page.getByRole('button', { name: 'Logging in…' })).toBeDisabled()
    release()
    await expect(page).toHaveURL(/\/$/)
  })
})

test.describe('Login CSRF', () => {
  test('fetches /api/auth/csrf/ before logging in when the cookie is missing', async ({ page }) => {
    const order: string[] = []
    await page.route('**/api/auth/csrf/', (route) => {
      order.push('csrf')
      return route.fulfill({ status: 204 })
    })
    await page.route('**/api/auth/login/', (route) => {
      order.push('login')
      return json(route, 200, { user: fakeUser })
    })
    await page.goto('/login')

    await fillAndSubmit(page, 'ana@example.com', 'correct horse')

    await expect(page).toHaveURL(/\/$/)
    expect(order).toEqual(['csrf', 'login'])
  })

  test('does not fetch /api/auth/csrf/ when the csrftoken cookie already exists', async ({ page }) => {
    await setCsrfCookie(page)
    const csrf = await mockCsrf(page)
    await page.route('**/api/auth/login/', (route) => json(route, 200, { user: fakeUser }))
    await page.goto('/login')

    await fillAndSubmit(page, 'ana@example.com', 'correct horse')

    await expect(page).toHaveURL(/\/$/)
    expect(csrf.count).toBe(0)
  })

  test('shows a connection error when the CSRF request fails', async ({ page }) => {
    await page.route('**/api/auth/csrf/', (route) => route.abort('connectionrefused'))
    await page.goto('/login')

    await fillAndSubmit(page, 'ana@example.com', 'correct horse')

    await expect(page.getByRole('alert')).toHaveText(/Can't reach the server/)
    await expect(page.getByRole('button', { name: 'Log in' })).toBeEnabled()
  })
})

test.describe('Login errors', () => {
  test.beforeEach(async ({ page }) => {
    await setCsrfCookie(page)
  })

  test('shows the non-field error for wrong credentials', async ({ page }) => {
    await page.route('**/api/auth/login/', (route) =>
      json(route, 400, { non_field_errors: ['Email or password is incorrect.'] }),
    )
    await page.goto('/login')

    await fillAndSubmit(page, 'ana@example.com', 'wrong')

    await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('link', { name: 'Profile' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Log in' })).toBeEnabled()
  })

  test('shows field errors under the email field and marks it invalid', async ({ page }) => {
    await page.route('**/api/auth/login/', (route) => json(route, 400, { email: ['Enter a valid email address.'] }))
    await page.goto('/login')

    await fillAndSubmit(page, 'not-an-email', 'whatever')

    const email = page.getByLabel('Email')
    await expect(page.getByText('Enter a valid email address.')).toBeVisible()
    await expect(email).toHaveAttribute('aria-invalid', 'true')
    await expect(email).toBeFocused()
    await expect(page.getByLabel('Password')).not.toHaveAttribute('aria-invalid', 'true')
  })

  test('shows field errors under the password field and moves focus to it', async ({ page }) => {
    await page.route('**/api/auth/login/', (route) => json(route, 400, { password: ['This field may not be blank.'] }))
    await page.goto('/login')

    await page.getByLabel('Email').fill('ana@example.com')
    await page.getByLabel('Password').fill('x')
    await page.getByRole('button', { name: 'Log in' }).click()

    await expect(page.getByText('This field may not be blank.')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeFocused()
  })

  test('shows the rate-limit message on HTTP 429', async ({ page }) => {
    await page.route('**/api/auth/login/', (route) => json(route, 429, { detail: 'Request was throttled.' }))
    await page.goto('/login')

    await fillAndSubmit(page, 'ana@example.com', 'correct horse')

    await expect(page.getByRole('alert')).toHaveText('Too many attempts. Wait a minute and try again.')
  })

  test('shows the API detail message for other errors', async ({ page }) => {
    await page.route('**/api/auth/login/', (route) => json(route, 403, { detail: 'CSRF Failed: token missing.' }))
    await page.goto('/login')

    await fillAndSubmit(page, 'ana@example.com', 'correct horse')

    await expect(page.getByRole('alert')).toHaveText('CSRF Failed: token missing.')
  })

  test('shows a connection error when the login request cannot reach the server', async ({ page }) => {
    await page.route('**/api/auth/login/', (route) => route.abort('connectionrefused'))
    await page.goto('/login')

    await fillAndSubmit(page, 'ana@example.com', 'correct horse')

    await expect(page.getByRole('alert')).toHaveText(/Can't reach the server/)
  })

  test('shows a generic message when the error response is not JSON', async ({ page }) => {
    await page.route('**/api/auth/login/', (route) =>
      route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }),
    )
    await page.goto('/login')

    await fillAndSubmit(page, 'ana@example.com', 'correct horse')

    await expect(page.getByRole('alert')).toHaveText('Something went wrong. Try again.')
  })

  test('can retry successfully after an error, and the error disappears', async ({ page }) => {
    let attempt = 0
    await page.route('**/api/auth/login/', (route) =>
      ++attempt === 1
        ? json(route, 400, { non_field_errors: ['Email or password is incorrect.'] })
        : json(route, 200, { user: fakeUser }),
    )
    await page.goto('/login')

    await fillAndSubmit(page, 'ana@example.com', 'wrong')
    await expect(page.getByRole('alert')).toBeVisible()

    await page.getByLabel('Password').fill('correct horse')
    await page.getByRole('button', { name: 'Log in' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})
