// Props and UI state types for components/PromoCard.tsx

import type { ReactNode } from 'react'

export type PromoCardProps = {
  /** Icon paths drawn inside the badge's 24x24 SVG. */
  icon: ReactNode
  title: string
  children: ReactNode
  /** Route the action button links to. */
  to: string
  actionLabel: string
  /** Use the primary (yellow) button instead of the plain one. */
  primary?: boolean
}
