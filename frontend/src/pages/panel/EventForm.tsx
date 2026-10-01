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
  type PanelEvent,
} from './shared'

export default function EventForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const formRef = useRef<HTMLFormElement>(null)
  const [event, setEvent] = useState<PanelEvent | null>(null)
  const [name, setName] = useState('')
  // Local wall-clock values for the datetime-local inputs
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    apiGet<PanelEvent>(`/api/panel/events/${id}/`)
      .then((e) => {
        setEvent(e)
        setName(e.name)
        setStart(toLocalInput(e.start_datetime))
        setEnd(e.end_datetime ? toLocalInput(e.end_datetime) : '')
        setAttendees(e.attendees)
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
      if (id) await apiPatch(`/api/panel/events/${id}/`, body)
      else await apiPost('/api/panel/events/', body)
      navigate('/admin/events')
    } catch (err) {
      setErrors(errorsFrom(err))
      setSaving(false)
    }
  }

  if (id && !event && !errors.non_field_errors) return <p className="muted">Loading…</p>

  return (
    <>
      <div className="panel-head">
        <div>
          <Link className="back-link" to="/admin/events">
            ← Events
          </Link>
          <h1>{id ? 'Edit event' : 'New event'}</h1>
        </div>
        {event && <span className="muted">Last updated {formatDate(event.updated_at)}</span>}
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
          <Link className="btn" to="/admin/events">
            Cancel
          </Link>
          <button className="btn btn-confirm" type="submit" disabled={saving}>
            {saving ? 'Saving…' : id ? 'Save changes' : 'Create event'}
          </button>
        </div>
      </form>
    </>
  )
}
