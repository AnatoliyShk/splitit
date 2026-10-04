import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { ApiError, apiGet, errorsFrom, type FieldErrors } from '../api'
import { useAuth } from '../auth'
import { FormAlert } from '../components/Field'
import { formatRange } from './panel/shared'

type OccasionDetail = {
  id: number
  name: string
  start_datetime: string
  end_datetime: string | null
  cancelled_at: string | null
  attendees_count: number
  tags: string[]
  main_image: string | null
  // Up to 3 image URLs, in order, without the main image
  gallery: string[]
  is_going: boolean
}

export default function OccasionPage() {
  const { id } = useParams()
  const { user, loading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [occasion, setOccasion] = useState<OccasionDetail | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})

  useEffect(() => {
    if (!user) return
    apiGet<OccasionDetail>(`/api/occasions/${id}/`)
      .then(setOccasion)
      .catch((err) =>
        setErrors(
          err instanceof ApiError && err.status === 404
            ? { non_field_errors: ["This occasion doesn't exist or was deleted."] }
            : errorsFrom(err),
        ),
      )
  }, [user, id])

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
            {(occasion.cancelled_at || occasion.is_going || occasion.tags.length > 0) && (
              <span className="tags">
                {occasion.cancelled_at && <span className="tag tag-off">Cancelled</span>}
                {occasion.is_going && <span className="tag">You're going</span>}
                {occasion.tags.map((t) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))}
              </span>
            )}
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
                {occasion.gallery.map((url, i) => (
                  <li key={url}>
                    {/* Full size in a new tab */}
                    <a href={url} target="_blank" rel="noreferrer">
                      <img
                        src={url}
                        alt={`${occasion.name}, photo ${i + 1} of ${occasion.gallery.length}`}
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
