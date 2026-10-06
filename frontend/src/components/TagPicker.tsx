import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet, type Page } from '../api'
import { listQueryString, queryKeys } from '../queryClient'
import { plural, useDebounced, type PanelTag } from '../pages/panel/shared'
import type { Tag } from '../types/tags'

type TagPickerProps = {
  value: Tag[]
  onChange: (tags: Tag[]) => void
  errors?: string[]
}

const MAX_RESULTS = 6

// Search existing tags by name and collect them as removable chips
export function TagPicker({ value, onChange, errors }: TagPickerProps) {
  const [search, setSearch] = useState('')
  const searchQuery = useDebounced(search.trim())
  // Page 1 of the panel list: shares its cache with the Tags page
  const searchParams = { page: 1, search: searchQuery }
  const searchResultsQuery = useQuery({
    queryKey: queryKeys.panel.tags(searchParams),
    queryFn: () => apiGet<Page<PanelTag>>(`/api/panel/tags/?${listQueryString(searchParams)}`),
    // Results only render while there's a query, so an empty one needs no request
    enabled: Boolean(searchQuery),
    // Keep the last matches on screen while the next search loads
    placeholderData: keepPreviousData,
  })
  const searchResults = searchResultsQuery.data?.results ?? []

  const selectedTagIds = new Set(value.map((tag) => tag.id))
  const tagOptions = searchResults.filter((tag) => !selectedTagIds.has(tag.id)).slice(0, MAX_RESULTS)
  const hasErrors = Boolean(errors?.length)

  return (
    <fieldset className="picker">
      <legend>Tags</legend>

      {value.length > 0 ? (
        <ul className="chips" aria-label="Selected tags">
          {value.map((tag) => (
            <li className="chip-person" key={tag.id}>
              <span>{tag.name}</span>
              <button
                type="button"
                className="chip-remove"
                aria-label={`Remove tag ${tag.name}`}
                onClick={() => onChange(value.filter((selectedTag) => selectedTag.id !== tag.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field-hint">No tags yet. Search below to add some.</p>
      )}

      <div className="field">
        <label htmlFor="tag-search">Add tags</label>
        <input
          id="tag-search"
          className="input"
          type="search"
          placeholder="Tag name"
          autoComplete="off"
          value={search}
          aria-invalid={hasErrors || undefined}
          aria-describedby={hasErrors ? 'tag-error' : undefined}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {search.trim() && searchQuery && (
        <ul className="picker-results" aria-label="Matching tags" aria-live="polite">
          {tagOptions.length ? (
            tagOptions.map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  className="picker-option"
                  onClick={() => {
                    onChange([...value, { id: tag.id, name: tag.name }])
                    setSearch('')
                  }}
                >
                  <span className="picker-add" aria-hidden="true">
                    +
                  </span>
                  <span>
                    <strong>{tag.name}</strong>
                    <small>{plural(tag.occasions_count, 'occasion')}</small>
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="field-hint">No other tags match “{searchQuery}”.</li>
          )}
        </ul>
      )}

      {hasErrors && (
        <ul className="field-errors" id="tag-error">
          {errors!.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
