import { useEffect, useState } from 'react'
import './App.css'

const features = [
  {
    step: '01',
    title: 'Find events',
    text: 'Browse concerts, meetups, hikes and game nights happening near you.',
    tone: 'primary',
  },
  {
    step: '02',
    title: 'Go together',
    text: 'Join a group heading to the same event, so you never have to go alone.',
    tone: 'secondary',
  },
  {
    step: '03',
    title: 'Make friends',
    text: 'Meet people who share your interests and keep in touch after the event.',
    tone: 'primary',
  },
]

// Sample data for the hero illustration
const exampleEvents = [
  { day: 'Fri', time: '20:00', title: 'Indie night', place: 'The Warehouse', going: 14 },
  { day: 'Sat', time: '18:00', title: 'Sunset jazz', place: 'Riverside Park', going: 7 },
  { day: 'Sun', time: '10:00', title: 'Morning hike', place: 'Pine Ridge trail', going: 9 },
]

const exampleGroup = ['A', 'B', 'C', 'D']

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
        <a className="logo" href="/">
          <span className="logo-mark" aria-hidden="true">
            ÷
          </span>
          Splitit
        </a>
        <button className="btn btn-ghost">Log in</button>
      </header>

      <main className="main">
        <section className="hero">
          <div className="hero-copy">
            <span className="sticker">Never go alone</span>
            <h1>
              Go to events together. Leave with <mark>friends</mark>
            </h1>
            <p className="tagline">
              Find people heading to the same concerts, meetups and trips, and
              turn one night out into a community.
            </p>
            <div className="actions">
              <button className="btn btn-primary">Find events</button>
              <button className="btn">Log in</button>
            </div>
          </div>

          <figure className="example" aria-label="Example events">
            <div className="example-head">
              <span className="example-title">This weekend</span>
              <span className="chip">Near you</span>
            </div>
            <ul className="event-list">
              {exampleEvents.map((e) => (
                <li key={e.title}>
                  <span className="event-day">{e.day}</span>
                  <span className="event-info">
                    <strong>{e.title}</strong>
                    <small>
                      {e.time} · {e.place}
                    </small>
                  </span>
                  <span className="event-going">{e.going} going</span>
                </li>
              ))}
            </ul>
            <div className="group">
              <div className="avatars" aria-hidden="true">
                {exampleGroup.map((initial) => (
                  <span className="avatar" key={initial}>
                    {initial}
                  </span>
                ))}
              </div>
              <p>
                <strong>Ana, Ben and 5 others</strong> are going to Sunset jazz
                together
              </p>
            </div>
            <figcaption>Example</figcaption>
          </figure>
        </section>

        <section className="cards" aria-label="How it works">
          {features.map((f) => (
            <article className={`card card-${f.tone}`} key={f.title}>
              <span className="card-step">{f.step}</span>
              <h2>{f.title}</h2>
              <p>{f.text}</p>
            </article>
          ))}
        </section>
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
