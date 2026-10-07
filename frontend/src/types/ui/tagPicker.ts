// Props and UI state types for components/TagPicker.tsx

import type { Tag } from '../api/tags'

export type TagPickerProps = {
  value: Tag[]
  onChange: (tags: Tag[]) => void
  errors?: string[]
}
