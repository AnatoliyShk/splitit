import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router'
import { apiGet, useFieldErrors } from '../../api'
import { AttendeePicker } from '../../components/AttendeePicker'
import { Field } from '../../components/Field'
import { queryKeys } from '../../queryClient'
import type { Attendee, PanelOccasion } from '../../types/api/admin'
import type { OccasionEditorProps } from '../../types/ui/occasionForm'
import { PanelItemForm } from './PanelItemForm'
import { fromLocalInput, timeZone, toLocalInput } from './shared'

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
  const queryClient = useQueryClient()
  // Local wall-clock values for the datetime-local inputs
  const [start, setStart] = useState(occasion ? toLocalInput(occasion.start_datetime) : '')
  const [end, setEnd] = useState(occasion?.end_datetime ? toLocalInput(occasion.end_datetime) : '')
  const [attendees, setAttendees] = useState<Attendee[]>(occasion?.attendees ?? [])

  return (
    <PanelItemForm
      noun="occasion"
      listLabel="Occasions"
      listPath="/admin/occasions"
      apiPath="/api/admin/occasions/"
      itemId={occasionId}
      item={occasion}
      loadErrors={loadErrors}
      descriptionHint="Cards show the first 100 characters; the rest appears under Show details and on the occasion's page."
      body={{
        start_datetime: fromLocalInput(start),
        end_datetime: fromLocalInput(end),
        users: attendees.map((attendee) => attendee.id),
      }}
      onSaved={() => queryClient.invalidateQueries({ queryKey: queryKeys.panel.all })}
    >
      {(errors) => (
        <>
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
        </>
      )}
    </PanelItemForm>
  )
}
