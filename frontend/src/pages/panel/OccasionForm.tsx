import { useEffect, useRef, useState, type SubmitEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload, errorsFrom, type FieldErrors } from '../../api'
import { AttendeePicker } from '../../components/AttendeePicker'
import { Field, FormAlert } from '../../components/Field'
import { TagPicker } from '../../components/TagPicker'
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
  return Object.fromEntries(images.map((i) => [i.order, i.url]))
}

function without<T>(record: Record<number, T>, key: number) {
  const copy = { ...record }
  delete copy[key]
  return copy
}

export default function OccasionForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const formRef = useRef<HTMLFormElement>(null)
  const [occasion, setOccasion] = useState<PanelOccasion | null>(null)
  const [name, setName] = useState('')
  // Local wall-clock values for the datetime-local inputs
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [savedImages, setSavedImages] = useState<SavedImages>({})
  const [imageChanges, setImageChanges] = useState<ImageChanges>({})
  const [imageErrors, setImageErrors] = useState<Record<number, string[]>>({})
  // A new occasion that was created but whose images failed: saving again updates it instead of adding another
  const [createdId, setCreatedId] = useState<number | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    apiGet<PanelOccasion>(`/api/panel/occasions/${id}/`)
      .then((o) => {
        setOccasion(o)
        setName(o.name)
        setStart(toLocalInput(o.start_datetime))
        setEnd(o.end_datetime ? toLocalInput(o.end_datetime) : '')
        setAttendees(o.attendees)
        setTags(o.tags)
        setSavedImages(savedFrom(o.images))
      })
      .catch((err) => setErrors(errorsFrom(err)))
  }, [id])

  // After a failed save, move focus to the first invalid field
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
  }, [errors])

  function pickImage(order: number, file: File) {
    const problem = imageProblem(file)
    setImageErrors((errs) => (problem ? { ...errs, [order]: [problem] } : without(errs, order)))
    if (!problem) setImageChanges((c) => ({ ...c, [order]: file }))
  }

  function removeImage(order: number) {
    setImageErrors((errs) => without(errs, order))
    // Nothing on the server to delete: just drop the picked file
    setImageChanges((c) => (order in savedImages ? { ...c, [order]: null } : without(c, order)))
  }

  function undoImage(order: number) {
    setImageErrors((errs) => without(errs, order))
    setImageChanges((c) => without(c, order))
  }

  // Applies the image edits one slot at a time; each success leaves the pending list, so a retry redoes only the rest
  async function saveImages(occasionId: number) {
    const base = `/api/panel/occasions/${occasionId}/images/`
    for (const order of IMAGE_SLOTS) {
      if (!(order in imageChanges)) continue
      const file = imageChanges[order]
      try {
        if (file) {
          const form = new FormData()
          form.append('order', String(order))
          form.append('image', file)
          const updated = await apiUpload<PanelOccasion>(base, form)
          setSavedImages(savedFrom(updated.images))
        } else {
          await apiDelete(`${base}${order}/`)
          setSavedImages((s) => without(s, order))
        }
        setImageChanges((c) => without(c, order))
      } catch (err) {
        setImageErrors((errs) => ({ ...errs, [order]: Object.values(errorsFrom(err)).flat() }))
        throw err
      }
    }
  }

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    setImageErrors({})
    const body = {
      name,
      start_datetime: fromLocalInput(start),
      end_datetime: fromLocalInput(end),
      users: attendees.map((a) => a.id),
      tag_ids: tags.map((t) => t.id),
    }
    const existingId = id ?? createdId
    let occasionId: number
    try {
      if (existingId) {
        occasionId = (await apiPatch<PanelOccasion>(`/api/panel/occasions/${existingId}/`, body)).id
      } else {
        occasionId = (await apiPost<PanelOccasion>('/api/panel/occasions/', body)).id
        setCreatedId(occasionId)
      }
    } catch (err) {
      setErrors(errorsFrom(err))
      setSaving(false)
      return
    }
    try {
      await saveImages(occasionId)
      navigate('/admin/occasions')
    } catch {
      setErrors({ non_field_errors: ['The occasion was saved, but some images weren’t. Fix them and save again.'] })
      setSaving(false)
    }
  }

  if (id && !occasion && !errors.non_field_errors) return <p className="muted">Loading…</p>

  return (
    <>
      <div className="panel-head">
        <div>
          <Link className="back-link" to="/admin/occasions">
            ← Occasions
          </Link>
          <h1>{id ? 'Edit occasion' : 'New occasion'}</h1>
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
          onChange={(e) => setName(e.target.value)}
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
            onChange={(e) => setStart(e.target.value)}
            errors={errors.start_datetime}
          />
          <Field
            id="end_datetime"
            label="Ends"
            type="datetime-local"
            min={start || undefined}
            hint="Optional. Leave empty if it has no fixed end."
            value={end}
            onChange={(e) => setEnd(e.target.value)}
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
            {saving ? 'Saving…' : id || createdId ? 'Save changes' : 'Create occasion'}
          </button>
        </div>
      </form>
    </>
  )
}
