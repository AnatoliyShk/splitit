// Props and UI state types for components/TagList.tsx

import type { TagName } from '../api/tags'

// A status shown before the tags, e.g. "Cancelled"; `off` draws it dashed
export type StatusTag = { label: string; off?: boolean }

export type TagListProps = {
  tagNames: TagName[]
  statusTags?: StatusTag[]
  className?: string
}
