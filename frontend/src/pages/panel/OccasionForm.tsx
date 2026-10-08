import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { apiGet, apiPatch, apiPost, errorsFrom, useFieldErrors, type FieldErrors } from '../../api'
import { AttendeePicker } from '../../components/AttendeePicker'
import { Field, FormAlert, TextAreaField } from '../../components/Field'
import { TagPicker } from '../../components/TagPicker'
import { queryKeys } from '../../queryClient'
import type { Attendee, PanelOccasion } from '../../types/api/admin'
import type { Tag } from '../../types/api/tags'
import type { OccasionEditorProps } from '../../types/ui/occasionForm'
import { ImageSlots } from './ImageSlots'
import { formatDate, fromLocalInput, timeZone, toLocalInput } from './shared'
import { ImagesNotSaved, useImageEdits } from './useImageEdits'

const IMAGES_NOT_SAVED: FieldErrors = {
  non_field_errors: ['The occasion was saved, but some images weren’t. Fix them and save again.'],
}

export default function OccasionForm() {
  const { id: occasionId } = useParams()
  const occasionQuery = useQuery({
    queryKey: queryKeys.panel.occasion(occasionId ?? ''),
    queryFn: () => apiGet<PanelOccasion>(`/api/admin/occasions/${occasionId}/`),
    enabled: Boolean(occasionId),
    // Always load the latest copy: the form starts from it and never picks up later changes
    gcTime: 0,
  })
  const loadErrors = useFieldErrors(occasionQuery.error)

  if (occasionId && !occasionQuery.data) {
    if (!loadErrors.non_field_errors) return <p className="muted">Loading…</p>
    return <OccasionEditor occasionId={occasionId} occasion={null} loadErrors={loadErrors} />
  }
  return <OccasionEditor occasionId={occasionId} occasion={occasionQuery.data ?? null} loadErrors={loadErrors} />
}

function OccasionEditor({ occasionId, occasion, loadErrors }: OccasionEditorProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const [name, setName] = useState(occasion?.name ?? '')
  const [description, setDescription] = useState(occasion?.description ?? '')
  // Local wall-clock values for the datetime-local inputs
  const [start, setStart] = useState(occasion ? toLocalInput(occasion.start_datetime) : '')
  const [end, setEnd] = useState(occasion?.end_datetime ? toLocalInput(occasion.end_datetime) : '')
  const [attendees, setAttendees] = useState<Attendee[]>(occasion?.attendees ?? [])
  const [tags, setTags] = useState<Tag[]>(occasion?.tags ?? [])
  const { savedImages, imageChanges, imageErrors, clearImageErrors, pickImage, removeImage, undoImage, saveImages } =
    useImageEdits(occasion?.images ?? [])
  // A new occasion that was created but whose images failed: saving again updates it instead of adding another
  const [createdId, setCreatedId] = useState<number | null>(null)

  const saveMutation = useMutation({
    mutationFn: async () => {
      clearImageErrors()
      const body = {
        name,
        description,
        start_datetime: fromLocalInput(start),
        end_datetime: fromLocalInput(end),
        users: attendees.map((attendee) => attendee.id),
        tag_ids: tags.map((tag) => tag.id),
      }
      const existingId = occasionId ?? createdId
      let savedOccasion: PanelOccasion
      if (existingId) {
        savedOccasion = await apiPatch<PanelOccasion>(`/api/admin/occasions/${existingId}/`, body)
      } else {
        savedOccasion = await apiPost<PanelOccasion>('/api/admin/occasions/', body)
        setCreatedId(savedOccasion.id)
      }
      await saveImages(`/api/admin/occasions/${savedOccasion.id}/images/`)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.panel.all })
      navigate('/admin/occasions')
    },
  })
  const saveError = saveMutation.error
  const saveErrors = useMemo(
    () => (saveError instanceof ImagesNotSaved ? IMAGES_NOT_SAVED : saveError ? errorsFrom(saveError) : null),
    [saveError],
  )
  const errors = saveErrors ?? loadErrors

  // After a failed save, move focus to the first invalid field
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
  }, [errors])

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    saveMutation.mutate()
  }

  const saving = saveMutation.isPending || saveMutation.isSuccess

  return (
    <>
      <div className="panel-head">
        <div>
          <Link className="back-link" to="/admin/occasions">
            ← Occasions
          </Link>
          <h1>{occasionId ? 'Edit occasion' : 'New occasion'}</h1>
        </div>
        {occasion && <span className="muted">Last updated {formatDate(occasion.updated_at)}</span>}
      </div>

      <form ref={formRef} className="form panel-form" onSubmit={onSubmit} noValidate>
        <FormAlert messages={errors.non_field_errors} />
        <Field
          id="name"
          label="Name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          errors={errors.name}
        />
        <TextAreaField
          id="description"
          label="Description (optional)"
          hint="Cards show the first 100 characters; the rest appears under Show details and on the occasion's page."
          maxLength={2000}
          rows={5}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          errors={errors.description}
        />
        <div className="field-row">
          <Field
            id="start_datetime"
            label="Starts"
            type="datetime-local"
            required
            hint={`Your time zone: ${timeZone}`}
            value={start}
            onChange={(event) => setStart(event.target.value)}
            errors={errors.start_datetime}
          />
          <Field
            id="end_datetime"
            label="Ends"
            type="datetime-local"
            min={start || undefined}
            hint="Optional. Leave empty if it has no fixed end."
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            errors={errors.end_datetime}
          />
        </div>
        <AttendeePicker value={attendees} onChange={setAttendees} errors={errors.users} />
        <TagPicker value={tags} onChange={setTags} errors={errors.tag_ids} />
        <ImageSlots
          saved={savedImages}
          changes={imageChanges}
          errors={imageErrors}
          onPick={pickImage}
          onRemove={removeImage}
          onUndo={undoImage}
        />
        <div className="form-actions">
          <Link className="btn" to="/admin/occasions">
            Cancel
          </Link>
          <button className="btn btn-confirm" type="submit" disabled={saving}>
            {saving ? 'Saving…' : occasionId || createdId ? 'Save changes' : 'Create occasion'}
          </button>
        </div>
      </form>
    </>
  )
}
