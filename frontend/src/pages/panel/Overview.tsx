import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { apiGet, errorsFrom, type FieldErrors } from '../../api'
import { FormAlert } from '../../components/Field'
import { formatRange, plural, type Stats } from './shared'

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' })

export default function Overview() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})

  useEffect(() => {
    apiGet<Stats>('/api/panel/stats/')
      .then(setStats)
      .catch((err) => setErrors(errorsFrom(err)))
  }, [])

  const tiles = stats && [
    { label: 'Users', value: stats.users.total, note: `${stats.users.active} active`, tone: 'primary' },
    { label: 'Admins', value: stats.users.staff, note: 'with panel access', tone: 'secondary' },
    { label: 'New this week', value: stats.users.new_this_week, note: 'sign-ups, last 7 days', tone: 'primary' },
    { label: 'Events', value: stats.events.total, note: `${stats.events.upcoming} upcoming`, tone: 'secondary' },
  ]

  return (
    <>
      <div className="panel-head">
        <h1>Overview</h1>
      </div>
      <FormAlert messages={errors.non_field_errors} />

      {!stats && !errors.non_field_errors && <p className="muted">Loading…</p>}

      {tiles && (
        <ul className="stats" aria-label="Totals">
          {tiles.map((t) => (
            <li className={`stat stat-${t.tone}`} key={t.label}>
              <span className="stat-label">{t.label}</span>
              <strong className="stat-value">{t.value}</strong>
              <span className="stat-note">{t.note}</span>
            </li>
          ))}
        </ul>
      )}

      {stats && (
        <section className="panel-section" aria-labelledby="next-events">
          <div className="panel-head">
            <h2 id="next-events">Next events</h2>
            <Link className="btn btn-sm" to="/admin/events">
              All events
            </Link>
          </div>
          {stats.next_events.length ? (
            <ul className="event-list">
              {stats.next_events.map((e) => (
                <li key={e.id}>
                  <Link className="event-row" to={`/admin/events/${e.id}`}>
                    <span className="event-day event-date">
                      {new Date(e.start_datetime).getDate()}
                      <small>{monthFormat.format(new Date(e.start_datetime))}</small>
                    </span>
                    <span className="event-info">
                      <strong>{e.name}</strong>
                      <small>{formatRange(e.start_datetime, e.end_datetime)}</small>
                    </span>
                    <span className="event-going">{e.attendees_count} going</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">
              <p>No upcoming events.</p>
              <Link className="btn btn-primary btn-sm" to="/admin/events/new">
                Create an event
              </Link>
            </div>
          )}
          <p className="muted">{plural(stats.events.upcoming, 'upcoming event')} in total.</p>
        </section>
      )}
    </>
  )
}
