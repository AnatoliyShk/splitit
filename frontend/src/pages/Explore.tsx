import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { ApiError, apiGet, apiPost, errorsFrom, type FieldErrors } from '../api'
import { useAuth } from '../auth'
import { FormAlert } from '../components/Field'
import { formatDateTime, formatTimes } from './panel/shared'

type ExploreOccasion = {
  id: number
  name: string
  start_datetime: string
  end_datetime: string | null
  attendees_count: number
  tags: string[]
  main_image: string | null
  // Attendees the user has a connection with
  known_attendees: { uuid: string; name: string }[]
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

const listFormat = new Intl.ListFormat(undefined, { type: 'conjunction' })
// Names shown on a card before the rest collapse into "N more"
const KNOWN_SHOWN = 3

function knownText(known: ExploreOccasion['known_attendees'], others: number) {
  if (known.length === 0) return null
  const names = known.slice(0, KNOWN_SHOWN).map((k) => k.name)
  const rest = known.length - names.length
  const list = listFormat.format(rest > 0 ? [...names, `${rest} more`] : names)
  if (others === 1) return `You know them: ${list}`
  if (known.length === others) return `You know all of them: ${list}`
  return `You know ${known.length} of them: ${list}`
}

function OccasionCard({ occasion, mine = false }: { occasion: ExploreOccasion; mine?: boolean }) {
  const start = new Date(occasion.start_datetime)
  const known = knownText(occasion.known_attendees, occasion.attendees_count - (mine ? 1 : 0))
  return (
    <article className="explore-card" aria-labelledby="explore-occasion-name">
      {occasion.main_image && <img className="explore-image" src={occasion.main_image} alt="" />}
      <div className="explore-title">
        <time className="explore-day" dateTime={occasion.start_datetime}>
          {start.getDate()}
          <small>{monthFormat.format(start)}</small>
        </time>
        <div>
          <h2 id="explore-occasion-name">
            {/* Its ::after stretches over the whole card, so clicking anywhere on it opens the occasion */}
            <Link className="card-link" to={`/occasions/${occasion.id}`}>
              {occasion.name}
            </Link>
          </h2>
          {/* The badge already shows the date, so this line shows the times */}
          <p className="explore-when">{formatTimes(occasion.start_datetime, occasion.end_datetime)}</p>
        </div>
      </div>
      {occasion.tags.length > 0 && (
        <span className="tags">
          {occasion.tags.map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
        </span>
      )}
      <div className="explore-going">
        <p>{goingText(occasion.attendees_count, mine)}</p>
        {known && <p className="muted">{known}</p>}
      </div>
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
  // Declined occasions, by id, so a refresh doesn't bring them back
  const [declined, setDeclined] = useState<ReadonlySet<number>>(new Set())
  const [errors, setErrors] = useState<FieldErrors>({})
  const [joining, setJoining] = useState(false)
  const [status, setStatus] = useState('')

  const load = useCallback(() => {
    // Already sorted soonest first, without occasions the user is going to
    return apiGet<ExploreData>('/api/occasions/explore/')
      .then(setData)
      .catch((err) => setErrors(errorsFrom(err)))
  }, [])

  useEffect(() => {
    if (!user) return
    load()
    // Occasions can be cancelled or end while the page is open: refresh whenever the user comes back to it
    function onVisible() {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [user, load])

  if (loading) return null
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  // Declined first, so the counter keeps its place when a refresh drops or adds occasions
  const occasions = data && [
    ...data.occasions.filter((o) => declined.has(o.id)),
    ...data.occasions.filter((o) => !declined.has(o.id)),
  ]
  const index = data ? data.occasions.filter((o) => declined.has(o.id)).length : 0
  const active = data?.active_occasion
  const occasion = active ? undefined : occasions?.[index]

  function decline() {
    if (!occasion) return
    setErrors({})
    setStatus(`Skipped ${occasion.name}`)
    setDeclined((d) => new Set(d).add(occasion.id))
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
      // 409: already going somewhere (joined in another tab, say), so show that occasion instead of the deck.
      // 404: the occasion was cancelled or ended since the deck loaded, so drop it.
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) load()
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
