import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { ApiError, apiGet, useFieldErrors, type FieldErrors } from '../api'
import { useAuth } from '../auth'
import { FormAlert } from '../components/Field'
import { TagList } from '../components/TagList'
import { queryKeys } from '../queryClient'
import type { OccasionDetail } from '../types/occasions'
import { formatRange } from './panel/shared'

const NOT_FOUND: FieldErrors = { non_field_errors: ["This occasion doesn't exist or was deleted."] }

export default function OccasionPage() {
  const { id: occasionId = '' } = useParams()
  const { user, loading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const occasionQuery = useQuery({
    queryKey: queryKeys.occasion(occasionId),
    queryFn: () => apiGet<OccasionDetail>(`/api/occasions/${occasionId}/`),
    enabled: Boolean(user),
  })
  const occasion = occasionQuery.data
  const fieldErrors = useFieldErrors(occasionQuery.error)
  const errors: FieldErrors =
    occasionQuery.error instanceof ApiError && occasionQuery.error.status === 404
      ? NOT_FOUND
      : fieldErrors

  if (loading) return null
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  // Opened from inside the app: go back to where the card was. Opened directly: fall back to Explore
  const canGoBack = location.key !== 'default'

  return (
    <section className="occasion-page">
      <title>{`${occasion?.name ?? 'Occasion'} · Splitit`}</title>
      {canGoBack ? (
        <button className="back-link" type="button" onClick={() => navigate(-1)}>
          ← Back
        </button>
      ) : (
        <Link className="back-link" to="/explore">
          ← Explore
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
