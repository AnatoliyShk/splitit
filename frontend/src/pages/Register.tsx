import { useMutation } from '@tanstack/react-query'
import { useState, type SubmitEvent } from 'react'
import { Link } from 'react-router'
import { useFieldErrors } from '../api'
import { useAuth } from '../auth'
import { AuthCard } from '../components/AuthCard'
import { CheckboxField, Field, SelectField } from '../components/Field'
import { GENDER_OPTIONS } from '../gender'
import type { Gender } from '../types/api/users'

export default function Register() {
  const { register } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [gender, setGender] = useState<Gender>('undisclosed')
  // Starts unticked: the user has to make the statement themselves
  const [isAdult, setIsAdult] = useState(false)
  // On success AuthCard redirects, since the user is now logged in
  const registerMutation = useMutation({ mutationFn: () => register(name, email, password, isAdult, gender) })
  const errors = useFieldErrors(registerMutation.error)
  // Stays on after success until the redirect
  const submitting = registerMutation.isPending || registerMutation.isSuccess

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    registerMutation.mutate()
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
          onChange={(event) => setName(event.target.value)}
          errors={errors.name}
        />
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
          autoComplete="new-password"
          required
          hint="At least 8 characters, not too common and not only numbers."
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          errors={errors.password}
        />
        <SelectField
          id="gender"
          label="Gender"
          options={GENDER_OPTIONS}
          value={gender}
          onChange={(event) => setGender(event.target.value as Gender)}
          errors={errors.gender}
        />
        <CheckboxField
          id="is_adult"
          label="I confirm that I'm 18 or older"
          required
          hint={
            <>
              Splitit is for adults only.{' '}
              <Link to="/adults-only" target="_blank" rel="noreferrer">
                Read the age rules
              </Link>
            </>
          }
          checked={isAdult}
          onChange={(event) => setIsAdult(event.target.checked)}
          errors={errors.is_adult}
        />
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </AuthCard>
    </>
  )
}
