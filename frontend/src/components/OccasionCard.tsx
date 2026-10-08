import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { formatTimes } from '../pages/panel/shared'
import type { ExploreOccasion, KnownAttendee } from '../types/api/occasions'
import { RollOut } from './RollOut'
import { TagList } from './TagList'

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

// Characters of the description a closed card shows
const DESCRIPTION_PREVIEW_LENGTH = 100

// The first DESCRIPTION_PREVIEW_LENGTH characters (whole code points, so an emoji isn't split) and an ellipsis,
// or null when the description fits as it is
function descriptionPreview(description: string) {
  const characters = Array.from(description)
  if (characters.length <= DESCRIPTION_PREVIEW_LENGTH) return null
  return `${characters.slice(0, DESCRIPTION_PREVIEW_LENGTH).join('').trimEnd()}…`
}

type LongDescriptionProps = { preview: string; description: string; open: boolean }

/**
 * A description longer than the preview. Both texts are rendered from the start, stacked; the box's height
 * slides between their measured heights as the details open, in step with the RollOut below it, so the
 * card grows smoothly instead of swapping text and jumping.
 */
function LongDescription({ preview, description, open }: LongDescriptionProps) {
  const previewRef = useRef<HTMLParagraphElement>(null)
  const fullRef = useRef<HTMLParagraphElement>(null)
  const [heights, setHeights] = useState<{ preview: number; full: number } | null>(null)

  useLayoutEffect(() => {
    const previewElement = previewRef.current
    const fullElement = fullRef.current
    if (!previewElement || !fullElement) return
    // Fires once right away (before paint), then whenever the card's width rewraps the text
    const resizeObserver = new ResizeObserver(() =>
      setHeights({ preview: previewElement.offsetHeight, full: fullElement.offsetHeight }),
    )
    resizeObserver.observe(previewElement)
    resizeObserver.observe(fullElement)
    return () => resizeObserver.disconnect()
  }, [])

  return (
    <div
      className="explore-description-box"
      style={heights ? { height: open ? heights.full : heights.preview } : undefined}
    >
      <p ref={previewRef} className="explore-description" data-shown={!open} aria-hidden={open}>
        {preview}
      </p>
      <p ref={fullRef} className="explore-description" data-shown={open} aria-hidden={!open}>
        {description}
      </p>
    </div>
  )
}

// An Explore card. Tags and who's going stay folded away until the user clicks the card's bottom strip.
// `mine` words the attendee count for an occasion the user is going to
export function OccasionCard({ occasion, mine = false }: { occasion: ExploreOccasion; mine?: boolean }) {
  const startDate = new Date(occasion.start_datetime)
  const knownAttendeesText = knownText(occasion.known_attendees, occasion.attendees_count - (mine ? 1 : 0))
  const [detailsOpen, setDetailsOpen] = useState(false)
  const preview = descriptionPreview(occasion.description)
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
          {/* Only regular users' occasions name their creator; staff ones don't */}
          {occasion.created_by && <p className="explore-creator">Created by {occasion.created_by.name}</p>}
        </div>
      </div>
      {/* A short description shows whole; a long one shows its first 100 characters until the details open */}
      {occasion.description &&
        (preview ? (
          <LongDescription preview={preview} description={occasion.description} open={detailsOpen} />
        ) : (
          <p className="explore-description">{occasion.description}</p>
        ))}
      {/* The card's bottom strip: clicking anywhere on it rolls the details open above it */}
      <RollOut
        togglePosition="after"
        toggle={(open) => (open ? 'Hide details' : 'Show details')}
        toggleClassName="explore-details-toggle"
        className="explore-details"
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      >
        <TagList tagNames={occasion.tags} />
        <div className="explore-going">
          <p>{goingText(occasion.attendees_count, mine)}</p>
          {knownAttendeesText && <p className="muted">{knownAttendeesText}</p>}
        </div>
      </RollOut>
    </article>
  )
}
