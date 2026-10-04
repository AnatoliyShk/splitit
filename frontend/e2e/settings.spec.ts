import { expect, test } from '@playwright/test'
import { mockApi, USER } from './fixtures/user'

const ME = 'PATCH /api/auth/me/'
const PASSWORD = 'POST /api/auth/password/'

test('redirects to the login page when logged out', async ({ page }) => {
  await mockApi(page, { user: null })
  await page.goto('/profile/settings')
  await expect(page).toHaveURL(/\/login$/)
})

test('has a back link to the profile', async ({ page }) => {
  await mockApi(page, { user: USER, occasions: [], connections: [] })
  await page.goto('/profile/settings')
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await page.getByRole('link', { name: '← Profile' }).click()
  await expect(page).toHaveURL(/\/profile$/)
})

test.describe('details form', () => {
  test('is prefilled with the name and a read-only email', async ({ page }) => {
    await mockApi(page, { user: USER })
    await page.goto('/profile/settings')
    await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible()
    await expect(page.getByLabel('Name')).toHaveValue('Ada Lovelace')
    await expect(page.getByLabel('Email')).toHaveValue('ada@example.com')
    await expect(page.getByLabel('Email')).not.toBeEditable()
    await expect(page.getByText('Your email is your login. Ask an admin if it needs to change.')).toBeVisible()
  })

  test('keeps Save disabled until the name actually changes', async ({ page }) => {
    await mockApi(page, { user: USER })
    await page.goto('/profile/settings')
    const save = page.getByRole('button', { name: 'Save changes' })
    await expect(save).toBeDisabled()

    // Only surrounding whitespace added: still the same name
    await page.getByLabel('Name').fill('  Ada Lovelace  ')
    await expect(save).toBeDisabled()

    await page.getByLabel('Name').fill('Ada King')
    await expect(save).toBeEnabled()
  })

  test('saves the new name and confirms it', async ({ page }) => {
    const mock = await mockApi(page, {
      user: USER,
      handlers: {
        [ME]: (route, body) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ user: { ...USER, ...(body as object) } }),
          }),
      },
    })
    await page.goto('/profile/settings')
    await page.getByLabel('Name').fill('Ada King')
    await page.getByRole('button', { name: 'Save changes' }).click()

    await expect(page.getByRole('status')).toHaveText('Saved')
    expect(mock.bodies[ME]).toEqual({ name: 'Ada King' })
    // The saved name is now the baseline, so there is nothing left to save
    await expect(page.getByLabel('Name')).toHaveValue('Ada King')
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  test('hides the Saved status once the name is edited again', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      handlers: {
        [ME]: (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ user: { ...USER, name: 'Ada King' } }),
          }),
      },
    })
    await page.goto('/profile/settings')
    await page.getByLabel('Name').fill('Ada King')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status')).toHaveText('Saved')

    await page.getByLabel('Name').fill('Ada Byron')
    await expect(page.getByRole('status')).toHaveCount(0)
  })

  test('shows the field error and focuses the invalid name', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      handlers: {
        [ME]: (route) =>
          route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ name: ['Ensure this field has no more than 150 characters.'] }),
          }),
      },
    })
    await page.goto('/profile/settings')
    await page.getByLabel('Name').fill('x'.repeat(151))
    await page.getByRole('button', { name: 'Save changes' }).click()

    await expect(page.getByText('Ensure this field has no more than 150 characters.')).toBeVisible()
    await expect(page.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Name')).toBeFocused()
    await expect(page.getByText('Saved', { exact: true })).toHaveCount(0)
  })

  test('shows a form-wide alert when the save is rejected', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      handlers: {
        [ME]: (route) =>
          route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({ detail: 'CSRF Failed: CSRF token missing.' }),
          }),
      },
    })
    await page.goto('/profile/settings')
    await page.getByLabel('Name').fill('Ada King')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('alert')).toHaveText('CSRF Failed: CSRF token missing.')
  })

  test('tells the user when the server cannot be reached', async ({ page }) => {
    await mockApi(page, { user: USER, handlers: { [ME]: (route) => route.abort() } })
    await page.goto('/profile/settings')
    await page.getByLabel('Name').fill('Ada King')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('alert')).toHaveText("Can't reach the server. Check your connection and try again.")
  })
})

