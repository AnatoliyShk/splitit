// Props for components/RowMenu.tsx

import type { ReactNode } from 'react'

export type RowMenuProps = {
  /** What the actions are for, e.g. "Jazz night": names the gear button for screen readers. */
  label: string
  /** The action buttons and links, shown when the gear is open. */
  children: ReactNode
}
