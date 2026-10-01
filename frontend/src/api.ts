export type User = {
  id: number
  email: string
  name: string
  is_staff: boolean
  is_superuser: boolean
}

// DRF PageNumberPagination response
export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] }

// DRF error shape: field name -> messages; form-wide errors use `non_field_errors`
export type FieldErrors = Record<string, string[]>

export class ApiError extends Error {
  status: number
  errors: FieldErrors

  constructor(status: number, errors: FieldErrors) {
    super(Object.values(errors).flat()[0] ?? `Request failed (${status})`)
    this.status = status
    this.errors = errors
  }
}

function getCookie(name: string) {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.split('=')[1]
}

// Django rejects unsafe requests without a CSRF token; fetch the cookie once if it's missing
async function csrfToken() {
  if (!getCookie('csrftoken')) {
    await fetch('/api/auth/csrf/', { credentials: 'same-origin' })
  }
  return getCookie('csrftoken') ?? ''
}

function toFieldErrors(status: number, data: unknown): FieldErrors {
  if (status === 429) {
    return { non_field_errors: ['Too many attempts. Wait a minute and try again.'] }
  }
  if (data && typeof data === 'object') {
    if ('detail' in data && typeof data.detail === 'string') {
      return { non_field_errors: [data.detail] }
    }
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : [String(v)]]),
    )
  }
  return { non_field_errors: ['Something went wrong. Try again.'] }
}

async function handle<T>(res: Response): Promise<T> {
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, toFieldErrors(res.status, data))
  return data as T
}

export async function apiGet<T>(path: string): Promise<T> {
  return handle<T>(await fetch(path, { credentials: 'same-origin' }))
}

async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await csrfToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return handle<T>(res)
}

export const apiPost = <T>(path: string, body?: unknown) => apiSend<T>('POST', path, body)
export const apiPatch = <T>(path: string, body: unknown) => apiSend<T>('PATCH', path, body)
export const apiDelete = (path: string) => apiSend<null>('DELETE', path)

export function errorsFrom(err: unknown): FieldErrors {
  if (err instanceof ApiError) return err.errors
  return { non_field_errors: ["Can't reach the server. Check your connection and try again."] }
}