test.describe('password form', () => {
  test('keeps Update disabled until both passwords are filled', async ({ page }) => {
    await mockApi(page, { user: USER })
    await page.goto('/profile/settings')
    await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible()
    const update = page.getByRole('button', { name: 'Update password' })
    await expect(update).toBeDisabled()

    await page.getByLabel('Current password').fill('old-password-1')
    await expect(update).toBeDisabled()

    await page.getByLabel('New password').fill('a-new-password-2')
    await expect(update).toBeEnabled()
  })

  test('shows the password requirements hint', async ({ page }) => {
    await mockApi(page, { user: USER })
    await page.goto('/profile/settings')
    await expect(page.getByText('At least 8 characters, not too common and not only numbers.')).toBeVisible()
  })

  test('updates the password, confirms it and clears the fields', async ({ page }) => {
    const mock = await mockApi(page, {
      user: USER,
      handlers: { [PASSWORD]: (route) => route.fulfill({ status: 204 }) },
    })
    await page.goto('/profile/settings')
    await page.getByLabel('Current password').fill('old-password-1')
    await page.getByLabel('New password').fill('a-new-password-2')
    await page.getByRole('button', { name: 'Update password' }).click()

    await expect(page.getByRole('status')).toHaveText('Password updated')
    expect(mock.bodies[PASSWORD]).toEqual({ current_password: 'old-password-1', new_password: 'a-new-password-2' })
    await expect(page.getByLabel('Current password')).toHaveValue('')
    await expect(page.getByLabel('New password')).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Update password' })).toBeDisabled()
  })

  test('shows the current password error and focuses that field', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      handlers: {
        [PASSWORD]: (route) =>
          route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ current_password: ['Your current password is incorrect.'] }),
          }),
      },
    })
    await page.goto('/profile/settings')
    await page.getByLabel('Current password').fill('wrong-password')
    await page.getByLabel('New password').fill('a-new-password-2')
    await page.getByRole('button', { name: 'Update password' }).click()

    await expect(page.getByText('Your current password is incorrect.')).toBeVisible()
    await expect(page.getByLabel('Current password')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Current password')).toBeFocused()
    await expect(page.getByText('Password updated')).toHaveCount(0)
    // Typed values stay so the user can correct them
    await expect(page.getByLabel('New password')).toHaveValue('a-new-password-2')
  })

  test('shows every new password validation error', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      handlers: {
        [PASSWORD]: (route) =>
          route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
              new_password: ['This password is too short. It must contain at least 8 characters.', 'This password is entirely numeric.'],
            }),
          }),
      },
    })
    await page.goto('/profile/settings')
    await page.getByLabel('Current password').fill('old-password-1')
    await page.getByLabel('New password').fill('123')
    await page.getByRole('button', { name: 'Update password' }).click()

    await expect(page.getByText('This password is too short. It must contain at least 8 characters.')).toBeVisible()
    await expect(page.getByText('This password is entirely numeric.')).toBeVisible()
    await expect(page.getByLabel('New password')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('New password')).toBeFocused()
  })

  test('shows a rate limit alert when throttled', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      handlers: {
        [PASSWORD]: (route) =>
          route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ detail: 'Throttled.' }) }),
      },
    })
    await page.goto('/profile/settings')
    await page.getByLabel('Current password').fill('old-password-1')
    await page.getByLabel('New password').fill('a-new-password-2')
    await page.getByRole('button', { name: 'Update password' }).click()
    await expect(page.getByRole('alert')).toHaveText('Too many attempts. Wait a minute and try again.')
  })
})
