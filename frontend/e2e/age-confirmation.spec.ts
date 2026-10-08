import { expect, test } from '@playwright/test'
import { fakeUser, json, mockHealth, mockMe, setCsrfCookie } from './fixtures/auth'

// An account made before sign-up asked for the 18+ declaration
const unconfirmedUser = { ...fakeUser, adult_confirmed_at: null }

test.beforeEach(async ({ page }) => {
  await mockHealth(page)
  await setCsrfCookie(page, 'age-token')
})

test('an account with no 18+ declaration sees only the confirmation, on any page', async ({ page }) => {
  await mockMe(page, unconfirmedUser)
  for (const path of ['/', '/explore', '/profile']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Are you 18 or older?' })).toBeVisible()
  }
  // The rules stay readable
  await page.getByRole('link', { name: 'Read the age rules' }).click()
  await expect(page.getByRole('heading', { name: 'Splitit is for adults only' })).toBeVisible()
})

test('confirming records it and opens the app', async ({ page }) => {
  await mockMe(page, unconfirmedUser)
  let body: unknown
  await page.route('**/api/auth/age/', (route) => {
    body = route.request().postDataJSON()
    return json(route, 200, { user: fakeUser })
  })
  await page.goto('/')

  await page.getByRole('button', { name: "Yes, I'm 18 or older" }).click()

  await expect(page.getByRole('heading', { name: 'Are you 18 or older?' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible()
  expect(body).toEqual({ is_adult: true })
})

test('declaring under 18 asks once more, then deletes the account and logs out', async ({ page }) => {
  await mockMe(page, unconfirmedUser)
  let body: unknown
  await page.route('**/api/auth/age/', (route) => {
    body = route.request().postDataJSON()
    return route.fulfill({ status: 204 })
  })
  await page.goto('/')

  await page.getByRole('button', { name: "I'm under 18, delete my account" }).click()
  await page.getByRole('button', { name: 'Yes, delete my account' }).click()

  await expect(page.getByRole('heading', { name: 'Are you 18 or older?' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible()
  expect(body).toEqual({ is_adult: false })
})

test('a confirmed account never sees the confirmation', async ({ page }) => {
  await mockMe(page, fakeUser)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Are you 18 or older?' })).toHaveCount(0)
})

test('the footer links to the adults-only rules', async ({ page }) => {
  await mockMe(page, null)
  await page.goto('/')
  await page.getByRole('link', { name: 'Adults only (18+)' }).click()
  await expect(page).toHaveURL(/\/adults-only$/)
  await expect(page.getByRole('heading', { name: 'Splitit is for adults only' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register')
})
