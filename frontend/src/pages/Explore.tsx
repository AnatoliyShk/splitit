import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { ApiError, apiGet, apiPost, useFieldErrors } from '../api'
import { useAuth } from '../auth'
import { ExploreFilters } from '../components/ExploreFilters'
import { FormAlert } from '../components/Field'
import { InfoTip } from '../components/InfoTip'
import { OccasionCard } from '../components/OccasionCard'
import { Spinner } from '../components/Spinner'
import { filtersApplied, useFilterPreference } from '../filterPreference'
import { queryKeys } from '../queryClient'
import type { ExploreData, ExploreOccasion } from '../types/api/occasions'
import { formatDateTime } from './panel/shared'

function ActiveOccasion({ occasion }: { occasion: ExploreOccasion }) {
  // Same rule as the server: an occasion with no end is over once it starts
  const endsAt = formatDateTime(occasion.end_datetime ?? occasion.start_datetime)
  return (
    <div className="explore-active">
      {/* Why the deck is paused, above the card, so it's read first */}
      <p className="muted">
        You can join your next occasion once this one ends ({endsAt}) or if it's cancelled. Until then, Explore is
        paused.
      </p>
      <Link className="btn btn-primary" to="/profile">
        Your occasions
      </Link>
      <p className="explore-eyebrow">You're going to</p>
      <OccasionCard occasion={occasion} mine />
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

  const filterPreferenceQuery = useFilterPreference(user)
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
  const occasions = exploreData?.occasions.filter((occasion) => !declinedIds.has(occasion.id))
  const activeOccasion = exploreData?.active_occasion
  const filtered = filtersApplied(filterPreferenceQuery.data)
  const occasion = activeOccasion ? undefined : occasions?.[0]

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
        <InfoTip label="About one occasion at a time">
          <strong>One occasion at a time.</strong> Accepting an occasion saves your spot and pauses Explore. Once it
          ends or is cancelled, you can pick your next one.
        </InfoTip>
        {/* Filters only apply to the deck, which is paused while an occasion is active */}
        {exploreData && !activeOccasion && <ExploreFilters user={user} />}
      </div>

      <FormAlert messages={errors.non_field_errors} />
      <p className="visually-hidden" role="status">
        {statusMessage}
      </p>

      {/* Holds the deck's place until the occasions arrive, so the page doesn't jump when they do */}
      {!exploreData && !errors.non_field_errors && (
        <div className="explore-loading">
          <Spinner label="Loading occasions" />
        </div>
      )}

      {activeOccasion && <ActiveOccasion occasion={activeOccasion} />}

      {exploreData && !activeOccasion && !occasion && (
        <div className="explore-card explore-done">
          {exploreData.occasions.length === 0 && filtered ? (
            <>
              <h2>No occasions match your filters</h2>
              <p className="muted">Change or clear your filters above to see more.</p>
            </>
          ) : (
            <>
              <h2>{exploreData.occasions.length === 0 ? 'No new occasions right now' : "You're all caught up"}</h2>
              <p className="muted">Check back later for more occasions, or see the ones you're going to.</p>
            </>
          )}
          <div className="explore-done-actions">
            <Link className="btn btn-primary" to="/profile">
              Your occasions
            </Link>
            <Link className="btn" to="/occasions/new">
              Create occasion
            </Link>
          </div>
        </div>
      )}

      {/* Above the card they answer, so they stay put whether its details are open or not */}
      {occasion && (
        <div className="explore-actions" role="group" aria-label={`Respond to ${occasion.name}`}>
          <button className="btn btn-danger" type="button" onClick={decline} disabled={joinMutation.isPending}>
            Decline
          </button>
          <button className="btn btn-confirm" type="button" onClick={accept} disabled={joinMutation.isPending}>
            {joinMutation.isPending ? 'Joining…' : 'Accept'}
          </button>
        </div>
      )}

      {/* Keyed by occasion id so the entrance animation replays for each card */}
      {occasion && <OccasionCard key={occasion.id} occasion={occasion} />}
    </section>
  )
}
