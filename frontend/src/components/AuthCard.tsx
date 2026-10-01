import { useEffect, useRef, type ReactNode, type SubmitEvent } from 'react'
import { Navigate, NavLink, useLocation } from 'react-router'
import type { FieldErrors } from '../api'
import { useAuth } from '../auth'
import { FormAlert } from './Field'

type AuthCardProps = {
  title: string
  subtitle: string
  errors: FieldErrors
  onSubmit: (e: SubmitEvent<HTMLFormElement>) => void
  children: ReactNode
}

const tabs = [
  { to: '/login', label: 'Log in' },
  { to: '/register', label: 'Create account' },
]

// Shared shell for the login and register pages: folder tabs switch between the two forms
export function AuthCard({ title, subtitle, errors, onSubmit, children }: AuthCardProps) {
  const { user, loading } = useAuth()
  const formRef = useRef<HTMLFormElement>(null)
  // Pages that require login send visitors here with the path to return to afterwards
  const { state } = useLocation()
  const from = (state as { from?: string } | null)?.from
  const returnTo = from?.startsWith('/') ? from : '/'

  // After a failed submit, move focus to the first invalid field so it's announced
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
  }, [errors])

  if (!loading && user) return <Navigate to={returnTo} replace />

  return (
    <section className="auth">
      <div className="auth-panel">
        <nav className="tabs" aria-label="Account">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} state={state} className="tab" replace>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="tabbed-card auth-card">
          <div className="auth-head">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <form ref={formRef} className="form" onSubmit={onSubmit} noValidate>
            <FormAlert messages={errors.non_field_errors} />
            {children}
          </form>
        </div>
      </div>
    </section>
  )
}
