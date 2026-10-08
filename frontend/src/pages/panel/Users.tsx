import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet, apiPatch, apiPost, useFieldErrors } from '../../api'
import { useAuth } from '../../auth'
import { Field, FormAlert } from '../../components/Field'
import { Pager } from '../../components/Pager'
import { RowMenu } from '../../components/RowMenu'
import { listQueryString, queryKeys } from '../../queryClient'
import type { PanelUser } from '../../types/api/admin'
import type { Page } from '../../types/api/pagination'
import { formatDate, PAGE_SIZE, useDebounced } from './shared'

type UserChanges = Partial<Pick<PanelUser, 'is_active' | 'is_staff'>>

export default function Users() {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const searchQuery = useDebounced(search.trim())
  const [page, setPage] = useState(1)
  const listParams = { page, search: searchQuery }

  const usersQuery = useQuery({
    queryKey: queryKeys.panel.users(listParams),
    queryFn: () => apiGet<Page<PanelUser>>(`/api/admin/users/?${listQueryString(listParams)}`),
    // Keep the current page on screen while the next one loads
    placeholderData: keepPreviousData,
  })
  const usersPage = usersQuery.data

  const updateMutation = useMutation({
    mutationFn: ({ panelUser, changes }: { panelUser: PanelUser; changes: UserChanges }) =>
      apiPatch<PanelUser>(`/api/admin/users/${panelUser.id}/`, changes),
    onSuccess: (updatedUser) => {
      queryClient.setQueryData<Page<PanelUser>>(
        queryKeys.panel.users(listParams),
        (cachedPage) =>
          cachedPage && {
            ...cachedPage,
            results: cachedPage.results.map((panelUser) => (panelUser.id === updatedUser.id ? updatedUser : panelUser)),
          },
      )
    },
  })
  const busyUserId = updateMutation.isPending ? updateMutation.variables.panelUser.id : null

  const testMutation = useMutation({
    mutationFn: () => apiPost<PanelUser>('/api/admin/users/test/'),
    onMutate: () => updateMutation.reset(),
    // Refresh first, so the message never points at a row the table doesn't show yet
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.panel.users() }),
  })
  const testUser = testMutation.isSuccess ? testMutation.data : null
  const errors = useFieldErrors(updateMutation.error, testMutation.error, usersQuery.error)

  return (
    <>
      <div className="panel-head">
        <h1>Users</h1>
        <div className="panel-head-actions">
          {usersPage && <span className="muted">{usersPage.count} total</span>}
          <button className="btn" type="button" onClick={() => testMutation.mutate()} disabled={testMutation.isPending}>
            {testMutation.isPending ? 'Creating…' : 'Create test user'}
          </button>
        </div>
      </div>

      {testUser && (
        <p className="form-status" role="status">
          Created {testUser.name} ({testUser.email}). It has no password, so it can't log in.
        </p>
      )}

      <div className="panel-toolbar">
        <Field
          id="user-search"
          label="Search by name or email"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
      </div>

      <FormAlert messages={errors.non_field_errors} />

      {usersPage && usersPage.results.length === 0 && (
        <div className="empty">
          <p>No users match “{searchQuery}”.</p>
        </div>
      )}

      {usersPage && usersPage.results.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col">Joined</th>
              <th scope="col">Occasions</th>
              <th scope="col">Access</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {usersPage.results.map((panelUser) => {
              const isMe = panelUser.id === currentUser?.id
              // Mirrors the backend: no changing your own access, only superusers manage superusers
              const locked = isMe || (panelUser.is_superuser && !currentUser?.is_superuser)
              const busy = busyUserId === panelUser.id
              return (
                <tr key={panelUser.id}>
                  <td className="cell-stack" data-label="User">
                    <strong>{panelUser.name || '—'}</strong>
                    <small>{panelUser.email}</small>
                  </td>
                  <td data-label="Joined">{formatDate(panelUser.date_joined)}</td>
                  <td data-label="Occasions">{panelUser.occasions_count}</td>
                  <td data-label="Access">
                    <span className="tags">
                      {isMe && <span className="tag">You</span>}
                      {panelUser.is_superuser ? (
                        <span className="tag">Superuser</span>
                      ) : (
                        panelUser.is_staff && <span className="tag">Admin</span>
                      )}
                      {!panelUser.is_active && <span className="tag tag-off">Deactivated</span>}
                      {panelUser.is_active && !panelUser.is_staff && !isMe && (
                        <span className="tag tag-off">Member</span>
                      )}
                    </span>
                  </td>
                  <td className="row-actions">
                    {!locked && (
                      <RowMenu label={panelUser.name || panelUser.email}>
                        <button
                          className="btn btn-sm"
                          disabled={busy}
                          onClick={() =>
                            updateMutation.mutate({ panelUser, changes: { is_staff: !panelUser.is_staff } })
                          }
                        >
                          {panelUser.is_staff ? 'Remove admin' : 'Make admin'}
                        </button>
                        <button
                          className="btn btn-sm"
                          disabled={busy}
                          onClick={() =>
                            updateMutation.mutate({ panelUser, changes: { is_active: !panelUser.is_active } })
                          }
                        >
                          {panelUser.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </RowMenu>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {usersPage && <Pager page={page} count={usersPage.count} pageSize={PAGE_SIZE} onChange={setPage} />}
    </>
  )
}
