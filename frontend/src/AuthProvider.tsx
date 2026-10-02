import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiGet, apiPost, type User } from './api'
import { AuthContext, type Auth } from './auth'

type UserResponse = { user: User | null }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiGet<UserResponse>('/api/auth/me/')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const auth = useMemo<Auth>(
    () => ({
      user,
      loading,
      login: async (email, password) => {
        const d = await apiPost<UserResponse>('/api/auth/login/', { email, password })
        setUser(d.user)
      },
      register: async (name, email, password) => {
        const d = await apiPost<UserResponse>('/api/auth/register/', { name, email, password })
        setUser(d.user)
      },
      logout: async () => {
        await apiPost('/api/auth/logout/')
        setUser(null)
      },
      setUser,
    }),
    [user, loading],
  )

  return <AuthContext value={auth}>{children}</AuthContext>
}
