import type { OccasionCore, UserOccasion } from './occasions'
import type { Tag } from './tags'
import type { Gender } from './users'

// Shapes of the staff-only admin API (/api/admin/); each mirrors a serializer in apps/panel

export type PanelUser = {
  id: number
  email: string
  name: string
  gender: Gender
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

export type PanelOccasion = OccasionCore & {
  description: UserOccasion['description']
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

/** An occasion template in the panel (PanelTemplateSerializer). */
export type PanelTemplate = {
  id: number
  name: string
  description: string
  // How long occasions made from it run; null means no fixed end
  duration_minutes: number | null
  tags: Tag[]
  // Order 0 is the main image; 1-3 are the gallery. Every occasion made from the template gets a copy of each
  images: OccasionImage[]
  created_at: string
  updated_at: string
}

export type Stats = {
  users: { total: number; active: number; staff: number; new_this_week: number }
  occasions: { total: number; upcoming: number }
  next_occasions: (OccasionCore & Pick<UserOccasion, 'attendees_count'>)[]
}
