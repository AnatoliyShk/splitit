import { useMemo } from 'react'

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
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split('=')[1]
}

// Django rejects unsafe requests without a CSRF token; fetch the cookie once if it's missing
async function csrfToken() {
  if (!getCookie('csrftoken')) {
    await fetch('/api/auth/csrf/', { credentials: 'same-origin' })
  }
  return getCookie('csrftoken') ?? ''
}

function toFieldErrors(status: number, responseData: unknown): FieldErrors {
  if (status === 429) {
    return { non_field_errors: ['Too many attempts. Wait a minute and try again.'] }
  }
  if (responseData && typeof responseData === 'object') {
    if ('detail' in responseData && typeof responseData.detail === 'string') {
      return { non_field_errors: [responseData.detail] }
    }
    return Object.fromEntries(
      Object.entries(responseData).map(([fieldName, messages]) => [
        fieldName,
        Array.isArray(messages) ? messages.map(String) : [String(messages)],
      ]),
    )
  }
  return { non_field_errors: ['Something went wrong. Try again.'] }
}

async function handle<T>(response: Response): Promise<T> {
  const responseData = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, toFieldErrors(response.status, responseData))
  return responseData as T
}

export async function apiGet<T>(path: string): Promise<T> {
  return handle<T>(await fetch(path, { credentials: 'same-origin' }))
}

async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await csrfToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return handle<T>(response)
}

export const apiPost = <T>(path: string, body?: unknown) => apiSend<T>('POST', path, body)
export const apiPatch = <T>(path: string, body: unknown) => apiSend<T>('PATCH', path, body)
export const apiPut = <T>(path: string, body: unknown) => apiSend<T>('PUT', path, body)
export const apiDelete = (path: string) => apiSend<null>('DELETE', path)

// multipart/form-data (file uploads): no Content-Type header, so the browser adds one with the boundary
export async function apiUpload<T>(path: string, body: FormData): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRFToken': await csrfToken() },
    body,
  })
  return handle<T>(response)
}

export function errorsFrom(error: unknown): FieldErrors {
  if (error instanceof ApiError) return error.errors
  return { non_field_errors: ["Can't reach the server. Check your connection and try again."] }
}

const NO_ERRORS: FieldErrors = {}

/**
 * The field errors of the first failed query or mutation among `failures` (pass their `.error`), or none.
 * Memoized, so effects that depend on the errors (like focusing the first invalid field) run only when they change.
 */
export function useFieldErrors(...failures: unknown[]): FieldErrors {
  const failure = failures.find((candidate) => candidate != null)
  return useMemo(() => (failure == null ? NO_ERRORS : errorsFrom(failure)), [failure])
}
