// Props and UI state types for components/Field.tsx

import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string
  label: string
  hint?: string
  errors?: string[]
}

export type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  id: string
  label: string
  hint?: string
  errors?: string[]
}
