// Props and UI state types for components/Field.tsx

import type { InputHTMLAttributes } from 'react'

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string
  label: string
  hint?: string
  errors?: string[]
}
