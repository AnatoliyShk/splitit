import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState, type RefObject, type SubmitEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { apiPatch, apiPost, useFieldErrors, type FieldErrors } from '../api'
import { useAuth } from '../auth'
import { Field, FormAlert } from '../components/Field'
import type { User } from '../types/api/users'

// After a failed submit, move focus to the first invalid field so it's announced
function useFocusFirstInvalid(formRef: RefObject<HTMLFormElement | null>, errors: FieldErrors) {
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
  }, [formRef, errors])
}

function DetailsForm({ user }: { user: User }) {
  const { setUser } = useAuth()
  const formRef = useRef<HTMLFormElement>(null)
  const [name, setName] = useState(user.name)
  const detailsMutation = useMutation({
    mutationFn: () => apiPatch<{ user: User }>('/api/auth/me/', { name }),
    onSuccess: (userResponse) => {
      setUser(userResponse.user)
      setName(userResponse.user.name)
    },
  })
  const errors = useFieldErrors(detailsMutation.error)
  useFocusFirstInvalid(formRef, errors)

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    detailsMutation.mutate()
  }

  return (
    <section className="profile-card" aria-labelledby="details-title">
      <h2 id="details-title">Your details</h2>
      <form ref={formRef} className="form" onSubmit={onSubmit} noValidate>
        <FormAlert messages={errors.non_field_errors} />
        <Field
          id="name"
          label="Name"
          autoComplete="name"
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            // Hide "Saved" once the name changes again
            if (detailsMutation.isSuccess) detailsMutation.reset()
          }}
          errors={errors.name}
        />
        <Field
          id="email"
          label="Email"
          type="email"
          readOnly
          value={user.email}
          hint="Your email is your login. Ask an admin if it needs to change."
        />
        <div className="form-actions">
          {detailsMutation.isSuccess && (
            <p className="form-status" role="status">
              Saved
            </p>
          )}
          <button
            className="btn btn-confirm"
            type="submit"
            disabled={detailsMutation.isPending || name.trim() === user.name}
          >
            {detailsMutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </section>
  )
}

function PasswordForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const passwordMutation = useMutation({
    mutationFn: () =>
      apiPost('/api/auth/password/', { current_password: currentPassword, new_password: newPassword }),
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
    },
  })
  const errors = useFieldErrors(passwordMutation.error)
  useFocusFirstInvalid(formRef, errors)

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    passwordMutation.mutate()
  }

  return (
    <section className="profile-card" aria-labelledby="password-title">
      <h2 id="password-title">Change password</h2>
      <form ref={formRef} className="form" onSubmit={onSubmit} noValidate>
        <FormAlert messages={errors.non_field_errors} />
        <Field
          id="current_password"
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          errors={errors.current_password}
        />
        <Field
          id="new_password"
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 8 characters, not too common and not only numbers."
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          errors={errors.new_password}
        />
        <div className="form-actions">
          {passwordMutation.isSuccess && (
            <p className="form-status" role="status">
              Password updated
            </p>
          )}
          <button
            className="btn btn-confirm"
            type="submit"
            disabled={passwordMutation.isPending || !currentPassword || !newPassword}
          >
            {passwordMutation.isPending ? 'Updating…' : 'Update password'}
          </button>
        </div>
      </form>
    </section>
  )
}

export default function Settings() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return null
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  return (
    <section className="profile">
      <title>Settings · Splitit</title>
      <div className="panel-head">
        <div>
          <Link className="back-link" to="/profile">
            ← Profile
          </Link>
          <h1>Settings</h1>
        </div>
      </div>

      <div className="profile-grid">
        {/* Keyed by user id so the form resets if a different user logs in */}
        <DetailsForm key={user.id} user={user} />
        <PasswordForm />
      </div>
    </section>
  )
}
