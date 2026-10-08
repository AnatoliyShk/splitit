// Props and UI state types for components/Modal.tsx

import type { ReactNode } from 'react'

export type ModalProps = {
  open: boolean
  /** Called on the close button, Escape and a click on the backdrop; the parent sets `open` to false. */
  onClose: () => void
  /** Shown as the dialog's heading and used as its accessible name. */
  title: string
  children: ReactNode
  className?: string
}
