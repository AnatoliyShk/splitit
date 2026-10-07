// Props and UI state types for components/AuthCard.tsx

import type { ReactNode, SubmitEvent } from 'react'
import type { FieldErrors } from '../../api'

export type AuthCardProps = {
  title: string
  subtitle: string
  errors: FieldErrors
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void
  children: ReactNode
}
