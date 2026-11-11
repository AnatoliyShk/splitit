// Props and UI state types for pages/panel/OccasionForm.tsx, TemplateForm.tsx and PanelItemForm.tsx

import type { ReactNode } from 'react'
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

// Props for pages/panel/PanelItemForm.tsx: the parts an occasion and a template share
export type PanelItemFormProps = {
  noun: 'occasion' | 'template'
  // The list page the form goes back to, and its name on the back link
  listPath: string
  listLabel: string
  // The admin API collection, ending in a slash: POST creates, `<id>/` updates, `<id>/images/` takes images
  apiPath: string
  itemId: string | undefined
  item: Pick<PanelTemplate, 'name' | 'description' | 'tags' | 'images' | 'updated_at'> | null
  loadErrors: FieldErrors
  descriptionHint: string
  // The page's own fields, sent along with name, description and tag_ids
  body: Record<string, unknown>
  // Refreshes cached lists after a save, before going back to the list
  onSaved: () => Promise<unknown>
  // The page's own fields, shown between the description and the tags
  children: (errors: FieldErrors) => ReactNode
}
