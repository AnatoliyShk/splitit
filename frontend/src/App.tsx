import { useEffect, useState } from 'react'

export default function App() {
  const [status, setStatus] = useState('loading...')

  useEffect(() => {
    fetch('/api/health/')
      .then((r) => r.json())
      .then((d) => setStatus(d.status))
      .catch(() => setStatus('unreachable'))
  }, [])

  return <h1>API status: {status}</h1>
}
