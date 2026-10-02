import { useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router'
import './App.css'
import { useAuth } from './auth'
import Home from './pages/Home'
import Login from './pages/Login'
import Profile from './pages/Profile'
import Register from './pages/Register'
import EventForm from './pages/panel/EventForm'
import Events from './pages/panel/Events'
import Overview from './pages/panel/Overview'
import PanelLayout from './pages/panel/PanelLayout'
import Tags from './pages/panel/Tags'
import Users from './pages/panel/Users'

function HeaderActions() {
  const { user, loading, logout } = useAuth()
  const { pathname } = useLocation()

  if (loading) return null

  if (user) {
    return (
      <div className="header-actions">
        {user.is_staff && (
          <NavLink className="btn btn-ghost" to="/admin">
            Admin
          </NavLink>
        )}
        <NavLink className="btn btn-ghost btn-profile" to="/profile" title={`Logged in as ${user.name}`}>
          <span className="avatar-mini" aria-hidden="true">
            {user.name.trim().charAt(0).toUpperCase() || '?'}
          </span>
          <span className="btn-label">Profile</span>
        </NavLink>
        <button className="btn btn-ghost btn-danger" onClick={() => logout().catch(() => {})}>
          Log out
        </button>
      </div>
    )
  }

  // The auth pages have their own Log in / Create account tabs
  if (pathname === '/login' || pathname === '/register') return null

  return (
    <Link className="btn btn-ghost" to="/login">
      Log in
    </Link>
  )
}

export default function App() {
  const [status, setStatus] = useState('loading...')

  useEffect(() => {
    fetch('/api/health/')
      .then((r) => r.json())
      .then((d) => setStatus(d.status))
      .catch(() => setStatus('unreachable'))
  }, [])

  return (
    <>
      <header className="header">
        <Link className="logo" to="/">
          <span className="logo-mark" aria-hidden="true">
            ÷
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
          <Route path="/admin" element={<PanelLayout />}>
            <Route index element={<Overview />} />
            <Route path="users" element={<Users />} />
            <Route path="events" element={<Events />} />
            <Route path="events/new" element={<EventForm />} />
            <Route path="events/:id" element={<EventForm key="edit" />} />
            <Route path="tags" element={<Tags />} />
          </Route>
        </Routes>
      </main>

      <footer className="footer">
        <span className="logo-small">Splitit</span>
        <span className={`status status-${status === 'ok' ? 'ok' : 'bad'}`}>
          <span className="status-dot" aria-hidden="true" />
          API status: {status}
        </span>
      </footer>
    </>
  )
}
