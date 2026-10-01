import { useState, type SubmitEvent } from 'react'
import { errorsFrom, type FieldErrors } from '../api'
import { useAuth } from '../auth'
import { AuthCard } from '../components/AuthCard'
import { Field } from '../components/Field'

export default function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    try {
      // On success AuthCard redirects, since the user is now logged in
      await login(email, password)
    } catch (err) {
      setErrors(errorsFrom(err))
      setSubmitting(false)
    }
  }

  return (
    <>
      <title>Log in · Splitit</title>
      <AuthCard
        title="Welcome back"
        subtitle="Pick up where you left off and see who's going."
        errors={errors}
        onSubmit={onSubmit}
      >
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          errors={errors.email}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          errors={errors.password}
        />
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </AuthCard>
    </>
  )
}
