import { useMutation } from '@tanstack/react-query'
import { useState, type SubmitEvent } from 'react'
import { useFieldErrors } from '../api'
import { useAuth } from '../auth'
import { AuthCard } from '../components/AuthCard'
import { Field } from '../components/Field'

export default function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // On success AuthCard redirects, since the user is now logged in
  const loginMutation = useMutation({ mutationFn: () => login(email, password) })
  const errors = useFieldErrors(loginMutation.error)
  // Stays on after success until the redirect
  const submitting = loginMutation.isPending || loginMutation.isSuccess

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    loginMutation.mutate()
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
          onChange={(event) => setEmail(event.target.value)}
          errors={errors.email}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          errors={errors.password}
        />
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </AuthCard>
    </>
  )
}
