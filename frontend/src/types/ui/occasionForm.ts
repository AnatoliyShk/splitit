// Props and UI state types for pages/panel/OccasionForm.tsx and TemplateForm.tsx

import type { FieldErrors } from '../../api'
import type { PanelOccasion, PanelTemplate } from '../api/admin'

export type OccasionEditorProps = {
  // Set when editing; the form for a new occasion has none
  occasionId: string | undefined
  occasion: PanelOccasion | null
  loadErrors: FieldErrors
}

// Props for pages/panel/TemplateForm.tsx
export type TemplateEditorProps = {
  // Set when editing; the form for a new template has none
  templateId: string | undefined
  template: PanelTemplate | null
  loadErrors: FieldErrors
}
