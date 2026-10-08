import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type SubmitEvent } from 'react'
import { useNavigate } from 'react-router'
import { apiGet, apiPost, useFieldErrors } from '../api'
import { formatDuration, fromLocalInput, timeZone, toLocalInput } from '../pages/panel/shared'
import { queryKeys } from '../queryClient'
import type { OccasionDetail, OccasionTemplate } from '../types/api/occasions'
import type { OccasionTemplatesProps } from '../types/ui/occasionTemplates'
import { Field, FormAlert } from './Field'
import { Modal } from './Modal'
import { TagList } from './TagList'

// The current moment as a datetime-local value
const nowAsLocalInput = () => toLocalInput(new Date().toISOString())

/**
 * The templates staff made, each with a Create button. Create asks when the occasion starts, then makes it from
 * the template (the user goes to it, and only their connections see it) and opens its page.
 */
export function OccasionTemplates({ user }: OccasionTemplatesProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const templatesQuery = useQuery({
    queryKey: queryKeys.occasionTemplates,
    queryFn: () => apiGet<OccasionTemplate[]>('/api/occasion-templates/'),
  })
  const templates = templatesQuery.data
  const listErrors = useFieldErrors(templatesQuery.error)

  // The template being turned into an occasion, and the start picked for it (local wall time)
  const [chosenTemplate, setChosenTemplate] = useState<OccasionTemplate | null>(null)
  const [start, setStart] = useState('')
  // The earliest start the input offers: the moment the dialog was opened
  const [earliestStart, setEarliestStart] = useState('')

  const createMutation = useMutation({
    mutationFn: (template: OccasionTemplate) =>
      apiPost<OccasionDetail>(`/api/occasion-templates/${template.id}/occasions/`, {
        start_datetime: fromLocalInput(start),
      }),
    onSuccess: (createdOccasion) => {
      queryClient.setQueryData(queryKeys.occasion(String(createdOccasion.id)), createdOccasion)
      // The user now goes to it, which pauses Explore and adds it to their profile
      queryClient.invalidateQueries({ queryKey: queryKeys.explore })
      queryClient.invalidateQueries({ queryKey: queryKeys.userOccasions(user.uuid) })
      navigate(`/occasions/${createdOccasion.id}`)
    },
  })
  const errors = useFieldErrors(createMutation.error)
  // Stays disabled after success, while the page changes
  const creating = createMutation.isPending || createMutation.isSuccess

  function startCreating(template: OccasionTemplate) {
    createMutation.reset()
    setStart('')
    setEarliestStart(nowAsLocalInput())
    setChosenTemplate(template)
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (chosenTemplate) createMutation.mutate(chosenTemplate)
  }

  return (
    <section className="profile-card" aria-labelledby="templates-title">
      <h2 id="templates-title">Occasion templates</h2>
      <FormAlert messages={listErrors.non_field_errors} />
      {!templates && !listErrors.non_field_errors && <p className="muted">Loading…</p>}
      {templates && templates.length === 0 && <p className="muted">No templates yet.</p>}
      {templates && templates.length > 0 && (
        <ul className="occasion-list">
          {templates.map((template) => (
            <li key={template.id}>
              {template.main_image && <img className="occasion-day occasion-thumb" src={template.main_image} alt="" />}
              <span className="occasion-info">
                <strong>{template.name}</strong>
                <small>
                  {template.duration_minutes === null ? 'No fixed end' : formatDuration(template.duration_minutes)}
                </small>
                <TagList className="occasion-tags" tagNames={template.tags} />
              </span>
              <button
                className="btn btn-sm btn-primary"
                type="button"
                aria-label={`Create an occasion from ${template.name}`}
                onClick={() => startCreating(template)}
              >
                Create
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={chosenTemplate !== null}
        onClose={() => setChosenTemplate(null)}
        title={chosenTemplate ? `Create “${chosenTemplate.name}”` : 'Create an occasion'}
      >
        <form className="form" onSubmit={onSubmit} noValidate>
          <p className="muted">
            Only you and your connections will see it, and you'll be going to it.
          </p>
          <FormAlert messages={errors.non_field_errors} />
          <Field
            id="template-start"
            label="Starts"
            type="datetime-local"
            required
            autoFocus
            min={earliestStart}
            hint={`Your time zone: ${timeZone}`}
            value={start}
            readOnly={creating}
            onChange={(event) => {
              setStart(event.target.value)
              // Editing the start hides the last error
              if (createMutation.isError) createMutation.reset()
            }}
            errors={errors.start_datetime}
          />
          <div className="form-actions">
            <button className="btn" type="button" onClick={() => setChosenTemplate(null)}>
              Cancel
            </button>
            <button className="btn btn-confirm" type="submit" disabled={creating || !start}>
              {creating ? 'Creating…' : 'Create occasion'}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  )
}
