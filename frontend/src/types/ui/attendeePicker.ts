// Props and UI state types for components/AttendeePicker.tsx

import type { Attendee } from '../api/admin'

export type AttendeePickerProps = {
  value: Attendee[]
  onChange: (attendees: Attendee[]) => void
  errors?: string[]
}
