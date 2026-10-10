import { createContext, useContext } from 'react'
import type { Gender, User } from './types/api/users'

export type Auth = {
  user: User | null
  // True until the first /api/auth/me/ check finishes
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  // isAdult: the "I'm 18 or older" box; the server refuses the account without it
  register: (name: string, email: string, password: string, isAdult: boolean, gender: Gender) => Promise<void>
  // For an account made before sign-up asked: true records it, false deletes the account and logs out
  declareAge: (isAdult: boolean) => Promise<void>
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
