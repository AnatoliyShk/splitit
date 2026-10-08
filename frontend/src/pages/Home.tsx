import { PromoCard } from '../components/PromoCard'

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

        <div className="promos">
          <PromoCard
            icon={
              <>
                <circle cx="12" cy="12" r="9" />
                <path d="m15.5 8.5-2 5-5 2 2-5z" />
              </>
            }
            title="Explore occasions"
            to="/explore"
            actionLabel="Start exploring"
            primary
          >
            See what's coming up one card at a time. Accept an occasion to save your spot, or decline to see the
            next one.
          </PromoCard>

          <PromoCard
            icon={
              <>
                <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
                <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
              </>
            }
            title="Add an occasion from a link"
            to="/profile"
            actionLabel="Add from a link"
            primary
          >
            Found an event somewhere else? Paste its page's link on your profile. Splitit reads the name, dates,
            description and tags for you, creates the occasion with a preview picture and saves your spot. Only you
            and your connections will see it.
          </PromoCard>
        </div>
      </section>
    </>
  )
}
