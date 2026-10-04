import { useEffect, useRef, useState, type SubmitEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { apiGet, apiPatch, apiPost, errorsFrom, type FieldErrors } from '../../api'
import { AttendeePicker } from '../../components/AttendeePicker'
import { Field, FormAlert } from '../../components/Field'
import {
  formatDate,
  fromLocalInput,
  timeZone,
  toLocalInput,
  type Attendee,
  type PanelOccasion,
} from './shared'

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
      })
      .catch((err) => setErrors(errorsFrom(err)))
  }, [id])

  // After a failed save, move focus to the first invalid field
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
  }, [errors])

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    const body = {
      name,
      start_datetime: fromLocalInput(start),
      end_datetime: fromLocalInput(end),
      users: attendees.map((a) => a.id),
    }
    try {
      if (id) await apiPatch(`/api/panel/occasions/${id}/`, body)
      else await apiPost('/api/panel/occasions/', body)
      navigate('/admin/occasions')
    } catch (err) {
      setErrors(errorsFrom(err))
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
        <div className="form-actions">
          <Link className="btn" to="/admin/occasions">
            Cancel
          </Link>
          <button className="btn btn-confirm" type="submit" disabled={saving}>
            {saving ? 'Saving…' : id ? 'Save changes' : 'Create occasion'}
          </button>
        </div>
      </form>
    </>
  )
}
