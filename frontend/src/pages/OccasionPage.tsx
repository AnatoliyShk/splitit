import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { ApiError, apiGet, apiPost, useFieldErrors, type FieldErrors } from '../api'
import { useAuth } from '../auth'
import { FormAlert } from '../components/Field'
import { TagList } from '../components/TagList'
import { queryKeys } from '../queryClient'
import type { OccasionDetail } from '../types/api/occasions'
import { formatDateTime, formatRange } from './panel/shared'

const NOT_FOUND: FieldErrors = { non_field_errors: ["This occasion doesn't exist or was deleted."] }

export default function OccasionPage() {
  const { id: occasionId = '' } = useParams()
  const { user, loading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [mountedAt] = useState(() => Date.now())
  const queryClient = useQueryClient()
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const occasionQuery = useQuery({
    queryKey: queryKeys.occasion(occasionId),
    queryFn: () => apiGet<OccasionDetail>(`/api/occasions/${occasionId}/`),
    enabled: Boolean(user),
  })
  const cancelMutation = useMutation({
    mutationFn: () => apiPost<OccasionDetail>(`/api/occasions/${occasionId}/cancel/`),
    onSuccess: (cancelledOccasion) => {
      setConfirmingCancel(false)
      queryClient.setQueryData(queryKeys.occasion(occasionId), cancelledOccasion)
      // Cancelling frees the creator (and everyone else going) to pick another occasion
      queryClient.invalidateQueries({ queryKey: queryKeys.explore })
      if (user) queryClient.invalidateQueries({ queryKey: queryKeys.userOccasions(user.uuid) })
    },
  })
  const occasion = occasionQuery.data
  const fieldErrors = useFieldErrors(occasionQuery.error, cancelMutation.error)
  const errors: FieldErrors =
    occasionQuery.error instanceof ApiError && occasionQuery.error.status === 404
      ? NOT_FOUND
      : fieldErrors

  // Not cancelled and not over yet (an occasion with no end is over once it starts)
  const isOngoing = (shown: OccasionDetail) =>
    !shown.cancelled_at && new Date(shown.end_datetime ?? shown.start_datetime).getTime() > mountedAt

  if (loading) return null
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  // Opened from inside the app: go back to where the card was. Opened directly: fall back to Explore
  const canGoBack = location.key !== 'default'

  return (
    <section className="occasion-page">
      <title>{`${occasion?.name ?? 'Occasion'} · Splitit`}</title>
      {canGoBack ? (
        <button className="btn back-button" type="button" onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 12H5m6-6-6 6 6 6" />
          </svg>
          Back
        </button>
      ) : (
        <Link className="btn back-button" to="/explore">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 12H5m6-6-6 6 6 6" />
          </svg>
          Explore
        </Link>
      )}

      <FormAlert messages={errors.non_field_errors} />
      {!occasion && !errors.non_field_errors && <p className="muted">Loading…</p>}

      {occasion && (
        <>
          <article className="occasion-detail" aria-labelledby="occasion-title">
            {occasion.main_image && <img className="occasion-hero" src={occasion.main_image} alt="" />}
            <h1 id="occasion-title">{occasion.name}</h1>
            <p className="explore-when">{formatRange(occasion.start_datetime, occasion.end_datetime)}</p>
            {occasion.description && <p className="occasion-description">{occasion.description}</p>}
            <TagList
              tagNames={occasion.tags}
              statusTags={[
                ...(occasion.cancelled_at ? [{ label: 'Cancelled', off: true }] : []),
                ...(occasion.is_going ? [{ label: "You're going" }] : []),
              ]}
            />
            <p className="explore-going">
              {occasion.attendees_count === 0
                ? 'Nobody is going yet'
                : `${occasion.attendees_count} ${occasion.attendees_count === 1 ? 'person is' : 'people are'} going`}
            </p>
          </article>

          {occasion.is_going && isOngoing(occasion) && (
            <aside className="occasion-notice" aria-labelledby="going-notice-title">
              <h2 id="going-notice-title">You're going to this occasion</h2>
              <p>
                Your spot is saved. Be there on {formatDateTime(occasion.start_datetime)}
                {/* Same rule as the server: an occasion with no end is over once it starts */}
                {' '}and you can pick your next occasion once it ends ({formatDateTime(occasion.end_datetime ?? occasion.start_datetime)}).
                Until then, Explore is paused: you can only go to one occasion at a time. If it's cancelled, Explore opens again right away.
              </p>
              <Link className="btn" to="/profile">
                Your occasions
              </Link>
            </aside>
          )}

          {occasion.is_mine && isOngoing(occasion) && (
            <section className="occasion-cancel" aria-labelledby="cancel-title">
              <h2 id="cancel-title">Can't make it happen?</h2>
              <p className="muted">
                Cancelling calls the occasion off for everyone going and lets them pick another one.
              </p>
              {confirmingCancel ? (
                <div className="occasion-cancel-actions">
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={cancelMutation.isPending}
                    onClick={() => cancelMutation.mutate()}
                  >
                    {cancelMutation.isPending ? 'Cancelling…' : 'Yes, cancel it'}
                  </button>
                  <button className="btn" type="button" onClick={() => setConfirmingCancel(false)}>
                    Keep it
                  </button>
                </div>
              ) : (
                <button className="btn btn-danger" type="button" onClick={() => setConfirmingCancel(true)}>
                  Cancel occasion
                </button>
              )}
            </section>
          )}

          {occasion.gallery.length > 0 && (
            <section className="occasion-gallery" aria-labelledby="gallery-title">
              <h2 id="gallery-title">Gallery</h2>
              <ul>
                {occasion.gallery.map((imageUrl, imageIndex) => (
                  <li key={imageUrl}>
                    {/* Full size in a new tab */}
                    <a href={imageUrl} target="_blank" rel="noreferrer">
                      <img
                        src={imageUrl}
                        alt={`${occasion.name}, photo ${imageIndex + 1} of ${occasion.gallery.length}`}
                        loading="lazy"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  )
}
