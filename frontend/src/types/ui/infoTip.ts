// Props and UI state types for components/InfoTip.tsx

import type { ReactNode } from 'react'

export type InfoTipProps = {
  /** Names the info button for screen readers, e.g. "About one occasion at a time". */
  label: string
  /** The tooltip's text. */
  children: ReactNode
  className?: string
}
