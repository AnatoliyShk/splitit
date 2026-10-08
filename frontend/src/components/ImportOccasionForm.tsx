import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type SubmitEvent } from 'react'
import { useNavigate } from 'react-router'
import { apiPost, useFieldErrors } from '../api'
import { queryKeys } from '../queryClient'
import type { OccasionDetail } from '../types/api/occasions'
import type { ImportOccasionFormProps } from '../types/ui/importOccasionForm'
import { Field, FormAlert } from './Field'
import { Spinner } from './Spinner'

/**
 * "Add an occasion from a link": the server has Gemini read the event's page, then creates the occasion
 * (the user goes to it, and only their connections see it) and this opens its page.
 */
export function ImportOccasionForm({ user }: ImportOccasionFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const [url, setUrl] = useState('')

  const importMutation = useMutation({
    mutationFn: () => apiPost<OccasionDetail>('/api/occasions/import/', { url: url.trim() }),
    onSuccess: (importedOccasion) => {
      queryClient.setQueryData(queryKeys.occasion(String(importedOccasion.id)), importedOccasion)
      // The user now goes to it, which pauses Explore and adds it to their profile; new tags may exist too
      queryClient.invalidateQueries({ queryKey: queryKeys.explore })
      queryClient.invalidateQueries({ queryKey: queryKeys.userOccasions(user.uuid) })
      queryClient.invalidateQueries({ queryKey: queryKeys.tags })
      navigate(`/occasions/${importedOccasion.id}`)
    },
  })
  const errors = useFieldErrors(importMutation.error)
  // Stays disabled after success, while the page changes
  const submitting = importMutation.isPending || importMutation.isSuccess

  // After a failed import, move focus to the link field when it's the problem, so the message is announced
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
  }, [errors])

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    importMutation.mutate()
  }

  return (
    <section className="profile-card" aria-labelledby="import-title">
      <h2 id="import-title">Add an occasion from a link</h2>
      <p className="muted">
        Paste a link to an event's page. Its name, times, description and tags are read for you and the occasion is
        created. Only you and your connections will see it, and you'll be going to it.
      </p>
      <form ref={formRef} className="form" onSubmit={onSubmit} noValidate>
        <FormAlert messages={errors.non_field_errors} />
        <Field
          id="url"
          label="Event link"
          type="url"
          inputMode="url"
          placeholder="https://"
          required
          value={url}
          readOnly={submitting}
          onChange={(event) => {
            setUrl(event.target.value)
            // Editing the link hides the last error
            if (importMutation.isError) importMutation.reset()
          }}
          errors={errors.url}
        />
        <div className="form-actions">
          {importMutation.isPending && (
            <span className="import-reading">
              <Spinner label="Reading the event's page" />
              <span aria-hidden="true">Reading the page…</span>
            </span>
          )}
          <button className="btn btn-confirm" type="submit" disabled={submitting || !url.trim()}>
            {submitting ? 'Adding…' : 'Add occasion'}
          </button>
        </div>
      </form>
    </section>
  )
}
