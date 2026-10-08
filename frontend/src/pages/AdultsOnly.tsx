import { Link } from 'react-router'
import { useAuth } from '../auth'

/** The public statement that Splitit is for adults only, linked from sign-up and the footer. */
export default function AdultsOnly() {
  const { user } = useAuth()
  return (
    <article className="policy" aria-labelledby="adults-only-title">
      <title>Adults only · Splitit</title>
      <span className="sticker">18+</span>
      <h1 id="adults-only-title">Splitit is for adults only</h1>
      <p className="tagline">
        You must be 18 or older to create an account or use Splitit, wherever you live, even where younger people
        may use other apps.
      </p>

      <section aria-labelledby="why-title">
        <h2 id="why-title">Why</h2>
        <p>
          Splitit is about meeting people you don't know yet, in person: going to concerts, meetups and trips
          together and splitting the costs. We don't offer that to children.
        </p>
      </section>

      <section aria-labelledby="check-title">
        <h2 id="check-title">How we check</h2>
        <ul>
          <li>You can't create an account without confirming that you're 18 or older. The box starts unticked.</li>
          <li>We store the date and time you confirmed, as the record of it. We don't ask for your birthday or ID.</li>
          <li>Accounts made before we asked have to confirm before they can do anything else.</li>
        </ul>
      </section>

      <section aria-labelledby="under-title">
        <h2 id="under-title">If you're under 18</h2>
        <ul>
          <li>Don't create an account.</li>
          <li>
            If you tell us you're under 18, your account is deleted straight away with everything in it: occasions
            you added, the ones you joined, your connections and your filters.
          </li>
          <li>
            Confirming a false age breaks these rules. If we learn that an account belongs to someone under 18, we
            close it and delete its data.
          </li>
        </ul>
      </section>

      {!user && (
        <Link className="btn btn-primary" to="/register">
          Create an account
        </Link>
      )}
    </article>
  )
}
