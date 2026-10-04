import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { apiGet, errorsFrom, type FieldErrors, type User } from '../api'
import { useAuth } from '../auth'
import { FormAlert } from '../components/Field'
import { formatDate, formatRange } from './panel/shared'

type MyOccasion = {
  id: number
  name: string
  start_datetime: string
  end_datetime: string | null
  cancelled_at: string | null
  attendees_count: number
  tags: string[]
  main_image: string | null
}

// Sigma and graphology are big; load them only when someone has connections to draw
const ConnectionsGraph = lazy(() => import('../components/ConnectionsGraph'))

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' })

function OccasionRows({ occasions }: { occasions: MyOccasion[] }) {
  return (
    <ul className="occasion-list">
      {occasions.map((o) => (
        <li key={o.id}>
          <Link className="occasion-row" to={`/occasions/${o.id}`}>
            {o.main_image ? (
              <img className="occasion-day occasion-thumb" src={o.main_image} alt="" />
            ) : (
              <span className="occasion-day occasion-date">
                {new Date(o.start_datetime).getDate()}
                <small>{monthFormat.format(new Date(o.start_datetime))}</small>
              </span>
            )}
            <span className="occasion-info">
              <strong>{o.name}</strong>
              <small>{formatRange(o.start_datetime, o.end_datetime)}</small>
              {(o.cancelled_at || o.tags.length > 0) && (
                <span className="tags occasion-tags">
                  {o.cancelled_at && <span className="tag tag-off">Cancelled</span>}
                  {o.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className="occasion-going">{o.attendees_count} going</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

type SplitOccasions = { all: MyOccasion[]; upcoming: MyOccasion[]; past: MyOccasion[] }

// Same rule as the admin overview: upcoming until it ends (or starts, if it has no end)
function splitByNow(occasions: MyOccasion[]): SplitOccasions {
  const now = Date.now()
  const isUpcoming = (o: MyOccasion) => new Date(o.end_datetime ?? o.start_datetime).getTime() >= now
  return {
    all: occasions,
    upcoming: occasions.filter(isUpcoming),
    past: occasions.filter((o) => !isUpcoming(o)).reverse(), // most recent first
  }
}

function MyOccasions({ user }: { user: User }) {
  const [data, setData] = useState<SplitOccasions | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})

  useEffect(() => {
    apiGet<MyOccasion[]>(`/api/users/${user.uuid}/occasions/`)
      .then((occasions) => setData(splitByNow(occasions)))
      .catch((err) => setErrors(errorsFrom(err)))
  }, [user.uuid])

  const occasions = data?.all
  const upcoming = data?.upcoming ?? []
  const past = data?.past ?? []

  return (
    <section className="profile-card" aria-labelledby="occasions-title">
      <h2 id="occasions-title">Your occasions</h2>
      <FormAlert messages={errors.non_field_errors} />
      {!occasions && !errors.non_field_errors && <p className="muted">Loading…</p>}
      {occasions && occasions.length === 0 && (
        <div className="empty">
          <p>You're not going to any occasions yet.</p>
          <Link className="btn btn-primary btn-sm" to="/">
            Find occasions
          </Link>
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="profile-occasions">
          <h3>Upcoming</h3>
          <OccasionRows occasions={upcoming} />
        </div>
      )}
      {past.length > 0 && (
        <div className="profile-occasions">
          <h3>Past</h3>
          <OccasionRows occasions={past} />
        </div>
      )}
    </section>
  )
}

type MyConnection = {
  uuid: string
  name: string
  strength: number
  shared_occasions: number
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
          <p>Go to an occasion to start connecting with people.</p>
          <Link className="btn btn-primary btn-sm" to="/">
            Find occasions
          </Link>
        </div>
      )}
      {connections && connections.length > 0 && (
        <Suspense fallback={<div className="connections-graph" aria-hidden="true" />}>
          <ConnectionsGraph userUuid={user.uuid} />
        </Suspense>
      )}
      {connections && connections.length > 0 && (
        <ul className="occasion-list">
          {connections.map((c) => (
            <li key={c.uuid}>
              <span className="occasion-info">
                <strong>{c.name}</strong>
                <small>
                  {c.shared_occasions === 1 ? '1 shared occasion' : `${c.shared_occasions} shared occasions`}
                </small>
              </span>
              <span className="occasion-going">Strength {strengthFormat.format(c.strength)}</span>
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
        <Link className="btn btn-sm" to="/profile/settings">
          Settings
        </Link>
      </div>

      <MyConnections user={user} />

      <MyOccasions user={user} />
    </section>
  )
}
