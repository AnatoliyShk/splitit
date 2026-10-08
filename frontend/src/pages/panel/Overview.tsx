import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { apiGet, useFieldErrors } from '../../api'
import { FormAlert } from '../../components/Field'
import { queryKeys } from '../../queryClient'
import type { Stats } from '../../types/api/admin'
import { formatRange, plural } from './shared'

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' })

export default function Overview() {
  const statsQuery = useQuery({ queryKey: queryKeys.panel.stats, queryFn: () => apiGet<Stats>('/api/admin/stats/') })
  const stats = statsQuery.data
  const errors = useFieldErrors(statsQuery.error)

  const statTiles = stats && [
    { label: 'Users', value: stats.users.total, note: `${stats.users.active} active` },
    { label: 'Admins', value: stats.users.staff, note: 'with panel access' },
    { label: 'New this week', value: stats.users.new_this_week, note: 'sign-ups, last 7 days' },
    { label: 'Occasions', value: stats.occasions.total, note: `${stats.occasions.upcoming} upcoming` },
  ]

  return (
    <>
      <div className="panel-head">
        <h1>Overview</h1>
      </div>
      <FormAlert messages={errors.non_field_errors} />

      {!stats && !errors.non_field_errors && <p className="muted">Loading…</p>}

      {statTiles && (
        <ul className="stats" aria-label="Totals">
          {statTiles.map((tile) => (
            <li className="stat" key={tile.label}>
              <span className="stat-label">{tile.label}</span>
              <strong className="stat-value">{tile.value}</strong>
              <span className="stat-note">{tile.note}</span>
            </li>
          ))}
        </ul>
      )}

      {stats && (
        <section className="panel-section" aria-labelledby="next-occasions">
          <div className="panel-head">
            <h2 id="next-occasions">Next occasions</h2>
            <Link className="btn btn-sm" to="/admin/occasions">
              All occasions
            </Link>
          </div>
          {stats.next_occasions.length ? (
            <ul className="occasion-list">
              {stats.next_occasions.map((occasion) => (
                <li key={occasion.id}>
                  <Link className="occasion-row" to={`/admin/occasions/${occasion.id}`}>
                    <span className="occasion-day occasion-date">
                      {new Date(occasion.start_datetime).getDate()}
                      <small>{monthFormat.format(new Date(occasion.start_datetime))}</small>
                    </span>
                    <span className="occasion-info">
                      <strong>{occasion.name}</strong>
                      <small>{formatRange(occasion.start_datetime, occasion.end_datetime)}</small>
                    </span>
                    <span className="occasion-going">{occasion.attendees_count} going</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">
              <p>No upcoming occasions.</p>
              <Link className="btn btn-primary btn-sm" to="/admin/occasions/new">
                Create an occasion
              </Link>
            </div>
          )}
          <p className="muted">{plural(stats.occasions.upcoming, 'upcoming occasion')} in total.</p>
        </section>
      )}
    </>
  )
}
