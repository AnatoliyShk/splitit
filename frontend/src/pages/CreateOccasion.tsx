import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type SubmitEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { apiGet, apiPost, useFieldErrors } from '../api'
import { useAuth } from '../auth'
import { Field, FormAlert, TextAreaField } from '../components/Field'
import { queryKeys } from '../queryClient'
import type { OccasionDetail } from '../types/api/occasions'
import type { Tag } from '../types/api/tags'
import type { User } from '../types/api/users'
import { fromLocalInput, timeZone, toLocalInput } from './panel/shared'

function CreateOccasionForm({ user }: { user: User }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<ReadonlySet<number>>(new Set())
  // The earliest start the picker offers; the server checks again on submit
  const [minStart] = useState(() => toLocalInput(new Date().toISOString()))

  const tagsQuery = useQuery({ queryKey: queryKeys.tags, queryFn: () => apiGet<Tag[]>('/api/tags/') })
  const tags = tagsQuery.data

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost<OccasionDetail>('/api/occasions/', {
        name,
        description,
        start_datetime: fromLocalInput(start),
        end_datetime: fromLocalInput(end),
        tag_ids: [...selectedTagIds],
      }),
    onSuccess: (createdOccasion) => {
      queryClient.setQueryData(queryKeys.occasion(String(createdOccasion.id)), createdOccasion)
      // The creator is now going to it, which pauses Explore and adds it to their profile
      queryClient.invalidateQueries({ queryKey: queryKeys.explore })
      queryClient.invalidateQueries({ queryKey: queryKeys.userOccasions(user.uuid) })
      navigate(`/occasions/${createdOccasion.id}`)
    },
  })
  const errors = useFieldErrors(createMutation.error, tagsQuery.error)
  // Stays disabled after success, while the page changes
  const submitting = createMutation.isPending || createMutation.isSuccess

  // After a failed submit, move focus to the first invalid field so it's announced
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
  }, [errors])

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    createMutation.mutate()
  }

  function toggleTag(tagId: number) {
    setSelectedTagIds((tagIds) => {
      const toggledTagIds = new Set(tagIds)
      if (toggledTagIds.has(tagId)) toggledTagIds.delete(tagId)
      else toggledTagIds.add(tagId)
      return toggledTagIds
    })
  }

  return (
    <form ref={formRef} className="form" onSubmit={onSubmit} noValidate>
      <FormAlert messages={errors.non_field_errors} />
      <Field
        id="name"
        label="Name"
        required
        maxLength={255}
        value={name}
        onChange={(event) => setName(event.target.value)}
        errors={errors.name}
      />
      <TextAreaField
        id="description"
        label="Description (optional)"
        hint="What's the plan, and what should people bring? Cards show the first 100 characters."
        maxLength={2000}
        rows={4}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        errors={errors.description}
      />
      <Field
        id="start_datetime"
        label="Starts"
        type="datetime-local"
        required
        min={minStart}
        hint={`Your time zone: ${timeZone}`}
        value={start}
        onChange={(event) => setStart(event.target.value)}
        errors={errors.start_datetime}
      />
      <Field
        id="end_datetime"
        label="Ends (optional)"
        type="datetime-local"
        min={start || undefined}
        value={end}
        onChange={(event) => setEnd(event.target.value)}
        errors={errors.end_datetime}
      />

      <fieldset className="filter-group">
        <legend>Tags</legend>
        <p className="field-hint">Help people who like the same things find it.</p>
        {!tags && !tagsQuery.error && <p className="muted">Loading…</p>}
        {tags && tags.length === 0 && <p className="muted">No tags yet.</p>}
        {tags && tags.length > 0 && (
          <div className="filter-options">
            {tags.map((tag) => (
              <label className="filter-option" key={tag.id}>
                <input type="checkbox" checked={selectedTagIds.has(tag.id)} onChange={() => toggleTag(tag.id)} />
                {tag.name}
              </label>
            ))}
          </div>
        )}
        {errors.tag_ids && <FormAlert messages={errors.tag_ids} />}
      </fieldset>

      <div className="form-actions">
        <Link className="btn" to="/explore">
          Cancel
        </Link>
        <button className="btn btn-confirm" type="submit" disabled={submitting || !name.trim() || !start}>
          {submitting ? 'Creating…' : 'Create occasion'}
        </button>
      </div>
    </form>
  )
}

/** /occasions/new: a regular user creates an occasion that only they and their direct connections can see. */
export default function CreateOccasion() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return null
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  return (
    <section className="profile">
      <title>Create occasion · Splitit</title>
      <div className="panel-head">
        <div>
          <Link className="back-link" to="/explore">
            ← Explore
          </Link>
          <h1>Create occasion</h1>
        </div>
      </div>

      <section className="profile-card" aria-label="New occasion">
        <p className="muted">
          Only you and the people you're connected with will see it, and you'll be going to it. You can go to one
          occasion at a time.
        </p>
        <CreateOccasionForm user={user} />
      </section>
    </section>
  )
}
