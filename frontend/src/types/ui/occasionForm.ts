// Props and UI state types for pages/panel/OccasionForm.tsx

import type { FieldErrors } from '../../api'
import type { PanelOccasion } from '../api/admin'

export type OccasionEditorProps = {
  // Set when editing; the form for a new occasion has none
  occasionId: string | undefined
  occasion: PanelOccasion | null
  loadErrors: FieldErrors
}
