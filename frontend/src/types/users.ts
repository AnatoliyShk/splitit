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
