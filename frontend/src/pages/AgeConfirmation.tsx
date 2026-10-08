import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { useFieldErrors } from '../api'
import { useAuth } from '../auth'
import { FormAlert } from '../components/Field'

/**
 * Shown instead of every page to a logged-in account with no 18+ declaration on record (made before sign-up asked
 * for it); the API refuses that account everything else until it answers. Under 18 deletes the account.
 */
export default function AgeConfirmation() {
  const { user, declareAge, logout } = useAuth()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const declareMutation = useMutation({ mutationFn: (isAdult: boolean) => declareAge(isAdult) })
  const logoutMutation = useMutation({ mutationFn: logout })
  const errors = useFieldErrors(declareMutation.error, logoutMutation.error)
  const busy = declareMutation.isPending || logoutMutation.isPending

  return (
    <section className="auth">
      <title>Confirm your age · Splitit</title>
      <div className="auth-panel">
        <div className="age-card">
          <div className="auth-head">
            <h1 id="age-title">Are you 18 or older?</h1>
            <p>
              {user ? `Hi ${user.name}. ` : ''}Splitit is for adults only. Your account was made before we asked,
              so confirm your age to carry on. We keep the date you confirmed as a record of it.
            </p>
          </div>

          <FormAlert messages={errors.non_field_errors ?? errors.is_adult} />

          <button
            className="btn btn-confirm"
            type="button"
            disabled={busy}
            onClick={() => declareMutation.mutate(true)}
          >
            {declareMutation.isPending && declareMutation.variables ? 'Saving…' : "Yes, I'm 18 or older"}
          </button>

          <div className="age-under">
            <h2>Under 18?</h2>
            <p className="muted">
              Then you can't use Splitit. Your account will be deleted with everything in it: occasions you added,
              the ones you joined, your connections and your filters.
            </p>
            {confirmingDelete ? (
              <div className="age-actions">
                <button
                  className="btn btn-danger"
                  type="button"
                  disabled={busy}
                  onClick={() => declareMutation.mutate(false)}
                >
                  {declareMutation.isPending && !declareMutation.variables ? 'Deleting…' : 'Yes, delete my account'}
                </button>
                <button className="btn" type="button" disabled={busy} onClick={() => setConfirmingDelete(false)}>
                  Go back
                </button>
              </div>
            ) : (
              <button className="btn btn-danger" type="button" disabled={busy} onClick={() => setConfirmingDelete(true)}>
                I'm under 18, delete my account
              </button>
            )}
          </div>

          <p className="age-footnote muted">
            <Link to="/adults-only">Read the age rules</Link> or{' '}
            <button className="link-button" type="button" disabled={busy} onClick={() => logoutMutation.mutate()}>
              log out
            </button>
            .
          </p>
        </div>
      </div>
    </section>
  )
}
