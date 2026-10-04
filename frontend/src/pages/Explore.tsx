import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { ApiError, apiGet, apiPost, errorsFrom, type FieldErrors } from '../api'
import { useAuth } from '../auth'
import { FormAlert } from '../components/Field'
import { formatDateTime, formatRange } from './panel/shared'

type ExploreOccasion = {
  id: number
  name: string
  start_datetime: string
  end_datetime: string | null
  attendees_count: number
  tags: string[]
  main_image: string | null
}

// A user goes to one occasion at a time: while `active_occasion` is set, `occasions` is empty
type ExploreData = { active_occasion: ExploreOccasion | null; occasions: ExploreOccasion[] }

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' })

function goingText(count: number, includesMe: boolean) {
  if (includesMe) {
    const others = count - 1
    if (others <= 0) return "You're the first one going"
    return `You and ${others} ${others === 1 ? 'other person are' : 'others are'} going`
  }
  if (count === 0) return 'Nobody is going yet. Be the first!'
  return `${count} ${count === 1 ? 'person is' : 'people are'} going`
}

function OccasionCard({ occasion, mine = false }: { occasion: ExploreOccasion; mine?: boolean }) {
  const start = new Date(occasion.start_datetime)
  return (
    <article className="explore-card" aria-labelledby="explore-occasion-name">
      {occasion.main_image && <img className="explore-image" src={occasion.main_image} alt="" />}
      <span className="explore-day" aria-hidden="true">
        {start.getDate()}
        <small>{monthFormat.format(start)}</small>
      </span>
      <h2 id="explore-occasion-name">
        {/* Its ::after stretches over the whole card, so clicking anywhere on it opens the occasion */}
        <Link className="card-link" to={`/occasions/${occasion.id}`}>
          {occasion.name}
        </Link>
      </h2>
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
      <p className="explore-going">{goingText(occasion.attendees_count, mine)}</p>
    </article>
  )
}

function ActiveOccasion({ occasion }: { occasion: ExploreOccasion }) {
  // Same rule as the server: an occasion with no end is over once it starts
  const endsAt = formatDateTime(occasion.end_datetime ?? occasion.start_datetime)
  return (
    <div className="explore-active">
      <p className="explore-eyebrow">You're going to</p>
      <OccasionCard occasion={occasion} mine />
      <p className="muted">
        You can join your next occasion once this one ends ({endsAt}) or if it's cancelled. Until then, Explore is
        paused.
      </p>
      <Link className="btn btn-primary" to="/profile">
        Your occasions
      </Link>
    </div>
  )
}

export default function Explore() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [data, setData] = useState<ExploreData | null>(null)
  const [index, setIndex] = useState(0)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [joining, setJoining] = useState(false)
  const [status, setStatus] = useState('')

  const load = useCallback(() => {
    // Already sorted soonest first, without occasions the user is going to
    return apiGet<ExploreData>('/api/occasions/explore/')
      .then((d) => {
        setData(d)
        setIndex(0)
      })
      .catch((err) => setErrors(errorsFrom(err)))
  }, [])

  useEffect(() => {
    if (user) load()
  }, [user, load])

  if (loading) return null
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  const occasions = data?.occasions
  const active = data?.active_occasion
  const occasion = active ? undefined : occasions?.[index]

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
      // Joining makes it the active occasion, which pauses the rest of Explore
      setData({ active_occasion: { ...occasion, attendees_count: occasion.attendees_count + 1 }, occasions: [] })
    } catch (err) {
      setErrors(errorsFrom(err))
      // Already going somewhere (joined in another tab, say): show that occasion instead of the deck
      if (err instanceof ApiError && err.status === 409) load()
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

      <aside className="explore-rule" aria-labelledby="explore-rule-title">
        <h2 id="explore-rule-title">One occasion at a time</h2>
        <p>
          Accepting an occasion saves your spot and pauses Explore. Once it ends or is cancelled, you can pick your
          next one.
        </p>
      </aside>

      <FormAlert messages={errors.non_field_errors} />
      <p className="visually-hidden" role="status">
        {status}
      </p>

      {!data && !errors.non_field_errors && <p className="muted">Loading…</p>}

      {active && <ActiveOccasion occasion={active} />}

      {occasions && !active && !occasion && (
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
