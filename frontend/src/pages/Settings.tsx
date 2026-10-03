import { useEffect, useRef, useState, type RefObject, type SubmitEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { apiPatch, apiPost, errorsFrom, type FieldErrors, type User } from '../api'
import { useAuth } from '../auth'
import { Field, FormAlert } from '../components/Field'

// After a failed submit, move focus to the first invalid field so it's announced
function useFocusFirstInvalid(ref: RefObject<HTMLFormElement | null>, errors: FieldErrors) {
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
  }, [ref, errors])
}

function DetailsForm({ user }: { user: User }) {
  const { setUser } = useAuth()
  const formRef = useRef<HTMLFormElement>(null)
  const [name, setName] = useState(user.name)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  useFocusFirstInvalid(formRef, errors)

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    setSaved(false)
    try {
      const d = await apiPatch<{ user: User }>('/api/auth/me/', { name })
      setUser(d.user)
      setName(d.user.name)
      setSaved(true)
    } catch (err) {
      setErrors(errorsFrom(err))
    } finally {
      setSaving(false)
    }
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
          onChange={(e) => {
            setName(e.target.value)
            setSaved(false)
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
          {saved && (
            <p className="form-status" role="status">
              Saved
            </p>
          )}
          <button className="btn btn-confirm" type="submit" disabled={saving || name.trim() === user.name}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </section>
  )
}

function PasswordForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  useFocusFirstInvalid(formRef, errors)

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    setSaved(false)
    try {
      await apiPost('/api/auth/password/', { current_password: current, new_password: next })
      setCurrent('')
      setNext('')
      setSaved(true)
    } catch (err) {
      setErrors(errorsFrom(err))
    } finally {
      setSaving(false)
    }
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
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          errors={errors.current_password}
        />
        <Field
          id="new_password"
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 8 characters, not too common and not only numbers."
          value={next}
          onChange={(e) => setNext(e.target.value)}
          errors={errors.new_password}
        />
        <div className="form-actions">
          {saved && (
            <p className="form-status" role="status">
              Password updated
            </p>
          )}
          <button className="btn btn-confirm" type="submit" disabled={saving || !current || !next}>
            {saving ? 'Updating…' : 'Update password'}
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
