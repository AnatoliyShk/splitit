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
    // Drop everything cached for this user, so the next one never sees it
    const forgetUser = () => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.me[0] })
      setUser(null)
    }
    return {
      user,
      loading,
      login: async (email, password) => {
        const userResponse = await apiPost<UserResponse>('/api/auth/login/', { email, password })
        setUser(userResponse.user)
      },
      register: async (name, email, password, isAdult) => {
        const userResponse = await apiPost<UserResponse>('/api/auth/register/', {
          name,
          email,
          password,
          is_adult: isAdult,
        })
        setUser(userResponse.user)
      },
      declareAge: async (isAdult) => {
        const userResponse = await apiPost<UserResponse | null>('/api/auth/age/', { is_adult: isAdult })
        // Under 18: the server deleted the account and ended the session (204, no body)
        if (userResponse?.user) setUser(userResponse.user)
        else forgetUser()
      },
      logout: async () => {
        await apiPost('/api/auth/logout/')
        forgetUser()
      },
      setUser,
    }
  }, [queryClient, user, loading])

  return <AuthContext value={auth}>{children}</AuthContext>
}
