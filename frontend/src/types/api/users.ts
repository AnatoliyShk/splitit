import type { Tag } from './tags'

// Shapes of the user API responses; each mirrors a backend serializer

/** How a user described themselves (the backend's Gender); `undisclosed` is "Do not want to tell". */
export type Gender = 'man' | 'woman' | 'undisclosed'

/** The logged-in user (GET /api/auth/me/). */
export type User = {
  id: number
  uuid: string // public id used in /api/users/<uuid>/... URLs
  email: string
  name: string
  gender: Gender
  is_staff: boolean
  is_superuser: boolean
  date_joined: string
  // When they declared they're 18 or older; null for an account made before sign-up asked, which must confirm
  // (or be deleted) before it can use the app
  adult_confirmed_at: string | null
}

/** Someone else, as other users may see them: public uuid and display name only, never email. */
export type PublicUser = Pick<User, 'uuid' | 'name'>

/** ISO day of the week, 1 is Monday and 7 is Sunday (the backend's Weekday). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** Saved Explore filters (FilterPreferenceSerializer). An empty list doesn't filter, and neither does `is_enabled: false`. */
export type FilterPreference = { tags: Tag[]; weekdays: Weekday[]; is_enabled: boolean }
