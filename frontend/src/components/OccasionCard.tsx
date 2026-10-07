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

// An Explore card. Tags and who's going stay folded away until the user clicks the card's bottom strip.
// `mine` words the attendee count for an occasion the user is going to
export function OccasionCard({ occasion, mine = false }: { occasion: ExploreOccasion; mine?: boolean }) {
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
      {/* The card's bottom strip: clicking anywhere on it rolls the details open above it */}
      <RollOut
        togglePosition="after"
        toggle={(open) => (open ? 'Hide details' : 'Show details')}
        toggleClassName="explore-details-toggle"
        className="explore-details"
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
