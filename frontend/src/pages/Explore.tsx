import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { apiGet, apiPost, errorsFrom, type FieldErrors } from '../api'
import { useAuth } from '../auth'
import { FormAlert } from '../components/Field'
import { formatRange } from './panel/shared'

type ExploreOccasion = {
  id: number
  name: string
  start_datetime: string
  end_datetime: string | null
  attendees_count: number
  tags: string[]
}

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' })

function OccasionCard({ occasion }: { occasion: ExploreOccasion }) {
  const start = new Date(occasion.start_datetime)
  return (
    <article className="explore-card" aria-labelledby="explore-occasion-name">
      <span className="explore-day" aria-hidden="true">
        {start.getDate()}
        <small>{monthFormat.format(start)}</small>
      </span>
      <h2 id="explore-occasion-name">{occasion.name}</h2>
      <p className="explore-when">{formatRange(occasion.start_datetime, occasion.end_datetime)}</p>
      {occasion.tags.length > 0 && (
        <span className="tags">
          {occasion.tags.map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
        </span>
      )}
      <p className="explore-going">
        {occasion.attendees_count === 0
          ? 'Nobody is going yet. Be the first!'
          : `${occasion.attendees_count} ${occasion.attendees_count === 1 ? 'person is' : 'people are'} going`}
      </p>
    </article>
  )
}

export default function Explore() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [occasions, setOccasions] = useState<ExploreOccasion[] | null>(null)
  const [index, setIndex] = useState(0)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [joining, setJoining] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!user) return
    // Already sorted soonest first, without occasions the user is going to
    apiGet<ExploreOccasion[]>('/api/occasions/explore/')
      .then(setOccasions)
      .catch((err) => setErrors(errorsFrom(err)))
  }, [user])

  if (loading) return null
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  const occasion = occasions?.[index]

  function decline() {
    if (!occasion) return
    setErrors({})
    setStatus(`Skipped ${occasion.name}`)
    setIndex((i) => i + 1)
  }

  async function accept() {
    if (!occasion) return
    setJoining(true)
    setErrors({})
    try {
      await apiPost(`/api/occasions/${occasion.id}/join/`)
      setStatus(`You're going to ${occasion.name}`)
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
        {occasions && occasion && (
          <p className="muted">
            {index + 1} of {occasions.length}
          </p>
        )}
      </div>

      <FormAlert messages={errors.non_field_errors} />
      <p className="visually-hidden" role="status">
        {status}
      </p>

      {!occasions && !errors.non_field_errors && <p className="muted">Loading…</p>}

      {occasions && !occasion && (
        <div className="explore-card explore-done">
          <h2>{occasions.length === 0 ? 'No new occasions right now' : "You're all caught up"}</h2>
          <p className="muted">Check back later for more occasions, or see the ones you're going to.</p>
          <Link className="btn btn-primary" to="/profile">
            Your occasions
          </Link>
        </div>
      )}

      {occasion && (
        <>
          {/* Keyed by occasion id so the entrance animation replays for each card */}
          <OccasionCard key={occasion.id} occasion={occasion} />
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
