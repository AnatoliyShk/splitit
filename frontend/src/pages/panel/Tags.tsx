import { useCallback, useEffect, useState, type SubmitEvent } from 'react'
import { apiDelete, apiGet, apiPatch, apiPost, errorsFrom, type FieldErrors, type Page } from '../../api'
import { Field, FormAlert } from '../../components/Field'
import { Pager } from '../../components/Pager'
import { formatDate, PAGE_SIZE, plural, useDebounced, type PanelTag } from './shared'

export default function Tags() {
  const [search, setSearch] = useState('')
  const query = useDebounced(search.trim())
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page<PanelTag> | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})

  const [newName, setNewName] = useState('')
  const [createErrors, setCreateErrors] = useState<FieldErrors>({})
  const [creating, setCreating] = useState(false)

  // One row at a time can be renamed or asked to confirm a delete
  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editErrors, setEditErrors] = useState<FieldErrors>({})
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), search: query })
    apiGet<Page<PanelTag>>(`/api/panel/tags/?${params}`)
      .then(setData)
      .catch((err) => setErrors(errorsFrom(err)))
  }, [page, query])

  useEffect(load, [load])

  async function create(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setCreating(true)
    setCreateErrors({})
    try {
      await apiPost('/api/panel/tags/', { name: newName })
      setNewName('')
      load()
    } catch (err) {
      setCreateErrors(errorsFrom(err))
    } finally {
      setCreating(false)
    }
  }

  function startEdit(tag: PanelTag) {
    setConfirmId(null)
    setEditId(tag.id)
    setEditName(tag.name)
    setEditErrors({})
  }

  async function rename(e: SubmitEvent<HTMLFormElement>, tag: PanelTag) {
    e.preventDefault()
    setBusyId(tag.id)
    setEditErrors({})
    try {
      const updated = await apiPatch<PanelTag>(`/api/panel/tags/${tag.id}/`, { name: editName })
      setData((d) => d && { ...d, results: d.results.map((t) => (t.id === updated.id ? updated : t)) })
      setEditId(null)
    } catch (err) {
      setEditErrors(errorsFrom(err))
    } finally {
      setBusyId(null)
    }
  }

  async function remove(tag: PanelTag) {
    setBusyId(tag.id)
    setErrors({})
    try {
      await apiDelete(`/api/panel/tags/${tag.id}/`)
      setConfirmId(null)
      // Step back a page if this deleted the last row on it
      if (data?.results.length === 1 && page > 1) setPage(page - 1)
      else load()
    } catch (err) {
      setErrors(errorsFrom(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <div className="panel-head">
        <h1>Tags</h1>
        {data && <span className="muted">{data.count} total</span>}
      </div>

      <div className="panel-toolbar-row">
        <form className="inline-form" onSubmit={create} noValidate>
          <Field
            id="new-tag"
            label="New tag"
            placeholder="e.g. Jazz"
            maxLength={50}
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value)
              setCreateErrors({})
            }}
            errors={createErrors.name ?? createErrors.non_field_errors}
          />
          <button className="btn btn-primary" type="submit" disabled={creating || !newName.trim()}>
            Add tag
          </button>
        </form>
        <div className="panel-toolbar">
          <Field
            id="tag-search"
            label="Search tags"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
      </div>

      <FormAlert messages={errors.non_field_errors} />

      {data && data.results.length === 0 && (
        <div className="empty">
          <p>{query ? `No tags match “${query}”.` : 'No tags yet. Add the first one above.'}</p>
        </div>
      )}

      {data && data.results.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Tag</th>
              <th scope="col">Events</th>
              <th scope="col">Embedding</th>
              <th scope="col">Created</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.results.map((t) =>
              editId === t.id ? (
                <tr key={t.id}>
                  <td colSpan={5}>
                    <form className="inline-form" onSubmit={(e) => rename(e, t)} noValidate>
                      <Field
                        id={`rename-${t.id}`}
                        label={`Rename “${t.name}”`}
                        maxLength={50}
                        autoFocus
                        value={editName}
                        onChange={(e) => {
                          setEditName(e.target.value)
                          setEditErrors({})
                        }}
                        onKeyDown={(e) => e.key === 'Escape' && setEditId(null)}
                        errors={editErrors.name ?? editErrors.non_field_errors}
                      />
                      <span className="inline-form-actions">
                        <button className="btn btn-sm" type="button" onClick={() => setEditId(null)}>
                          Cancel
                        </button>
                        <button
                          className="btn btn-sm btn-confirm"
                          type="submit"
                          disabled={busyId === t.id || !editName.trim()}
                        >
                          Save
                        </button>
                      </span>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={t.id}>
                  <td data-label="Tag">
                    <span className="tag-name">{t.name}</span>
                  </td>
                  <td data-label="Events">{t.events_count}</td>
                  <td data-label="Embedding">
                    {/* Neutral status in ink: a check mark when the vector exists, a dash while it's missing */}
                    {t.has_embedding ? (
                      <svg className="check-mark" viewBox="0 0 24 24" role="img" aria-label="Ready">
                        <title>Ready</title>
                        <path d="M4 12.5l5 5L20 6.5" />
                      </svg>
                    ) : (
                      <span className="muted" role="img" aria-label="Missing" title="Missing">
                        –
                      </span>
                    )}
                  </td>
                  <td data-label="Created">{formatDate(t.created_at)}</td>
                  <td className="row-actions">
                    {confirmId === t.id ? (
                      <span className="confirm" role="group" aria-label={`Delete ${t.name}?`}>
                        <span className="confirm-text">
                          {t.events_count ? `Remove from ${plural(t.events_count, 'event')}?` : 'Delete?'}
                        </span>
                        <button className="btn btn-sm" onClick={() => setConfirmId(null)} autoFocus>
                          Keep
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          disabled={busyId === t.id}
                          onClick={() => remove(t)}
                        >
                          Delete
                        </button>
                      </span>
                    ) : (
                      <>
                        <button className="btn btn-sm" onClick={() => startEdit(t)}>
                          Rename
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            setEditId(null)
                            setConfirmId(t.id)
                          }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}

      {data && <Pager page={page} count={data.count} pageSize={PAGE_SIZE} onChange={setPage} />}
    </>
  )
}
