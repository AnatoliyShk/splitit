import { useEffect, useRef, useState, type RefObject, type SubmitEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { apiGet, apiPatch, apiPost, errorsFrom, type FieldErrors, type User } from '../api'
import { useAuth } from '../auth'
import { Field, FormAlert } from '../components/Field'
import { formatDate, formatRange } from './panel/shared'

type MyEvent = {
  id: number
  name: string
  start_datetime: string
  end_datetime: string | null
  attendees_count: number
  tags: string[]
}

type MyCircle = {
  id: number
  name: string
  interest: number
}

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' })

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

function EventRows({ events }: { events: MyEvent[] }) {
  return (
    <ul className="event-list">
      {events.map((e) => (
        <li key={e.id}>
          <span className="event-day event-date">
            {new Date(e.start_datetime).getDate()}
            <small>{monthFormat.format(new Date(e.start_datetime))}</small>
          </span>
          <span className="event-info">
            <strong>{e.name}</strong>
            <small>{formatRange(e.start_datetime, e.end_datetime)}</small>
            {e.tags.length > 0 && (
              <span className="tags event-tags">
                {e.tags.map((t) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))}
              </span>
            )}
          </span>
          <span className="event-going">{e.attendees_count} going</span>
        </li>
      ))}
    </ul>
  )
}

type SplitEvents = { all: MyEvent[]; upcoming: MyEvent[]; past: MyEvent[] }

// Same rule as the admin overview: upcoming until it ends (or starts, if it has no end)
function splitByNow(events: MyEvent[]): SplitEvents {
  const now = Date.now()
  const isUpcoming = (e: MyEvent) => new Date(e.end_datetime ?? e.start_datetime).getTime() >= now
  return {
    all: events,
    upcoming: events.filter(isUpcoming),
    past: events.filter((e) => !isUpcoming(e)).reverse(), // most recent first
  }
}

function MyEvents({ user }: { user: User }) {
  const [data, setData] = useState<SplitEvents | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})

  useEffect(() => {
    apiGet<MyEvent[]>(`/api/users/${user.uuid}/events/`)
      .then((events) => setData(splitByNow(events)))
      .catch((err) => setErrors(errorsFrom(err)))
  }, [user.uuid])

  const events = data?.all
  const upcoming = data?.upcoming ?? []
  const past = data?.past ?? []

  return (
    <section className="profile-card" aria-labelledby="events-title">
      <h2 id="events-title">Your events</h2>
      <FormAlert messages={errors.non_field_errors} />
      {!events && !errors.non_field_errors && <p className="muted">Loading…</p>}
      {events && events.length === 0 && (
        <div className="empty">
          <p>You're not going to any events yet.</p>
          <Link className="btn btn-primary btn-sm" to="/">
            Find events
          </Link>
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="profile-events">
          <h3>Upcoming</h3>
          <EventRows events={upcoming} />
        </div>
      )}
      {past.length > 0 && (
        <div className="profile-events">
          <h3>Past</h3>
          <EventRows events={past} />
        </div>
      )}
    </section>
  )
}

const interestFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

function MyCircles({ user }: { user: User }) {
  const [circles, setCircles] = useState<MyCircle[] | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})

  useEffect(() => {
    // Already sorted by interest, highest first
    apiGet<MyCircle[]>(`/api/users/${user.uuid}/circles/`)
      .then(setCircles)
      .catch((err) => setErrors(errorsFrom(err)))
  }, [user.uuid])

  return (
    <section className="profile-card" aria-labelledby="circles-title">
      <h2 id="circles-title">Your social circles</h2>
      <FormAlert messages={errors.non_field_errors} />
      {!circles && !errors.non_field_errors && <p className="muted">Loading…</p>}
      {circles && circles.length === 0 && (
        <div className="empty">
          <p>You're not in any social circles yet.</p>
        </div>
      )}
      {circles && circles.length > 0 && (
        <ul className="event-list">
          {circles.map((c) => (
            <li key={c.id}>
              <span className="event-info">
                <strong>{c.name}</strong>
              </span>
              <span className="event-going">Interest {interestFormat.format(c.interest)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

type MyConnection = {
  uuid: string
  name: string
  strength: number
  shared_events: number
}

const strengthFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function MyConnections({ user }: { user: User }) {
  const [connections, setConnections] = useState<MyConnection[] | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})

  useEffect(() => {
    // Already sorted by strength, strongest first
    apiGet<MyConnection[]>(`/api/users/${user.uuid}/connections/`)
      .then(setConnections)
      .catch((err) => setErrors(errorsFrom(err)))
  }, [user.uuid])

  return (
    <section className="profile-card" aria-labelledby="connections-title">
      <h2 id="connections-title">Your connections</h2>
      <FormAlert messages={errors.non_field_errors} />
      {!connections && !errors.non_field_errors && <p className="muted">Loading…</p>}
      {connections && connections.length === 0 && (
        <div className="empty">
          <p>Go to an event to start connecting with people.</p>
          <Link className="btn btn-primary btn-sm" to="/">
            Find events
          </Link>
        </div>
      )}
      {connections && connections.length > 0 && (
        <ul className="event-list">
          {connections.map((c) => (
            <li key={c.uuid}>
              <span className="event-info">
                <strong>{c.name}</strong>
                <small>{c.shared_events === 1 ? '1 shared event' : `${c.shared_events} shared events`}</small>
              </span>
              <span className="event-going">Strength {strengthFormat.format(c.strength)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function Profile() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return null
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  return (
    <section className="profile">
      <title>Profile · Splitit</title>
      <div className="profile-hero">
        <span className="profile-avatar" aria-hidden="true">
          {user.name.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <div className="profile-id">
          <h1>{user.name}</h1>
          <p>{user.email}</p>
        </div>
        <span className="tags">
          <span className="tag">Member since {formatDate(user.date_joined)}</span>
          {user.is_staff && <span className="tag">Admin</span>}
        </span>
      </div>

      <div className="profile-grid">
        {/* Keyed by user id so the form resets if a different user logs in */}
        <DetailsForm key={user.id} user={user} />
        <PasswordForm />
      </div>

      <MyCircles user={user} />

      <MyConnections user={user} />

      <MyEvents user={user} />
    </section>
  )
}
