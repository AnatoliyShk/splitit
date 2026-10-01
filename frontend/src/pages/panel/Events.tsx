import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { apiDelete, apiGet, errorsFrom, type FieldErrors, type Page } from '../../api'
import { Field, FormAlert } from '../../components/Field'
import { Pager } from '../../components/Pager'
import { formatDuration, formatRange, PAGE_SIZE, useDebounced, type PanelEvent } from './shared'

export default function Events() {
  const [search, setSearch] = useState('')
  const query = useDebounced(search.trim())
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page<PanelEvent> | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  // Deleting is two-step: the row asks for confirmation inline
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), search: query })
    apiGet<Page<PanelEvent>>(`/api/panel/events/?${params}`)
      .then(setData)
      .catch((err) => setErrors(errorsFrom(err)))
  }, [page, query])

  useEffect(load, [load])

  async function remove(event: PanelEvent) {
    setDeletingId(event.id)
    setErrors({})
    try {
      await apiDelete(`/api/panel/events/${event.id}/`)
      setConfirmId(null)
      // Step back a page if this deleted the last row on it
      if (data?.results.length === 1 && page > 1) setPage(page - 1)
      else load()
    } catch (err) {
      setErrors(errorsFrom(err))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <div className="panel-head">
        <h1>Events</h1>
        <Link className="btn btn-primary" to="/admin/events/new">
          New event
        </Link>
      </div>

      <div className="panel-toolbar">
        <Field
          id="event-search"
          label="Search by name"
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
      </div>

      <FormAlert messages={errors.non_field_errors} />

      {data && data.results.length === 0 && (
        <div className="empty">
          <p>{query ? `No events match “${query}”.` : 'No events yet.'}</p>
          {!query && (
            <Link className="btn btn-primary btn-sm" to="/admin/events/new">
              Create the first event
            </Link>
          )}
        </div>
      )}

      {data && data.results.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">When</th>
              <th scope="col">Length</th>
              <th scope="col">Going</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.results.map((e) => (
              <tr key={e.id}>
                <td data-label="Event">
                  <Link className="row-link" to={`/admin/events/${e.id}`}>
                    {e.name}
                  </Link>
                </td>
                <td data-label="When">{formatRange(e.start_datetime, e.end_datetime)}</td>
                <td data-label="Length">
                  {e.duration_minutes === null ? 'Open' : formatDuration(e.duration_minutes)}
                </td>
                <td data-label="Going">{e.attendees.length}</td>
                <td className="row-actions">
                  {confirmId === e.id ? (
                    <span className="confirm" role="group" aria-label={`Delete ${e.name}?`}>
                      <span className="confirm-text">Delete?</span>
                      <button className="btn btn-sm" onClick={() => setConfirmId(null)} autoFocus>
                        Keep
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={deletingId === e.id}
                        onClick={() => remove(e)}
                      >
                        Delete
                      </button>
                    </span>
                  ) : (
                    <>
                      <Link className="btn btn-sm" to={`/admin/events/${e.id}`}>
                        Edit
                      </Link>
                      <button className="btn btn-sm btn-danger" onClick={() => setConfirmId(e.id)}>
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data && <Pager page={page} count={data.count} pageSize={PAGE_SIZE} onChange={setPage} />}
    </>
  )
}
