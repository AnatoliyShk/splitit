import { Link } from 'react-router'

const features = [
  {
    step: '01',
    title: 'Find occasions',
    text: 'Browse concerts, meetups, hikes and game nights happening near you.',
    tone: 'primary',
  },
  {
    step: '02',
    title: 'Go together',
    text: 'Join a group heading to the same occasion, so you never have to go alone.',
    tone: 'secondary',
  },
  {
    step: '03',
    title: 'Make friends',
    text: 'Meet people who share your interests and keep in touch after the occasion.',
    tone: 'primary',
  },
]

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

      <section className="cards" aria-label="How it works">
        {features.map((feature) => (
          <article className={`card card-${feature.tone}`} key={feature.title}>
            <span className="card-step">{feature.step}</span>
            <h2>{feature.title}</h2>
            <p>{feature.text}</p>
          </article>
        ))}
      </section>
    </>
  )
}
