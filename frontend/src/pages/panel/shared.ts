import { useEffect, useState } from 'react'
import type { OccasionCore, UserOccasion } from '../../types/occasions'
import type { Tag } from '../../types/tags'

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

// Order 0 is the main image (shown on occasion cards); 1-3 are the gallery on the occasion's page
export type OccasionImage = { order: number; url: string }

// The image slots and upload limits; they match the server
export const IMAGE_SLOTS = [0, 1, 2, 3] as const
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Saved image URLs by slot, as the server has them
export type SavedImages = Record<number, string>
// Edits waiting for Save: a File to upload into the slot, or null to empty it
export type ImageChanges = Record<number, File | null>

export function slotLabel(order: number) {
  return order === 0 ? 'Main image' : `Gallery ${order}`
}

/** Checks a picked file the way the server will, so most mistakes show before anything is uploaded. */
export function imageProblem(file: File) {
  if (!IMAGE_TYPES.includes(file.type)) return 'Use a JPEG, PNG or WebP image.'
  if (file.size > MAX_IMAGE_BYTES) return 'The image must be 5 MB or smaller.'
  return null
}

export type PanelOccasion = OccasionCore & {
  cancelled_at: UserOccasion['cancelled_at']
  duration_minutes: number | null
  attendees: Attendee[]
  tags: Tag[]
  images: OccasionImage[]
  created_at: string
  updated_at: string
}

export type PanelTag = Tag & {
  occasions_count: number
  has_embedding: boolean
  created_at: string
  updated_at: string
}

export type Stats = {
  users: { total: number; active: number; staff: number; new_this_week: number }
  occasions: { total: number; upcoming: number }
  next_occasions: (OccasionCore & Pick<UserOccasion, 'attendees_count'>)[]
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

const dayTimeFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

// Like formatTimes, but a later end day leaves out the year, to fit a narrow cell (the start date shows it)
export function formatTimesShort(start: string, end: string | null) {
  const from = timeFormat.format(new Date(start))
  if (!end) return from
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString()
  return `${from} – ${(sameDay ? timeFormat : dayTimeFormat).format(new Date(end))}`
}

// For when the date is already shown: times only, plus the end date when it ends on a later day
export function formatTimes(start: string, end: string | null) {
  const from = timeFormat.format(new Date(start))
  if (!end) return from
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString()
  return `${from} – ${sameDay ? timeFormat.format(new Date(end)) : formatDateTime(end)}`
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
  const date = new Date(iso)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// ...and the API wants an absolute time, so send it as UTC ISO
export function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null
}

export function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function useDebounced<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeoutId = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timeoutId)
  }, [value, delay])
  return debounced
}
