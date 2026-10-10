import type { Page, Route } from '@playwright/test'

export type FakeUser = {
  id: number
  uuid: string
  email: string
  name: string
  gender: 'man' | 'woman' | 'undisclosed'
  is_staff: boolean
  is_superuser: boolean
  date_joined: string
  adult_confirmed_at: string | null
}

export const fakeUser: FakeUser = {
  id: 1,
  uuid: '0191a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b',
  email: 'ana@example.com',
  name: 'Ana Smith',
  gender: 'undisclosed',
  is_staff: false,
  is_superuser: false,
  date_joined: '2026-01-01T10:00:00Z',
  adult_confirmed_at: '2026-01-01T10:00:00Z',
}

export const fakeStaff: FakeUser = { ...fakeUser, id: 2, name: 'Sam Staff', email: 'sam@example.com', is_staff: true }

export const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** Mock GET /api/auth/me/. Pass null for a logged-out visitor. */
export async function mockMe(page: Page, user: FakeUser | null) {
  await page.route('**/api/auth/me/', (route) => json(route, 200, { user }))
}

/** Mock GET /api/health/ (the footer status). */
export async function mockHealth(page: Page, status: 'ok' | 'down' = 'ok') {
  await page.route('**/api/health/', (route) =>
    status === 'ok' ? json(route, 200, { status: 'ok' }) : route.abort('connectionrefused'),
  )
}

/** Mock GET /api/auth/csrf/ and record how many times it was called. */
export async function mockCsrf(page: Page) {
  const calls = { count: 0 }
  await page.route('**/api/auth/csrf/', (route) => {
    calls.count++
    return route.fulfill({ status: 204 })
  })
  return calls
}

/** Put a csrftoken cookie in the browser, as Django would after /api/auth/csrf/. */
export async function setCsrfCookie(page: Page, value = 'test-csrf-token') {
  await page.context().addCookies([{ name: 'csrftoken', value, url: 'http://localhost:5173' }])
}
