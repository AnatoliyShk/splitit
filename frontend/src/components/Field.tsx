import type { InputHTMLAttributes } from 'react'

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string
  label: string
  hint?: string
  errors?: string[]
}

export function Field({ id, label, hint, errors, ...input }: FieldProps) {
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const hasErrors = Boolean(errors?.length)
  const describedBy = [hint && hintId, hasErrors && errorId].filter(Boolean).join(' ')

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        className="input"
        aria-invalid={hasErrors || undefined}
        aria-describedby={describedBy || undefined}
        {...input}
      />
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {hasErrors && (
        <ul className="field-errors" id={errorId}>
          {errors!.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function FormAlert({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null
  return (
    <div className="form-alert" role="alert">
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  )
}
