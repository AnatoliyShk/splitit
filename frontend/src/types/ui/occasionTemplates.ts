// Props for components/OccasionTemplates.tsx

import type { User } from '../api/users'

export type OccasionTemplatesProps = {
  /** The logged-in user; their profile and Explore are refreshed once an occasion is made. */
  user: User
}
