import { lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useLocation } from 'react-router'
import { apiGet, useFieldErrors } from '../api'
import { useAuth } from '../auth'
import { FormAlert } from '../components/Field'
import { TagList } from '../components/TagList'
import { queryKeys } from '../queryClient'
import type { Connection } from '../types/api/connections'
import type { UserOccasion } from '../types/api/occasions'
import type { User } from '../types/api/users'
import { formatDate, formatRange } from './panel/shared'

// Sigma and graphology are big; load them only when someone has connections to draw
const ConnectionsGraph = lazy(() => import('../components/ConnectionsGraph'))

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' })

function OccasionRows({ occasions }: { occasions: UserOccasion[] }) {
  return (
    <ul className="occasion-list">
      {occasions.map((occasion) => (
        <li key={occasion.id}>
          <Link className="occasion-row" to={`/occasions/${occasion.id}`}>
            {occasion.main_image ? (
              <img className="occasion-day occasion-thumb" src={occasion.main_image} alt="" />
            ) : (
              <span className="occasion-day occasion-date">
                {new Date(occasion.start_datetime).getDate()}
                <small>{monthFormat.format(new Date(occasion.start_datetime))}</small>
              </span>
            )}
            <div className="occasion-info">
              <strong>{occasion.name}</strong>
              <small>{formatRange(occasion.start_datetime, occasion.end_datetime)}</small>
              <TagList
                className="occasion-tags"
                tagNames={occasion.tags}
                statusTags={occasion.cancelled_at ? [{ label: 'Cancelled', off: true }] : []}
              />
            </div>
            <span className="occasion-going">{occasion.attendees_count} going</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

type SplitOccasions = Record<'all' | 'upcoming' | 'past', UserOccasion[]>

// Same rule as the admin overview: upcoming until it ends (or starts, if it has no end)
function splitByNow(occasions: UserOccasion[]): SplitOccasions {
  const now = Date.now()
  const isUpcoming = (occasion: UserOccasion) =>
    new Date(occasion.end_datetime ?? occasion.start_datetime).getTime() >= now
  return {
    all: occasions,
    upcoming: occasions.filter(isUpcoming),
    past: occasions.filter((occasion) => !isUpcoming(occasion)).reverse(), // most recent first
  }
}

function MyOccasions({ user }: { user: User }) {
  const occasionsQuery = useQuery({
    queryKey: queryKeys.userOccasions(user.uuid),
    queryFn: () => apiGet<UserOccasion[]>(`/api/users/${user.uuid}/occasions/`),
    select: splitByNow,
  })
  const errors = useFieldErrors(occasionsQuery.error)

  const occasions = occasionsQuery.data?.all
  const upcomingOccasions = occasionsQuery.data?.upcoming ?? []
  const pastOccasions = occasionsQuery.data?.past ?? []

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
      {upcomingOccasions.length > 0 && (
        <div className="profile-occasions">
          <h3>Upcoming</h3>
          <OccasionRows occasions={upcomingOccasions} />
        </div>
      )}
      {pastOccasions.length > 0 && (
        <div className="profile-occasions">
          <h3>Past</h3>
          <OccasionRows occasions={pastOccasions} />
        </div>
      )}
    </section>
  )
}

const strengthFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function MyConnections({ user }: { user: User }) {
  // Already sorted by strength, strongest first
  const connectionsQuery = useQuery({
    queryKey: queryKeys.userConnections(user.uuid),
    queryFn: () => apiGet<Connection[]>(`/api/users/${user.uuid}/connections/`),
  })
  const connections = connectionsQuery.data
  const errors = useFieldErrors(connectionsQuery.error)

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
          {connections.map((connection) => (
            <li key={connection.uuid}>
              <span className="occasion-info">
                <strong>{connection.name}</strong>
                <small>
                  {connection.shared_occasions === 1
                    ? '1 shared occasion'
                    : `${connection.shared_occasions} shared occasions`}
                </small>
              </span>
              <span className="occasion-going">Strength {strengthFormat.format(connection.strength)}</span>
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
