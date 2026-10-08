import type { ReactNode } from 'react'
import type { CheckboxFieldProps, FieldProps, TextAreaFieldProps } from '../types/ui/field'

// Label, hint and errors around a control, wired up with aria-describedby
function FieldFrame({
  id,
  label,
  hint,
  errors,
  control,
}: {
  id: string
  label: string
  hint?: string
  errors?: string[]
  control: (describedBy: string | undefined, hasErrors: boolean) => ReactNode
}) {
  const { describedBy, hasErrors, notes } = fieldNotes(id, hint, errors)
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {control(describedBy, hasErrors)}
      {notes}
    </div>
  )
}

// The hint and errors under a control, with the ids the control points to in aria-describedby
function fieldNotes(id: string, hint: ReactNode, errors: string[] | undefined) {
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const hasErrors = Boolean(errors?.length)
  const describedBy = [hint && hintId, hasErrors && errorId].filter(Boolean).join(' ') || undefined
  const notes = (
    <>
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
    </>
  )
  return { describedBy, hasErrors, notes }
}

export function Field({ id, label, hint, errors, ...input }: FieldProps) {
  return (
    <FieldFrame
      id={id}
      label={label}
      hint={hint}
      errors={errors}
      control={(describedBy, hasErrors) => (
        <input
          id={id}
          name={id}
          className="input"
          aria-invalid={hasErrors || undefined}
          aria-describedby={describedBy}
          {...input}
        />
      )}
    />
  )
}

/** Field's multi-line twin, for longer text like an occasion's description. */
export function TextAreaField({ id, label, hint, errors, ...textarea }: TextAreaFieldProps) {
  return (
    <FieldFrame
      id={id}
      label={label}
      hint={hint}
      errors={errors}
      control={(describedBy, hasErrors) => (
        <textarea
          id={id}
          name={id}
          className="input input-textarea"
          aria-invalid={hasErrors || undefined}
          aria-describedby={describedBy}
          {...textarea}
        />
      )}
    />
  )
}

/** A checkbox with its label beside it, for a yes/no statement the user makes (styles: `.check` in App.css). */
export function CheckboxField({ id, label, hint, errors, ...input }: CheckboxFieldProps) {
  const { describedBy, hasErrors, notes } = fieldNotes(id, hint, errors)
  return (
    <div className="field">
      <label className="check" htmlFor={id}>
        <input
          id={id}
          name={id}
          type="checkbox"
          aria-invalid={hasErrors || undefined}
          aria-describedby={describedBy}
          {...input}
        />
        {label}
      </label>
      {notes}
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
