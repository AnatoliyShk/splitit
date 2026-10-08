import { expect, test, type Page } from '@playwright/test'
import { fakeUser, json, mockCsrf, mockHealth, mockMe, setCsrfCookie } from './fixtures/auth'

async function fillAndSubmit(page: Page, name: string, email: string, password: string) {
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
}

test.beforeEach(async ({ page }) => {
  await mockHealth(page)
  await mockMe(page, null)
  await setCsrfCookie(page, 'reg-token')
})

test.describe('Register page', () => {
  test('renders the form with name, email and password fields and the password hint', async ({ page }) => {
    await page.goto('/register')

    await expect(page).toHaveTitle('Create account · Splitit')
    await expect(page.getByRole('heading', { name: 'Never go alone' })).toBeVisible()
    await expect(page.getByLabel('Name')).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveAttribute('type', 'email')
    await expect(page.getByLabel('Password')).toHaveAttribute('type', 'password')
    await expect(page.getByText('At least 8 characters, not too common and not only numbers.')).toBeVisible()
    await expect(page.getByLabel('Password')).toHaveAccessibleDescription(/At least 8 characters/)
  })

  test('already logged-in visitor is redirected to the home page', async ({ page }) => {
    await mockMe(page, fakeUser)
    await page.goto('/register')

    await expect(page).toHaveURL(/\/$/)
  })

  test('fetches the CSRF cookie before registering when it is missing', async ({ page }) => {
    await page.context().clearCookies()
    const csrf = await mockCsrf(page)
    await page.route('**/api/auth/register/', (route) => json(route, 201, { user: fakeUser }))
    await page.goto('/register')

    await fillAndSubmit(page, 'Ana Smith', 'ana@example.com', 'a-strong-pass-9')

    await expect(page).toHaveURL(/\/$/)
    expect(csrf.count).toBe(1)
  })
})

test.describe('Register success', () => {
  test('posts name, email and password, logs the user in and redirects home', async ({ page }) => {
    let body: unknown
    let csrfHeader: string | undefined
    await page.route('**/api/auth/register/', (route) => {
      body = route.request().postDataJSON()
      csrfHeader = route.request().headers()['x-csrftoken']
      return json(route, 201, { user: fakeUser })
    })
    await page.goto('/register')

    await fillAndSubmit(page, 'Ana Smith', 'ana@example.com', 'a-strong-pass-9')

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible()
    expect(body).toEqual({ name: 'Ana Smith', email: 'ana@example.com', password: 'a-strong-pass-9' })
    expect(csrfHeader).toBe('reg-token')
  })

  test('disables the submit button and shows progress while the request is pending', async ({ page }) => {
    let release!: () => void
    const gate = new Promise<void>((resolvePromise) => (release = resolvePromise))
    await page.route('**/api/auth/register/', async (route) => {
      await gate
      await json(route, 201, { user: fakeUser })
    })
    await page.goto('/register')

    await fillAndSubmit(page, 'Ana Smith', 'ana@example.com', 'a-strong-pass-9')

    await expect(page.getByRole('button', { name: 'Creating account…' })).toBeDisabled()
    release()
    await expect(page).toHaveURL(/\/$/)
  })
})

test.describe('Register validation errors', () => {
  test('shows the duplicate email error and focuses the email field', async ({ page }) => {
    await page.route('**/api/auth/register/', (route) =>
      json(route, 400, { email: ['An account with this email already exists.'] }),
    )
    await page.goto('/register')

    await fillAndSubmit(page, 'Ana Smith', 'ana@example.com', 'a-strong-pass-9')

    const email = page.getByLabel('Email')
    await expect(page.getByText('An account with this email already exists.')).toBeVisible()
    await expect(email).toHaveAttribute('aria-invalid', 'true')
    await expect(email).toBeFocused()
    await expect(page).toHaveURL(/\/register$/)
    await expect(page.getByRole('button', { name: 'Create account' })).toBeEnabled()
  })

  test('lists every weak-password message under the password field', async ({ page }) => {
    await page.route('**/api/auth/register/', (route) =>
      json(route, 400, {
        password: [
          'This password is too short. It must contain at least 8 characters.',
          'This password is entirely numeric.',
        ],
      }),
    )
    await page.goto('/register')

    await fillAndSubmit(page, 'Ana Smith', 'ana@example.com', '1234')

    const password = page.getByLabel('Password')
    await expect(page.getByText('This password is too short. It must contain at least 8 characters.')).toBeVisible()
    await expect(page.getByText('This password is entirely numeric.')).toBeVisible()
    await expect(password).toHaveAttribute('aria-invalid', 'true')
    await expect(password).toBeFocused()
    await expect(password).toHaveAccessibleDescription(/entirely numeric/)
  })

  test('shows errors for several fields at once and focuses the first invalid one', async ({ page }) => {
    await page.route('**/api/auth/register/', (route) =>
      json(route, 400, {
        name: ['This field may not be blank.'],
        email: ['Enter a valid email address.'],
        password: ['This password is too common.'],
      }),
    )
    await page.goto('/register')

    await fillAndSubmit(page, ' ', 'nope', 'password')

    await expect(page.getByText('This field may not be blank.')).toBeVisible()
    await expect(page.getByText('Enter a valid email address.')).toBeVisible()
    await expect(page.getByText('This password is too common.')).toBeVisible()
    await expect(page.getByLabel('Name')).toBeFocused()
  })

  test('clears old field errors after a successful retry', async ({ page }) => {
    let attempt = 0
    await page.route('**/api/auth/register/', (route) =>
      ++attempt === 1
        ? json(route, 400, { password: ['This password is too common.'] })
        : json(route, 201, { user: fakeUser }),
    )
    await page.goto('/register')

    await fillAndSubmit(page, 'Ana Smith', 'ana@example.com', 'password')
    await expect(page.getByText('This password is too common.')).toBeVisible()

    await page.getByLabel('Password').fill('a-strong-pass-9')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('This password is too common.')).toHaveCount(0)
  })

  test('shows the rate-limit message on HTTP 429', async ({ page }) => {
    await page.route('**/api/auth/register/', (route) => json(route, 429, { detail: 'Request was throttled.' }))
    await page.goto('/register')

    await fillAndSubmit(page, 'Ana Smith', 'ana@example.com', 'a-strong-pass-9')

    await expect(page.getByRole('alert')).toHaveText('Too many attempts. Wait a minute and try again.')
  })

  test('shows a connection error when the server cannot be reached', async ({ page }) => {
    await page.route('**/api/auth/register/', (route) => route.abort('connectionrefused'))
    await page.goto('/register')

    await fillAndSubmit(page, 'Ana Smith', 'ana@example.com', 'a-strong-pass-9')

    await expect(page.getByRole('alert')).toHaveText(/Can't reach the server/)
    await expect(page.getByRole('button', { name: 'Create account' })).toBeEnabled()
  })
})
