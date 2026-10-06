import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router'
import { useAuth } from '../../auth'

const tabs = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/users', label: 'Users', end: false },
  { to: '/admin/occasions', label: 'Occasions', end: false },
  { to: '/admin/tags', label: 'Tags', end: false },
]

// Staff-only area; the backend enforces the same rule on every /api/panel/ endpoint
export default function PanelLayout() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return null
  // Send visitors to log in, then bring them back here
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  if (!user.is_staff) {
    return (
      <section className="notice-card">
        <title>Admins only · Splitit</title>
        <h1>Admins only</h1>
        <p>
          You're logged in as <strong>{user.email}</strong>, which doesn't have admin access. Ask an
          admin to give you access from the Users tab.
        </p>
        <Link className="btn" to="/">
          Back to home
        </Link>
      </section>
    )
  }

  return (
    <section className="panel">
      <title>Admin · Splitit</title>
      <nav className="tabs" aria-label="Admin sections">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className="tab">
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <div className="tabbed-card panel-card">
        <Outlet />
      </div>
    </section>
  )
}
