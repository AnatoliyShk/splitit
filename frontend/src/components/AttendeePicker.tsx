import { useEffect, useState } from 'react'
import { apiGet, type Page } from '../api'
import { useDebounced, type Attendee } from '../pages/panel/shared'

type AttendeePickerProps = {
  value: Attendee[]
  onChange: (attendees: Attendee[]) => void
  errors?: string[]
}

const MAX_RESULTS = 6

// Search users by name or email and collect them as removable chips
export function AttendeePicker({ value, onChange, errors }: AttendeePickerProps) {
  const [search, setSearch] = useState('')
  const query = useDebounced(search.trim())
  const [results, setResults] = useState<Attendee[]>([])

  useEffect(() => {
    // Results only render while there's a query, so an empty one needs no request or reset
    if (!query) return
    let stale = false
    apiGet<Page<Attendee>>(`/api/panel/users/?${new URLSearchParams({ search: query })}`)
      .then((d) => !stale && setResults(d.results))
      .catch(() => !stale && setResults([]))
    return () => {
      stale = true
    }
  }, [query])

  const selectedIds = new Set(value.map((a) => a.id))
  const options = results.filter((r) => !selectedIds.has(r.id)).slice(0, MAX_RESULTS)
  const hasErrors = Boolean(errors?.length)

  return (
    <fieldset className="picker">
      <legend>People going</legend>

      {value.length > 0 ? (
        <ul className="chips" aria-label="Selected people">
          {value.map((a) => (
            <li className="chip-person" key={a.id}>
              <span>{a.name || a.email}</span>
              <button
                type="button"
                className="chip-remove"
                aria-label={`Remove ${a.name || a.email}`}
                onClick={() => onChange(value.filter((v) => v.id !== a.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field-hint">Nobody yet. Search below to add people.</p>
      )}

      <div className="field">
        <label htmlFor="attendee-search">Add people</label>
        <input
          id="attendee-search"
          className="input"
          type="search"
          placeholder="Name or email"
          autoComplete="off"
          value={search}
          aria-invalid={hasErrors || undefined}
          aria-describedby={hasErrors ? 'attendee-error' : undefined}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {search.trim() && query && (
        <ul className="picker-results" aria-label="Search results" aria-live="polite">
          {options.length ? (
            options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className="picker-option"
                  onClick={() => {
                    onChange([...value, o])
                    setSearch('')
                  }}
                >
                  <span className="picker-add" aria-hidden="true">
                    +
                  </span>
                  <span>
                    <strong>{o.name || o.email}</strong>
                    <small>{o.email}</small>
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="field-hint">No one else matches “{query}”.</li>
          )}
        </ul>
      )}

      {hasErrors && (
        <ul className="field-errors" id="attendee-error">
          {errors!.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
