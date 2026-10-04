import type { Page, Route } from '@playwright/test'

export type TestUser = {
  id: number
  uuid: string
  email: string
  name: string
  is_staff: boolean
  is_superuser: boolean
  date_joined: string
}

export type TestOccasion = {
  id: number
  name: string
  start_datetime: string
  end_datetime: string | null
  attendees_count: number
  tags: string[]
}

export type TestConnection = { uuid: string; name: string; strength: number; shared_occasions: number }

export const USER: TestUser = {
  id: 1,
  uuid: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  is_staff: false,
  is_superuser: false,
  // Midday UTC, so the formatted date is the same in any time zone: "Mar 15, 2025"
  date_joined: '2025-03-15T12:00:00Z',
}

export const ADMIN: TestUser = { ...USER, is_staff: true }

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** ISO timestamp `ms` from now (negative for the past). */
export function fromNow(ms: number) {
  return new Date(Date.now() + ms).toISOString()
}

/** A two-hour occasion starting `startInDays` from now (negative = in the past). */
export function makeOccasion(
  id: number,
  name: string,
  startInDays: number,
  overrides: Partial<TestOccasion> = {},
): TestOccasion {
  const start = Date.now() + startInDays * DAY
  return {
    id,
    name,
    start_datetime: new Date(start).toISOString(),
    end_datetime: new Date(start + 2 * HOUR).toISOString(),
    attendees_count: 1,
    tags: [],
    ...overrides,
  }
}

export type Mock = {
  /** Every request that reached the mock, as "METHOD /path". */
  requests: string[]
  /** Parsed JSON bodies of non-GET requests, by "METHOD /path". */
  bodies: Record<string, unknown>
}

export type MockOptions = {
  /** The logged-in user, or null for logged out (GET /api/auth/me/ gives {user: null}). */
  user: TestUser | null
  /** Response for GET /api/users/<uuid>/occasions/. A number makes it fail with that status. */
  occasions?: TestOccasion[] | number
  /** Response for GET /api/users/<uuid>/connections/. A number makes it fail with that status. */
  connections?: TestConnection[] | number
  /** Response for GET /api/users/<uuid>/connections/graph/; defaults to 404 (the page hides the graph). */
  graph?: { nodes: unknown[]; edges: unknown[] } | number
  /** Response for GET /api/occasions/explore/. A number makes it fail with that status. */
  explore?: TestOccasion[] | number
  /** Extra handlers, keyed by "METHOD /api/path/". Take precedence over the defaults. */
  handlers?: Record<string, (route: Route, body: unknown) => Promise<void> | void>
}

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function respond(route: Route, value: unknown) {
  if (value === undefined) return json(route, 404, { detail: 'Not mocked.' })
  if (typeof value === 'number') return json(route, value, { detail: 'Mocked failure.' })
  return json(route, 200, value)
}

/**
 * Mocks the whole backend for a page. Anything not configured answers 404 so tests never hit Django.
 * Call before page.goto().
 */
export async function mockApi(page: Page, options: MockOptions): Promise<Mock> {
  const mock: Mock = { requests: [], bodies: {} }
  // The CSRF helper only fetches this when the cookie is missing; give it a cookie so it stays quiet
  await page.context().addCookies([{ name: 'csrftoken', value: 'test-token', url: 'http://localhost:5173' }])

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())
    const method = request.method()
    const key = `${method} ${pathname}`
    mock.requests.push(key)
    if (method !== 'GET') mock.bodies[key] = request.postDataJSON()

    const custom = options.handlers?.[key]
    if (custom) return custom(route, mock.bodies[key])

    const uuid = options.user?.uuid
    if (method === 'GET') {
      if (pathname === '/api/auth/me/') return json(route, 200, { user: options.user })
      if (pathname === '/api/auth/csrf/') return route.fulfill({ status: 204 })
      if (pathname === '/api/occasions/explore/') return respond(route, options.explore)
      if (uuid && pathname === `/api/users/${uuid}/occasions/`) return respond(route, options.occasions)
      if (uuid && pathname === `/api/users/${uuid}/connections/`) return respond(route, options.connections)
      if (uuid && pathname === `/api/users/${uuid}/connections/graph/`) return respond(route, options.graph)
    }
    return json(route, 404, { detail: 'Not mocked.' })
  })
  return mock
}
