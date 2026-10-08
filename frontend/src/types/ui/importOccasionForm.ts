// Props and UI state types for components/ImportOccasionForm.tsx

import type { User } from '../api/users'

export type ImportOccasionFormProps = {
  /** The logged-in user; their profile and Explore are refreshed once the occasion is added. */
  user: User
}
