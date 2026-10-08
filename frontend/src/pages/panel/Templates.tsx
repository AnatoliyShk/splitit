import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { apiDelete, apiGet, useFieldErrors } from '../../api'
import { Field, FormAlert } from '../../components/Field'
import { Pager } from '../../components/Pager'
import { RowMenu } from '../../components/RowMenu'
import { TagList } from '../../components/TagList'
import { listQueryString, queryKeys } from '../../queryClient'
import type { PanelTemplate } from '../../types/api/admin'
import type { Page } from '../../types/api/pagination'
import { formatDate, formatDuration, PAGE_SIZE, useDebounced } from './shared'

export default function Templates() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const searchQuery = useDebounced(search.trim())
  const [page, setPage] = useState(1)
  const listParams = { page, search: searchQuery }

  const templatesQuery = useQuery({
    queryKey: queryKeys.panel.templates(listParams),
    queryFn: () => apiGet<Page<PanelTemplate>>(`/api/admin/templates/?${listQueryString(listParams)}`),
    // Keep the current page on screen while the next one loads
    placeholderData: keepPreviousData,
  })
  const templatesPage = templatesQuery.data

  // One row at a time asks to confirm a delete
  const [confirmTemplateId, setConfirmTemplateId] = useState<number | null>(null)
  const deleteMutation = useMutation({
    mutationFn: (template: PanelTemplate) => apiDelete(`/api/admin/templates/${template.id}/`),
    onSuccess: () => {
      setConfirmTemplateId(null)
      // Step back a page if this deleted the last row on it
      if (templatesPage?.results.length === 1 && page > 1) setPage(page - 1)
      else return queryClient.invalidateQueries({ queryKey: queryKeys.panel.templates() })
    },
  })
  const busyTemplateId = deleteMutation.isPending ? deleteMutation.variables.id : null
  const errors = useFieldErrors(deleteMutation.error, templatesQuery.error)

  return (
    <>
      <div className="panel-head">
        <h1>Templates</h1>
        <div className="panel-head-actions">
          {templatesPage && <span className="muted">{templatesPage.count} total</span>}
          <Link className="btn btn-primary" to="/admin/templates/new">
            New template
          </Link>
        </div>
      </div>

      <div className="panel-toolbar">
        <Field
          id="template-search"
          label="Search by name"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
      </div>

      <FormAlert messages={errors.non_field_errors} />

      {templatesPage && templatesPage.results.length === 0 && (
        <div className="empty">
          <p>
            {searchQuery
              ? `No templates match “${searchQuery}”.`
              : 'No templates yet. Users pick one on their profile to make an occasion.'}
          </p>
          {!searchQuery && (
            <Link className="btn btn-primary btn-sm" to="/admin/templates/new">
              New template
            </Link>
          )}
        </div>
      )}

      {templatesPage && templatesPage.results.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Template</th>
              <th scope="col">Length</th>
              <th scope="col">Created</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {templatesPage.results.map((template) => (
              <tr key={template.id}>
                <td className="cell-stack" data-label="Template">
                  <strong>{template.name}</strong>
                  <TagList tagNames={template.tags.map((tag) => tag.name)} />
                </td>
                <td data-label="Length">
                  {template.duration_minutes === null ? 'Open' : formatDuration(template.duration_minutes)}
                </td>
                <td data-label="Created">{formatDate(template.created_at)}</td>
                <td className="row-actions">
                  <RowMenu label={template.name}>
                    {confirmTemplateId === template.id ? (
                      <span className="confirm" role="group" aria-label={`Delete ${template.name}?`}>
                        <span className="confirm-text">Delete?</span>
                        <button className="btn btn-sm" onClick={() => setConfirmTemplateId(null)} autoFocus>
                          Keep
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          disabled={busyTemplateId === template.id}
                          onClick={() => deleteMutation.mutate(template)}
                        >
                          Delete
                        </button>
                      </span>
                    ) : (
                      <>
                        <Link className="btn btn-sm" to={`/admin/templates/${template.id}`}>
                          Edit
                        </Link>
                        <button className="btn btn-sm btn-danger" onClick={() => setConfirmTemplateId(template.id)}>
                          Delete
                        </button>
                      </>
                    )}
                  </RowMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {templatesPage && <Pager page={page} count={templatesPage.count} pageSize={PAGE_SIZE} onChange={setPage} />}
    </>
  )
}
