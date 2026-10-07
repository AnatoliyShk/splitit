// Props and UI state types for components/RollOut.tsx

import type { ReactNode } from 'react'

export type RollOutProps = {
  /** What the toggle button shows. A function gets whether it's open, e.g. for "Show details" / "Hide details". */
  toggle: ReactNode | ((open: boolean) => ReactNode)
  /** The content that rolls open. */
  children: ReactNode
  /** The toggle as a header above the content, or as a strip below it. */
  togglePosition?: 'before' | 'after'
  /** Classes for the toggle button and for the rolling content, on top of the shared `roll-out-*` styles. */
  toggleClassName?: string
  className?: string
  onOpenChange?: (open: boolean) => void
}
