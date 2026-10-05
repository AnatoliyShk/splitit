import { useEffect, useState } from 'react'
import { apiGet, type Page } from '../api'
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
  const query = useDebounced(search.trim())
  const [results, setResults] = useState<PanelTag[]>([])

  useEffect(() => {
    // Results only render while there's a query, so an empty one needs no request or reset
    if (!query) return
    let stale = false
    apiGet<Page<PanelTag>>(`/api/panel/tags/?${new URLSearchParams({ search: query })}`)
      .then((d) => !stale && setResults(d.results))
      .catch(() => !stale && setResults([]))
    return () => {
      stale = true
    }
  }, [query])

  const selectedIds = new Set(value.map((t) => t.id))
  const options = results.filter((r) => !selectedIds.has(r.id)).slice(0, MAX_RESULTS)
  const hasErrors = Boolean(errors?.length)

  return (
    <fieldset className="picker">
      <legend>Tags</legend>

      {value.length > 0 ? (
        <ul className="chips" aria-label="Selected tags">
          {value.map((t) => (
            <li className="chip-person" key={t.id}>
              <span>{t.name}</span>
              <button
                type="button"
                className="chip-remove"
                aria-label={`Remove tag ${t.name}`}
                onClick={() => onChange(value.filter((v) => v.id !== t.id))}
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
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {search.trim() && query && (
        <ul className="picker-results" aria-label="Matching tags" aria-live="polite">
          {options.length ? (
            options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className="picker-option"
                  onClick={() => {
                    onChange([...value, { id: o.id, name: o.name }])
                    setSearch('')
                  }}
                >
                  <span className="picker-add" aria-hidden="true">
                    +
                  </span>
                  <span>
                    <strong>{o.name}</strong>
                    <small>{plural(o.occasions_count, 'occasion')}</small>
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="field-hint">No other tags match “{query}”.</li>
          )}
        </ul>
      )}

      {hasErrors && (
        <ul className="field-errors" id="tag-error">
          {errors!.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
