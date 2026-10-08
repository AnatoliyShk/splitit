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
  // Plain text, up to 2000 characters; may be empty
  description: string
  cancelled_at: string | null
  attendees_count: number
  tags: TagName[]
  main_image: string | null
  // The regular user who made it; null when staff made it
  created_by: PublicUser | null
}

/** An attendee the user has a connection with (PublicUserSerializer). */
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

/** GET /api/occasions/explore/. A user goes to one occasion at a time: while `active_occasion` is set, `occasions` is empty. */
export type ExploreData = { active_occasion: ExploreOccasion | null; occasions: ExploreOccasion[] }
