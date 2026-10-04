import { useState, type SubmitEvent } from 'react'
import { errorsFrom, type FieldErrors } from '../api'
import { useAuth } from '../auth'
import { AuthCard } from '../components/AuthCard'
import { Field } from '../components/Field'

export default function Register() {
  const { register } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    try {
      // On success AuthCard redirects, since the user is now logged in
      await register(name, email, password)
    } catch (err) {
      setErrors(errorsFrom(err))
      setSubmitting(false)
    }
  }

  return (
    <>
      <title>Create account · Splitit</title>
      <AuthCard
        title="Never go alone"
        subtitle="Join people heading to the same occasions as you."
        errors={errors}
        onSubmit={onSubmit}
      >
        <Field
          id="name"
          label="Name"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          errors={errors.name}
        />
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
          autoComplete="new-password"
          required
          hint="At least 8 characters, not too common and not only numbers."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          errors={errors.password}
        />
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </AuthCard>
    </>
  )
}
