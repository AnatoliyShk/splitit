import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type SubmitEvent } from 'react'
import { apiDelete, apiGet, apiPatch, apiPost, useFieldErrors, type Page } from '../../api'
import { Field, FormAlert } from '../../components/Field'
import { Pager } from '../../components/Pager'
import { listQueryString, queryKeys } from '../../queryClient'
import { formatDate, PAGE_SIZE, plural, useDebounced, type PanelTag } from './shared'

export default function Tags() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const searchQuery = useDebounced(search.trim())
  const [page, setPage] = useState(1)
  const listParams = { page, search: searchQuery }

  const tagsQuery = useQuery({
    queryKey: queryKeys.panel.tags(listParams),
    queryFn: () => apiGet<Page<PanelTag>>(`/api/panel/tags/?${listQueryString(listParams)}`),
    // Keep the current page on screen while the next one loads
    placeholderData: keepPreviousData,
  })
  const tagsPage = tagsQuery.data
  // Refetch every cached tag list, the pickers' searches included
  const refreshTags = () => queryClient.invalidateQueries({ queryKey: queryKeys.panel.tags() })

  const [newTagName, setNewTagName] = useState('')
  const createMutation = useMutation({
    mutationFn: (tagName: string) => apiPost('/api/panel/tags/', { name: tagName }),
    onSuccess: () => {
      setNewTagName('')
      return refreshTags()
    },
  })
  const createErrors = useFieldErrors(createMutation.error)

  // One row at a time can be renamed or asked to confirm a delete
  const [editTagId, setEditTagId] = useState<number | null>(null)
  const [editTagName, setEditTagName] = useState('')
  const [confirmTagId, setConfirmTagId] = useState<number | null>(null)

  const renameMutation = useMutation({
    mutationFn: ({ tag, tagName }: { tag: PanelTag; tagName: string }) =>
      apiPatch<PanelTag>(`/api/panel/tags/${tag.id}/`, { name: tagName }),
    onSuccess: (renamedTag) => {
      queryClient.setQueryData<Page<PanelTag>>(
        queryKeys.panel.tags(listParams),
        (cachedPage) =>
          cachedPage && {
            ...cachedPage,
            results: cachedPage.results.map((tag) => (tag.id === renamedTag.id ? renamedTag : tag)),
          },
      )
      setEditTagId(null)
    },
  })
  const editErrors = useFieldErrors(renameMutation.error)

  const deleteMutation = useMutation({
    mutationFn: (tag: PanelTag) => apiDelete(`/api/panel/tags/${tag.id}/`),
    onSuccess: () => {
      setConfirmTagId(null)
      // Step back a page if this deleted the last row on it
      if (tagsPage?.results.length === 1 && page > 1) setPage(page - 1)
      else return refreshTags()
    },
  })
  const errors = useFieldErrors(deleteMutation.error, tagsQuery.error)
  const busyTagId = renameMutation.isPending
    ? renameMutation.variables.tag.id
    : deleteMutation.isPending
      ? deleteMutation.variables.id
      : null

  function create(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    createMutation.mutate(newTagName)
  }

  function startEdit(tag: PanelTag) {
    setConfirmTagId(null)
    setEditTagId(tag.id)
    setEditTagName(tag.name)
    renameMutation.reset()
  }

  function rename(event: SubmitEvent<HTMLFormElement>, tag: PanelTag) {
    event.preventDefault()
    renameMutation.mutate({ tag, tagName: editTagName })
  }

  return (
    <>
      <div className="panel-head">
        <h1>Tags</h1>
        {tagsPage && <span className="muted">{tagsPage.count} total</span>}
      </div>

      <div className="panel-toolbar-row">
        <form className="inline-form" onSubmit={create} noValidate>
          <Field
            id="new-tag"
            label="New tag"
            placeholder="e.g. Jazz"
            maxLength={50}
            value={newTagName}
            onChange={(event) => {
              setNewTagName(event.target.value)
              createMutation.reset()
            }}
            errors={createErrors.name ?? createErrors.non_field_errors}
          />
          <button className="btn btn-primary" type="submit" disabled={createMutation.isPending || !newTagName.trim()}>
            Add tag
          </button>
        </form>
        <div className="panel-toolbar">
          <Field
            id="tag-search"
            label="Search tags"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
          />
        </div>
      </div>

      <FormAlert messages={errors.non_field_errors} />

      {tagsPage && tagsPage.results.length === 0 && (
        <div className="empty">
          <p>{searchQuery ? `No tags match “${searchQuery}”.` : 'No tags yet. Add the first one above.'}</p>
        </div>
      )}

      {tagsPage && tagsPage.results.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Tag</th>
              <th scope="col">Occasions</th>
              <th scope="col">Embedding</th>
              <th scope="col">Created</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tagsPage.results.map((tag) =>
              editTagId === tag.id ? (
                <tr key={tag.id}>
                  <td colSpan={5}>
                    <form className="inline-form" onSubmit={(event) => rename(event, tag)} noValidate>
                      <Field
                        id={`rename-${tag.id}`}
                        label={`Rename “${tag.name}”`}
                        maxLength={50}
                        autoFocus
                        value={editTagName}
                        onChange={(event) => {
                          setEditTagName(event.target.value)
                          renameMutation.reset()
                        }}
                        onKeyDown={(event) => event.key === 'Escape' && setEditTagId(null)}
                        errors={editErrors.name ?? editErrors.non_field_errors}
                      />
                      <span className="inline-form-actions">
                        <button className="btn btn-sm" type="button" onClick={() => setEditTagId(null)}>
                          Cancel
                        </button>
                        <button
                          className="btn btn-sm btn-confirm"
                          type="submit"
                          disabled={busyTagId === tag.id || !editTagName.trim()}
                        >
                          Save
                        </button>
                      </span>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={tag.id}>
                  <td data-label="Tag">
                    <span className="tag-name">{tag.name}</span>
                  </td>
                  <td data-label="Occasions">{tag.occasions_count}</td>
                  <td data-label="Embedding">
                    {/* Neutral status in ink: a check mark when the vector exists, a dash while it's missing */}
                    {tag.has_embedding ? (
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
                  <td data-label="Created">{formatDate(tag.created_at)}</td>
                  <td className="row-actions">
                    {confirmTagId === tag.id ? (
                      <span className="confirm" role="group" aria-label={`Delete ${tag.name}?`}>
                        <span className="confirm-text">
                          {tag.occasions_count ? `Remove from ${plural(tag.occasions_count, 'occasion')}?` : 'Delete?'}
                        </span>
                        <button className="btn btn-sm" onClick={() => setConfirmTagId(null)} autoFocus>
                          Keep
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          disabled={busyTagId === tag.id}
                          onClick={() => deleteMutation.mutate(tag)}
                        >
                          Delete
                        </button>
                      </span>
                    ) : (
                      <>
                        <button className="btn btn-sm" onClick={() => startEdit(tag)}>
                          Rename
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            setEditTagId(null)
                            setConfirmTagId(tag.id)
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

      {tagsPage && <Pager page={page} count={tagsPage.count} pageSize={PAGE_SIZE} onChange={setPage} />}
    </>
  )
}
