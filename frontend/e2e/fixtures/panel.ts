import type { Page, Request } from '@playwright/test'

// Shapes mirror frontend/src/api.ts and frontend/src/pages/panel/shared.ts
export type SessionUser = {
  id: number
  uuid: string
  email: string
  name: string
  is_staff: boolean
  is_superuser: boolean
  date_joined: string
}

export type PanelUser = {
  id: number
  email: string
  name: string
  is_active: boolean
  is_staff: boolean
  is_superuser: boolean
  date_joined: string
  last_login: string | null
  events_count: number
}

export type Attendee = { id: number; name: string; email: string }

export type PanelEvent = {
  id: number
  name: string
  start_datetime: string
  end_datetime: string | null
  duration_minutes: number | null
  attendees: Attendee[]
  created_at: string
  updated_at: string
}

export type PanelTag = {
  id: number
  name: string
  events_count: number
  has_embedding: boolean
  created_at: string
  updated_at: string
}

// ---------- data builders ----------

export function sessionUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 1,
    uuid: '0190a000-0000-7000-8000-000000000001',
    email: 'admin@example.com',
    name: 'Ada Admin',
    is_staff: true,
    is_superuser: false,
    date_joined: '2025-01-01T10:00:00Z',
    ...overrides,
  }
}

export const staffUser = sessionUser()
export const memberUser = sessionUser({
  id: 2,
  uuid: '0190a000-0000-7000-8000-000000000002',
  email: 'member@example.com',
  name: 'Mia Member',
  is_staff: false,
})

export function panelUser(overrides: Partial<PanelUser> = {}): PanelUser {
  return {
    id: 100,
    email: 'user@example.com',
    name: 'Some User',
    is_active: true,
    is_staff: false,
    is_superuser: false,
    date_joined: '2025-03-15T09:00:00Z',
    last_login: null,
    events_count: 0,
    ...overrides,
  }
}

export function attendee(id: number, name: string, email = `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`): Attendee {
  return { id, name, email }
}

export function panelEvent(overrides: Partial<PanelEvent> = {}): PanelEvent {
  return {
    id: 10,
    name: 'Jazz night',
    start_datetime: '2099-10-10T18:00:00Z',
    end_datetime: '2099-10-10T21:00:00Z',
    duration_minutes: 180,
    attendees: [],
    created_at: '2025-05-01T12:00:00Z',
    updated_at: '2025-05-02T12:00:00Z',
    ...overrides,
  }
}

export function panelTag(overrides: Partial<PanelTag> = {}): PanelTag {
  return {
    id: 1,
    name: 'Jazz',
    events_count: 0,
    has_embedding: true,
    created_at: '2025-04-01T08:00:00Z',
    updated_at: '2025-04-01T08:00:00Z',
    ...overrides,
  }
}

// ---------- pagination ----------

export const PAGE_SIZE = 20

// DRF PageNumberPagination response for an in-memory list, honoring ?page= and ?search=
export function paginate<T>(items: T[], url: URL, searchText: (item: T) => string[] = () => []) {
  const search = (url.searchParams.get('search') ?? '').trim().toLowerCase()
  const filtered = search
    ? items.filter((i) => searchText(i).some((s) => s.toLowerCase().includes(search)))
    : items
  const page = Number(url.searchParams.get('page') ?? '1')
  const start = (page - 1) * PAGE_SIZE
  return {
    count: filtered.length,
    next: start + PAGE_SIZE < filtered.length ? `?page=${page + 1}` : null,
    previous: page > 1 ? `?page=${page - 1}` : null,
    results: filtered.slice(start, start + PAGE_SIZE),
  }
}

// ---------- API mocking ----------

export type Reply = { status?: number; body?: unknown }
export type ApiCall = { method: string; url: URL; body: any }
type Handler = (call: ApiCall) => Reply | Promise<Reply>
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

// Mock one endpoint (exact pathname or regex) per HTTP method. Returns the recorded calls.
export async function mockApi(
  page: Page,
  path: string | RegExp,
  handlers: Partial<Record<Method, Handler>>,
): Promise<ApiCall[]> {
  const calls: ApiCall[] = []
  const matches = (p: string) => (typeof path === 'string' ? p === path : path.test(p))
  await page.route(
    (url) => matches(url.pathname),
    async (route) => {
      const request: Request = route.request()
      const method = request.method() as Method
      const handler = handlers[method]
      if (!handler) {
        return route.fulfill({
          status: 405,
          contentType: 'application/json',
          body: JSON.stringify({ detail: `Unexpected ${method} ${new URL(request.url()).pathname}` }),
        })
      }
      let body: unknown = null
      try {
        body = request.postDataJSON()
      } catch {
        body = null
      }
      const call = { method, url: new URL(request.url()), body }
      calls.push(call)
      const reply = await handler(call)
      const status = reply.status ?? 200
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: status === 204 ? undefined : JSON.stringify(reply.body ?? null),
      })
    },
  )
  return calls
}

// Everything the app shell needs. `user: null` means logged out (GET /api/auth/me/ -> {user: null}).
// Any /api call a test forgot to mock fails with 501 so it is easy to spot.
export async function mockSession(page: Page, user: SessionUser | null, health: 'ok' | 'down' = 'ok') {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) =>
      route.fulfill({
        status: 501,
        contentType: 'application/json',
        body: JSON.stringify({ detail: `Unmocked API call: ${new URL(route.request().url()).pathname}` }),
      }),
  )
  await mockApi(page, '/api/health/', { GET: () => ({ body: { status: health } }) })
  await mockApi(page, '/api/auth/me/', { GET: () => ({ body: { user } }) })
  // Unsafe requests ask for a CSRF cookie first
  await page.route('**/api/auth/csrf/', (route) =>
    route.fulfill({ status: 204, headers: { 'set-cookie': 'csrftoken=test-token; Path=/' } }),
  )
}

// Logged in as an admin, ready to open /admin pages
export async function mockStaffSession(page: Page, user: SessionUser = staffUser) {
  await mockSession(page, user)
}

export function pageOf<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results }
}

// A promise that can be resolved from outside; lets a test hold a response open
export function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}
