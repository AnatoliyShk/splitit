import { createContext, useContext } from 'react'
import type { User } from './types/users'

export type Auth = {
  user: User | null
  // True until the first /api/auth/me/ check finishes
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  // Replace the cached user after the profile is edited
  setUser: (user: User) => void
}

export const AuthContext = createContext<Auth | null>(null)

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>')
  return auth
}
