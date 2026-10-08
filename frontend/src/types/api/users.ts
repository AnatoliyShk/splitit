import type { Tag } from './tags'

// Shapes of the user API responses; each mirrors a backend serializer

/** The logged-in user (GET /api/auth/me/). */
export type User = {
  id: number
  uuid: string // public id used in /api/users/<uuid>/... URLs
  email: string
  name: string
  is_staff: boolean
  is_superuser: boolean
  date_joined: string
}

/** Someone else, as other users may see them: public uuid and display name only, never email. */
export type PublicUser = Pick<User, 'uuid' | 'name'>

/** ISO day of the week, 1 is Monday and 7 is Sunday (the backend's Weekday). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** Saved Explore filters (FilterPreferenceSerializer). An empty list doesn't filter, and neither does `is_enabled: false`. */
export type FilterPreference = { tags: Tag[]; weekdays: Weekday[]; is_enabled: boolean }
