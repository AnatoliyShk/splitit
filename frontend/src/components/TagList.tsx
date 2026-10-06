import type { TagName } from '../types/tags'

// A status shown before the tags, e.g. "Cancelled"; `off` draws it dashed
export type StatusTag = { label: string; off?: boolean }

type TagListProps = {
  tagNames: TagName[]
  statusTags?: StatusTag[]
  className?: string
}

// An occasion's tag names as a list of pills, after any status tags. Renders nothing when both are empty
export function TagList({ tagNames, statusTags = [], className }: TagListProps) {
  if (tagNames.length === 0 && statusTags.length === 0) return null
  return (
    <ul
      className={className ? `tags ${className}` : 'tags'}
      aria-label={statusTags.length > 0 ? 'Status and tags' : 'Tags'}
    >
      {statusTags.map((statusTag) => (
        <li className={statusTag.off ? 'tag tag-off' : 'tag'} key={statusTag.label}>
          {statusTag.label}
        </li>
      ))}
      {tagNames.map((tagName) => (
        <li className="tag" key={tagName}>
          {tagName}
        </li>
      ))}
    </ul>
  )
}
