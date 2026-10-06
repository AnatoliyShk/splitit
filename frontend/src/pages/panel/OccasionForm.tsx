import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload, errorsFrom, useFieldErrors, type FieldErrors } from '../../api'
import { AttendeePicker } from '../../components/AttendeePicker'
import { Field, FormAlert } from '../../components/Field'
import { TagPicker } from '../../components/TagPicker'
import { queryKeys } from '../../queryClient'
import type { Tag } from '../../types/tags'
import { ImageSlots } from './ImageSlots'
import {
  formatDate,
  fromLocalInput,
  IMAGE_SLOTS,
  imageProblem,
  timeZone,
  toLocalInput,
  type Attendee,
  type ImageChanges,
  type OccasionImage,
  type PanelOccasion,
  type SavedImages,
} from './shared'

function savedFrom(images: OccasionImage[]): SavedImages {
  return Object.fromEntries(images.map((image) => [image.order, image.url]))
}

function without<T>(record: Record<number, T>, key: number) {
  const copy = { ...record }
  delete copy[key]
  return copy
}

// The occasion was saved but at least one image wasn't; each failed slot shows its own error
class ImagesNotSaved extends Error {}

const IMAGES_NOT_SAVED: FieldErrors = {
  non_field_errors: ['The occasion was saved, but some images weren’t. Fix them and save again.'],
}

export default function OccasionForm() {
  const { id: occasionId } = useParams()
  const occasionQuery = useQuery({
    queryKey: queryKeys.panel.occasion(occasionId ?? ''),
    queryFn: () => apiGet<PanelOccasion>(`/api/panel/occasions/${occasionId}/`),
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

type OccasionEditorProps = {
  // Set when editing; the form for a new occasion has none
  occasionId: string | undefined
  occasion: PanelOccasion | null
  loadErrors: FieldErrors
}

function OccasionEditor({ occasionId, occasion, loadErrors }: OccasionEditorProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const [name, setName] = useState(occasion?.name ?? '')
  // Local wall-clock values for the datetime-local inputs
  const [start, setStart] = useState(occasion ? toLocalInput(occasion.start_datetime) : '')
  const [end, setEnd] = useState(occasion?.end_datetime ? toLocalInput(occasion.end_datetime) : '')
  const [attendees, setAttendees] = useState<Attendee[]>(occasion?.attendees ?? [])
  const [tags, setTags] = useState<Tag[]>(occasion?.tags ?? [])
  const [savedImages, setSavedImages] = useState<SavedImages>(occasion ? savedFrom(occasion.images) : {})
  const [imageChanges, setImageChanges] = useState<ImageChanges>({})
  const [imageErrors, setImageErrors] = useState<Record<number, string[]>>({})
  // A new occasion that was created but whose images failed: saving again updates it instead of adding another
  const [createdId, setCreatedId] = useState<number | null>(null)

  function pickImage(order: number, file: File) {
    const problem = imageProblem(file)
    setImageErrors((slotErrors) => (problem ? { ...slotErrors, [order]: [problem] } : without(slotErrors, order)))
    if (!problem) setImageChanges((changes) => ({ ...changes, [order]: file }))
  }

  function removeImage(order: number) {
    setImageErrors((slotErrors) => without(slotErrors, order))
    // Nothing on the server to delete: just drop the picked file
    setImageChanges((changes) => (order in savedImages ? { ...changes, [order]: null } : without(changes, order)))
  }

  function undoImage(order: number) {
    setImageErrors((slotErrors) => without(slotErrors, order))
    setImageChanges((changes) => without(changes, order))
  }

  // Applies the image edits one slot at a time; each success leaves the pending list, so a retry redoes only the rest
  async function saveImages(savedOccasionId: number) {
    const imagesUrl = `/api/panel/occasions/${savedOccasionId}/images/`
    for (const order of IMAGE_SLOTS) {
      if (!(order in imageChanges)) continue
      const file = imageChanges[order]
      try {
        if (file) {
          const formData = new FormData()
          formData.append('order', String(order))
          formData.append('image', file)
          const updatedOccasion = await apiUpload<PanelOccasion>(imagesUrl, formData)
          setSavedImages(savedFrom(updatedOccasion.images))
        } else {
          await apiDelete(`${imagesUrl}${order}/`)
          setSavedImages((images) => without(images, order))
        }
        setImageChanges((changes) => without(changes, order))
      } catch (error) {
        setImageErrors((slotErrors) => ({ ...slotErrors, [order]: Object.values(errorsFrom(error)).flat() }))
        throw new ImagesNotSaved()
      }
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      setImageErrors({})
      const body = {
        name,
        start_datetime: fromLocalInput(start),
        end_datetime: fromLocalInput(end),
        users: attendees.map((attendee) => attendee.id),
        tag_ids: tags.map((tag) => tag.id),
      }
      const existingId = occasionId ?? createdId
      let savedOccasion: PanelOccasion
      if (existingId) {
        savedOccasion = await apiPatch<PanelOccasion>(`/api/panel/occasions/${existingId}/`, body)
      } else {
        savedOccasion = await apiPost<PanelOccasion>('/api/panel/occasions/', body)
        setCreatedId(savedOccasion.id)
      }
      await saveImages(savedOccasion.id)
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
