import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { ApiError, apiGet, apiPost, useFieldErrors } from '../api'
import { useAuth } from '../auth'
import { FormAlert } from '../components/Field'
import { queryKeys } from '../queryClient'
import type { ExploreOccasion, KnownAttendee } from '../types/occasions'
import { formatDateTime, formatTimes } from './panel/shared'

// A user goes to one occasion at a time: while `active_occasion` is set, `occasions` is empty
type ExploreData = { active_occasion: ExploreOccasion | null; occasions: ExploreOccasion[] }

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' })

function goingText(attendeesCount: number, includesMe: boolean) {
  if (includesMe) {
    const othersCount = attendeesCount - 1
    if (othersCount <= 0) return "You're the first one going"
    return `You and ${othersCount} ${othersCount === 1 ? 'other person are' : 'others are'} going`
  }
  if (attendeesCount === 0) return 'Nobody is going yet. Be the first!'
  return `${attendeesCount} ${attendeesCount === 1 ? 'person is' : 'people are'} going`
}

const listFormat = new Intl.ListFormat(undefined, { type: 'conjunction' })
// Names shown on a card before the rest collapse into "N more"
const KNOWN_SHOWN = 3

function knownText(knownAttendees: KnownAttendee[], othersCount: number) {
  if (knownAttendees.length === 0) return null
  const shownNames = knownAttendees.slice(0, KNOWN_SHOWN).map((knownAttendee) => knownAttendee.name)
  const restCount = knownAttendees.length - shownNames.length
  const namesList = listFormat.format(restCount > 0 ? [...shownNames, `${restCount} more`] : shownNames)
  if (othersCount === 1) return `You know them: ${namesList}`
  if (knownAttendees.length === othersCount) return `You know all of them: ${namesList}`
  return `You know ${knownAttendees.length} of them: ${namesList}`
}

function OccasionCard({ occasion, mine = false }: { occasion: ExploreOccasion; mine?: boolean }) {
  const startDate = new Date(occasion.start_datetime)
  const knownAttendeesText = knownText(occasion.known_attendees, occasion.attendees_count - (mine ? 1 : 0))
  return (
    <article className="explore-card" aria-labelledby="explore-occasion-name">
      {occasion.main_image && <img className="explore-image" src={occasion.main_image} alt="" />}
      <div className="explore-title">
        <time className="explore-day" dateTime={occasion.start_datetime}>
          {startDate.getDate()}
          <small>{monthFormat.format(startDate)}</small>
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
          {occasion.tags.map((tagName) => (
            <span className="tag" key={tagName}>
              {tagName}
            </span>
          ))}
        </span>
      )}
      <div className="explore-going">
        <p>{goingText(occasion.attendees_count, mine)}</p>
        {knownAttendeesText && <p className="muted">{knownAttendeesText}</p>}
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
  const queryClient = useQueryClient()
  // Declined occasions, by id, so a refresh doesn't bring them back
  const [declinedIds, setDeclinedIds] = useState<ReadonlySet<number>>(new Set())
  const [statusMessage, setStatusMessage] = useState('')

  const exploreQuery = useQuery({
    queryKey: queryKeys.explore,
    // Already sorted soonest first, without occasions the user is going to
    queryFn: () => apiGet<ExploreData>('/api/occasions/explore/'),
    enabled: Boolean(user),
    // Occasions can be cancelled or end while the page is open: refresh whenever the user comes back to it
    refetchOnWindowFocus: true,
  })

  const joinMutation = useMutation({
    mutationFn: (occasion: ExploreOccasion) => apiPost(`/api/occasions/${occasion.id}/join/`),
    onSuccess: (_, occasion) => {
      setStatusMessage(`You're going to ${occasion.name}`)
      // Joining makes it the active occasion, which pauses the rest of Explore
      queryClient.setQueryData<ExploreData>(queryKeys.explore, {
        active_occasion: { ...occasion, attendees_count: occasion.attendees_count + 1 },
        occasions: [],
      })
    },
    onError: (error) => {
      // 409: already going somewhere (joined in another tab, say), so show that occasion instead of the deck.
      // 404: the occasion was cancelled or ended since the deck loaded, so drop it.
      if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
        queryClient.invalidateQueries({ queryKey: queryKeys.explore })
      }
    },
  })
  const errors = useFieldErrors(joinMutation.error, exploreQuery.error)

  if (loading) return null
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  const exploreData = exploreQuery.data
  // Declined first, so the counter keeps its place when a refresh drops or adds occasions
  const declinedOccasions = exploreData?.occasions.filter((occasion) => declinedIds.has(occasion.id)) ?? []
  const occasions = exploreData && [
    ...declinedOccasions,
    ...exploreData.occasions.filter((occasion) => !declinedIds.has(occasion.id)),
  ]
  const occasionIndex = declinedOccasions.length
  const activeOccasion = exploreData?.active_occasion
  const occasion = activeOccasion ? undefined : occasions?.[occasionIndex]

  function decline() {
    if (!occasion) return
    joinMutation.reset()
    setStatusMessage(`Skipped ${occasion.name}`)
    setDeclinedIds((ids) => new Set(ids).add(occasion.id))
  }

  function accept() {
    if (occasion) joinMutation.mutate(occasion)
  }

  return (
    <section className="explore">
      <title>Explore · Splitit</title>
      <div className="explore-head">
        <h1>Explore</h1>
        {occasions && occasion && (
          <p className="muted">
            {occasionIndex + 1} of {occasions.length}
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
        {statusMessage}
      </p>

      {!exploreData && !errors.non_field_errors && <p className="muted">Loading…</p>}

      {activeOccasion && <ActiveOccasion occasion={activeOccasion} />}

      {occasions && !activeOccasion && !occasion && (
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
            <button className="btn" type="button" onClick={decline} disabled={joinMutation.isPending}>
              Decline
            </button>
            <button className="btn btn-confirm" type="button" onClick={accept} disabled={joinMutation.isPending}>
              {joinMutation.isPending ? 'Joining…' : 'Accept'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
