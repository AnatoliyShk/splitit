// Props for components/GenderBar.tsx

import type { GenderCounts } from '../api/occasions'

export type GenderBarProps = {
  /** How many attendees are men, women or didn't say; the bar's segments are sized by these. */
  counts: GenderCounts
}
