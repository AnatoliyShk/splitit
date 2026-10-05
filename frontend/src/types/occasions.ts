import type { TagName } from './tags'
import type { PublicUser } from './users'

// Shapes of the occasion API responses; each mirrors a backend serializer

/** Fields every occasion response has. */
export type OccasionCore = {
  id: number
  name: string
  start_datetime: string
  end_datetime: string | null
}

/** An occasion in public lists: profile, explore (UserOccasionSerializer). */
export type UserOccasion = OccasionCore & {
  cancelled_at: string | null
  attendees_count: number
  tags: TagName[]
  main_image: string | null
}

/** An attendee the user has a connection with (KnownAttendeeSerializer). */
export type KnownAttendee = PublicUser

/** An explore card (ExploreOccasionSerializer). */
export type ExploreOccasion = UserOccasion & {
  // Attendees the user has a connection with
  known_attendees: KnownAttendee[]
}

/** The occasion page (OccasionDetailSerializer). */
export type OccasionDetail = UserOccasion & {
  // Up to 3 image URLs, in order, without the main image
  gallery: string[]
  is_going: boolean
}
