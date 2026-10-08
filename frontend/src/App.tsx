import { useQuery } from '@tanstack/react-query'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router'
import { apiGet } from './api'
import './App.css'
import { useAuth } from './auth'
import CreateOccasion from './pages/CreateOccasion'
import Explore from './pages/Explore'
import Home from './pages/Home'
import Login from './pages/Login'
import OccasionPage from './pages/OccasionPage'
import Profile from './pages/Profile'
import Register from './pages/Register'
import Settings from './pages/Settings'
import OccasionForm from './pages/panel/OccasionForm'
import Occasions from './pages/panel/Occasions'
import Overview from './pages/panel/Overview'
import PanelLayout from './pages/panel/PanelLayout'
import Tags from './pages/panel/Tags'
import Users from './pages/panel/Users'
import { queryKeys } from './queryClient'
import { LogoMark } from './components/LogoMark'

function HeaderActions() {
  const { user, loading } = useAuth()
  const { pathname } = useLocation()

  if (loading) return null

  const exploreLink = (
    <NavLink className="btn btn-ghost btn-explore" to="/explore">
      <svg className="btn-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="m15.5 8.5-2 5-5 2 2-5z" />
      </svg>
      <span className="btn-label">Explore</span>
    </NavLink>
  )

  if (user) {
    return (
      <div className="header-actions">
        {exploreLink}
        {user.is_staff && (
          <NavLink className="btn btn-ghost btn-admin" to="/admin">
            {/* A shield: on phones the button is just this, with the label kept for screen readers */}
            <svg className="btn-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <span className="btn-label">Admin</span>
          </NavLink>
        )}
        <NavLink className="btn btn-ghost btn-profile" to="/profile" title={`Logged in as ${user.name}`}>
          <span className="avatar-mini" aria-hidden="true">
            {user.name.trim().charAt(0).toUpperCase() || '?'}
          </span>
          <span className="btn-label">Profile</span>
        </NavLink>
      </div>
    )
  }

  // The auth pages have their own Log in / Create account tabs
  if (pathname === '/login' || pathname === '/register') return null

  return (
    <div className="header-actions">
      {exploreLink}
      <Link className="btn btn-ghost" to="/login">
        Log in
      </Link>
    </div>
  )
}

export default function App() {
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => apiGet<{ status: string }>('/api/health/'),
  })
  const healthStatus = healthQuery.data?.status ?? (healthQuery.isError ? 'unreachable' : 'loading...')

  return (
    <>
      <header className="header">
        <Link className="logo" to="/">
          <span className="logo-mark" aria-hidden="true">
            <LogoMark />
          </span>
          <span className="logo-text">Splitit</span>
        </Link>
        <HeaderActions />
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/profile/settings" element={<Settings />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/occasions/new" element={<CreateOccasion />} />
          <Route path="/occasions/:id" element={<OccasionPage />} />
          <Route path="/admin" element={<PanelLayout />}>
            <Route index element={<Overview />} />
            <Route path="users" element={<Users />} />
            <Route path="occasions" element={<Occasions />} />
            <Route path="occasions/new" element={<OccasionForm />} />
            <Route path="occasions/:id" element={<OccasionForm key="edit" />} />
            <Route path="tags" element={<Tags />} />
          </Route>
        </Routes>
      </main>

      <footer className="footer">
        <span className="logo-small">Splitit</span>
        <span className={`status status-${healthStatus === 'ok' ? 'ok' : 'bad'}`}>
          <span className="status-dot" aria-hidden="true" />
          API status: {healthStatus}
        </span>
      </footer>
    </>
  )
}
