import { useEffect, useState } from 'react'

export const PAGE_SIZE = 20 // matches PanelPagination on the backend

export type PanelUser = {
  id: number
  email: string
  name: string
  is_active: boolean
  is_staff: boolean
  is_superuser: boolean
  date_joined: string
  last_login: string | null
  occasions_count: number
}

export type Attendee = { id: number; name: string; email: string }

export type PanelOccasion = {
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
  occasions_count: number
  has_embedding: boolean
  created_at: string
  updated_at: string
}

export type Stats = {
  users: { total: number; active: number; staff: number; new_this_week: number }
  occasions: { total: number; upcoming: number }
  next_occasions: {
    id: number
    name: string
    start_datetime: string
    end_datetime: string | null
    attendees_count: number
  }[]
}

// The API sends ISO datetimes in UTC; everything below shows them in the viewer's time zone
const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

export const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

export function formatDate(iso: string) {
  return dateFormat.format(new Date(iso))
}

export function formatDateTime(iso: string) {
  return dateTimeFormat.format(new Date(iso))
}

export function formatRange(start: string, end: string | null) {
  if (!end) return formatDateTime(start)
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString()
  // Same day: show the date once, then only the end time
  return `${formatDateTime(start)} – ${sameDay ? timeFormat.format(new Date(end)) : formatDateTime(end)}`
}

export function formatDuration(minutes: number) {
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  const parts = [days && plural(days, 'day'), hours && `${hours} h`, mins && `${mins} min`]
  return parts.filter(Boolean).join(' ') || '0 min'
}

// <input type="datetime-local"> holds local wall time with no zone ("2026-10-10T18:00")
export function toLocalInput(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ...and the API wants an absolute time, so send it as UTC ISO
export function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function useDebounced<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}
