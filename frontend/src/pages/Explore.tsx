import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { apiGet, apiPost, errorsFrom, type FieldErrors } from '../api'
import { useAuth } from '../auth'
import { FormAlert } from '../components/Field'
import { formatRange } from './panel/shared'

type ExploreEvent = {
  id: number
  name: string
  start_datetime: string
  end_datetime: string | null
  attendees_count: number
  tags: string[]
}

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' })

function EventCard({ event }: { event: ExploreEvent }) {
  const start = new Date(event.start_datetime)
  return (
    <article className="explore-card" aria-labelledby="explore-event-name">
      <span className="explore-day" aria-hidden="true">
        {start.getDate()}
        <small>{monthFormat.format(start)}</small>
      </span>
      <h2 id="explore-event-name">{event.name}</h2>
      <p className="explore-when">{formatRange(event.start_datetime, event.end_datetime)}</p>
      {event.tags.length > 0 && (
        <span className="tags">
          {event.tags.map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
        </span>
      )}
      <p className="explore-going">
        {event.attendees_count === 0
          ? 'Nobody is going yet. Be the first!'
          : `${event.attendees_count} ${event.attendees_count === 1 ? 'person is' : 'people are'} going`}
      </p>
    </article>
  )
}

export default function Explore() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [events, setEvents] = useState<ExploreEvent[] | null>(null)
  const [index, setIndex] = useState(0)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [joining, setJoining] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!user) return
    // Already sorted soonest first, without events the user is going to
    apiGet<ExploreEvent[]>('/api/events/explore/')
      .then(setEvents)
      .catch((err) => setErrors(errorsFrom(err)))
  }, [user])

  if (loading) return null
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  const event = events?.[index]

  function decline() {
    if (!event) return
    setErrors({})
    setStatus(`Skipped ${event.name}`)
    setIndex((i) => i + 1)
  }

  async function accept() {
    if (!event) return
    setJoining(true)
    setErrors({})
    try {
      await apiPost(`/api/events/${event.id}/join/`)
      setStatus(`You're going to ${event.name}`)
      setIndex((i) => i + 1)
    } catch (err) {
      setErrors(errorsFrom(err))
    } finally {
      setJoining(false)
    }
  }

  return (
    <section className="explore">
      <title>Explore · Splitit</title>
      <div className="explore-head">
        <h1>Explore</h1>
        {events && event && (
          <p className="muted">
            {index + 1} of {events.length}
          </p>
        )}
      </div>

      <FormAlert messages={errors.non_field_errors} />
      <p className="visually-hidden" role="status">
        {status}
      </p>

      {!events && !errors.non_field_errors && <p className="muted">Loading…</p>}

      {events && !event && (
        <div className="explore-card explore-done">
          <h2>{events.length === 0 ? 'No new events right now' : "You're all caught up"}</h2>
          <p className="muted">Check back later for more events, or see the ones you're going to.</p>
          <Link className="btn btn-primary" to="/profile">
            Your events
          </Link>
        </div>
      )}

      {event && (
        <>
          {/* Keyed by event id so the entrance animation replays for each card */}
          <EventCard key={event.id} event={event} />
          <div className="explore-actions">
            <button className="btn" type="button" onClick={decline} disabled={joining}>
              Decline
            </button>
            <button className="btn btn-confirm" type="button" onClick={accept} disabled={joining}>
              {joining ? 'Joining…' : 'Accept'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
