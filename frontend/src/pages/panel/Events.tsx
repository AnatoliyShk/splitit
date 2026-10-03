import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { apiDelete, apiGet, apiPost, errorsFrom, type FieldErrors, type Page } from '../../api'
import { Field, FormAlert } from '../../components/Field'
import { Pager } from '../../components/Pager'
import { formatDuration, formatRange, PAGE_SIZE, useDebounced, type PanelEvent } from './shared'

// Not over yet: same rule as the server (an event with no end is over once it starts)
function isUpcoming(e: PanelEvent) {
  return new Date(e.end_datetime ?? e.start_datetime).getTime() > Date.now()
}

export default function Events() {
  const [search, setSearch] = useState('')
  const query = useDebounced(search.trim())
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page<PanelEvent> | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  // Deleting and finishing are two-step: the row asks for confirmation inline
  const [confirm, setConfirm] = useState<{ id: number; action: 'delete' | 'finish' } | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [creatingTest, setCreatingTest] = useState(false)
  const [testEvent, setTestEvent] = useState<PanelEvent | null>(null)

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), search: query })
    return apiGet<Page<PanelEvent>>(`/api/panel/events/?${params}`)
      .then(setData)
      .catch((err) => setErrors(errorsFrom(err)))
  }, [page, query])

  useEffect(() => {
    load()
  }, [load])

  async function remove(event: PanelEvent) {
    setBusyId(event.id)
    setErrors({})
    try {
      await apiDelete(`/api/panel/events/${event.id}/`)
      setConfirm(null)
      // Step back a page if this deleted the last row on it
      if (data?.results.length === 1 && page > 1) setPage(page - 1)
      else load()
    } catch (err) {
      setErrors(errorsFrom(err))
    } finally {
      setBusyId(null)
    }
  }

  // Ends the event now; the worker then counts connections between its attendees
  async function finish(event: PanelEvent) {
    setBusyId(event.id)
    setErrors({})
    try {
      await apiPost(`/api/panel/events/${event.id}/finish/`)
      await load()
      setConfirm(null)
    } catch (err) {
      setErrors(errorsFrom(err))
    } finally {
      setBusyId(null)
    }
  }

  // Random time and 1-3 random attendees; the server creates test users if there are none
  async function createTest() {
    setCreatingTest(true)
    setErrors({})
    setTestEvent(null)
    try {
      const event = await apiPost<PanelEvent>('/api/panel/events/test/')
      // Refresh first, so the message never points at a row the table doesn't show yet
      await load()
      setTestEvent(event)
    } catch (err) {
      setErrors(errorsFrom(err))
    } finally {
      setCreatingTest(false)
    }
  }

  return (
    <>
      <div className="panel-head">
        <h1>Events</h1>
        <div className="panel-head-actions">
          <button className="btn" type="button" onClick={createTest} disabled={creatingTest}>
            {creatingTest ? 'Creating…' : 'Create test event'}
          </button>
          <Link className="btn btn-primary" to="/admin/events/new">
            New event
          </Link>
        </div>
      </div>

      {testEvent && (
        <p className="form-status" role="status">
          <span>
            Created{' '}
            <Link className="row-link" to={`/admin/events/${testEvent.id}`}>
              {testEvent.name}
            </Link>{' '}
            on {formatRange(testEvent.start_datetime, testEvent.end_datetime)} with{' '}
            {testEvent.attendees.map((a) => a.name).join(', ')}
          </span>
        </p>
      )}

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
                  {confirm?.id === e.id ? (
                    <span
                      className="confirm"
                      role="group"
                      aria-label={`${confirm.action === 'delete' ? 'Delete' : 'Finish'} ${e.name}?`}
                    >
                      <span className="confirm-text">{confirm.action === 'delete' ? 'Delete?' : 'Finish now?'}</span>
                      <button className="btn btn-sm" onClick={() => setConfirm(null)} autoFocus>
                        Keep
                      </button>
                      {confirm.action === 'delete' ? (
                        <button className="btn btn-sm btn-danger" disabled={busyId === e.id} onClick={() => remove(e)}>
                          Delete
                        </button>
                      ) : (
                        <button className="btn btn-sm btn-confirm" disabled={busyId === e.id} onClick={() => finish(e)}>
                          Finish
                        </button>
                      )}
                    </span>
                  ) : (
                    <>
                      {isUpcoming(e) && (
                        <button className="btn btn-sm" onClick={() => setConfirm({ id: e.id, action: 'finish' })}>
                          Finish
                        </button>
                      )}
                      <Link className="btn btn-sm" to={`/admin/events/${e.id}`}>
                        Edit
                      </Link>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => setConfirm({ id: e.id, action: 'delete' })}
                      >
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
