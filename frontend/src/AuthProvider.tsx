import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, type ReactNode } from 'react'
import { apiGet, apiPost } from './api'
import { AuthContext, type Auth } from './auth'
import { queryKeys } from './queryClient'
import type { User } from './types/api/users'

type UserResponse = { user: User | null }

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  // A failed check counts as logged out
  const meQuery = useQuery({ queryKey: queryKeys.me, queryFn: () => apiGet<UserResponse>('/api/auth/me/') })
  const user = meQuery.data?.user ?? null
  const loading = meQuery.isPending

  const auth = useMemo<Auth>(() => {
    const setUser = (nextUser: User | null) => queryClient.setQueryData<UserResponse>(queryKeys.me, { user: nextUser })
    return {
      user,
      loading,
      login: async (email, password) => {
        const userResponse = await apiPost<UserResponse>('/api/auth/login/', { email, password })
        setUser(userResponse.user)
      },
      register: async (name, email, password) => {
        const userResponse = await apiPost<UserResponse>('/api/auth/register/', { name, email, password })
        setUser(userResponse.user)
      },
      logout: async () => {
        await apiPost('/api/auth/logout/')
        // Drop everything cached for this user, so the next one never sees it
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.me[0] })
        setUser(null)
      },
      setUser,
    }
  }, [queryClient, user, loading])

  return <AuthContext value={auth}>{children}</AuthContext>
}
