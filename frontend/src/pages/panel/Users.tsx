import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPatch, errorsFrom, type FieldErrors, type Page } from '../../api'
import { useAuth } from '../../auth'
import { Field, FormAlert } from '../../components/Field'
import { Pager } from '../../components/Pager'
import { formatDate, PAGE_SIZE, useDebounced, type PanelUser } from './shared'

export default function Users() {
  const { user: me } = useAuth()
  const [search, setSearch] = useState('')
  const query = useDebounced(search.trim())
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page<PanelUser> | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), search: query })
    apiGet<Page<PanelUser>>(`/api/panel/users/?${params}`)
      .then(setData)
      .catch((err) => setErrors(errorsFrom(err)))
  }, [page, query])

  useEffect(load, [load])

  async function update(target: PanelUser, changes: Partial<Pick<PanelUser, 'is_active' | 'is_staff'>>) {
    setBusyId(target.id)
    setErrors({})
    try {
      const updated = await apiPatch<PanelUser>(`/api/panel/users/${target.id}/`, changes)
      setData((d) => d && { ...d, results: d.results.map((u) => (u.id === updated.id ? updated : u)) })
    } catch (err) {
      setErrors(errorsFrom(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <div className="panel-head">
        <h1>Users</h1>
        {data && <span className="muted">{data.count} total</span>}
      </div>

      <div className="panel-toolbar">
        <Field
          id="user-search"
          label="Search by name or email"
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
          <p>No users match “{query}”.</p>
        </div>
      )}

      {data && data.results.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col">Joined</th>
              <th scope="col">Events</th>
              <th scope="col">Access</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.results.map((u) => {
              const isMe = u.id === me?.id
              // Mirrors the backend: no changing your own access, only superusers manage superusers
              const locked = isMe || (u.is_superuser && !me?.is_superuser)
              const busy = busyId === u.id
              return (
                <tr key={u.id}>
                  <td className="cell-stack" data-label="User">
                    <strong>{u.name || '—'}</strong>
                    <small>{u.email}</small>
                  </td>
                  <td data-label="Joined">{formatDate(u.date_joined)}</td>
                  <td data-label="Events">{u.events_count}</td>
                  <td data-label="Access">
                    <span className="tags">
                      {isMe && <span className="tag">You</span>}
                      {u.is_superuser ? (
                        <span className="tag">Superuser</span>
                      ) : (
                        u.is_staff && <span className="tag">Admin</span>
                      )}
                      {!u.is_active && <span className="tag tag-off">Deactivated</span>}
                      {u.is_active && !u.is_staff && !isMe && <span className="tag tag-off">Member</span>}
                    </span>
                  </td>
                  <td className="row-actions">
                    {!locked && (
                      <>
                        <button
                          className="btn btn-sm"
                          disabled={busy}
                          onClick={() => update(u, { is_staff: !u.is_staff })}
                        >
                          {u.is_staff ? 'Remove admin' : 'Make admin'}
                        </button>
                        <button
                          className="btn btn-sm"
                          disabled={busy}
                          onClick={() => update(u, { is_active: !u.is_active })}
                        >
                          {u.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {data && <Pager page={page} count={data.count} pageSize={PAGE_SIZE} onChange={setPage} />}
    </>
  )
}
