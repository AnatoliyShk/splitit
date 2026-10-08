import { Link } from 'react-router'

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="sticker">Never go alone</span>
          <h1>
            Go to occasions together. Leave with <mark>friends</mark>
          </h1>
          <p className="tagline">
            Find people heading to the same concerts, meetups and trips, and
            turn one night out into a community.
          </p>
        </div>

        <section className="explore-promo" aria-labelledby="explore-promo-title">
          <span className="promo-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="m15.5 8.5-2 5-5 2 2-5z" />
            </svg>
          </span>
          <h2 id="explore-promo-title">Explore occasions</h2>
          <p>
            See what's coming up one card at a time. Accept an occasion to save your spot, or decline to see the
            next one.
          </p>
          <Link className="btn btn-primary" to="/explore">
            Start exploring
          </Link>
        </section>
      </section>
    </>
  )
}
