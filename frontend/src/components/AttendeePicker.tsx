import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet, type Page } from '../api'
import { listQueryString, queryKeys } from '../queryClient'
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
  const searchQuery = useDebounced(search.trim())
  // Page 1 of the panel list: shares its cache with the Users page
  const searchParams = { page: 1, search: searchQuery }
  const searchResultsQuery = useQuery({
    queryKey: queryKeys.panel.users(searchParams),
    queryFn: () => apiGet<Page<Attendee>>(`/api/admin/users/?${listQueryString(searchParams)}`),
    // Results only render while there's a query, so an empty one needs no request
    enabled: Boolean(searchQuery),
    // Keep the last matches on screen while the next search loads
    placeholderData: keepPreviousData,
  })
  const searchResults = searchResultsQuery.data?.results ?? []

  const selectedAttendeeIds = new Set(value.map((attendee) => attendee.id))
  const attendeeOptions = searchResults
    .filter((attendee) => !selectedAttendeeIds.has(attendee.id))
    .slice(0, MAX_RESULTS)
  const hasErrors = Boolean(errors?.length)

  return (
    <fieldset className="picker">
      <legend>People going</legend>

      {value.length > 0 ? (
        <ul className="chips" aria-label="Selected people">
          {value.map((attendee) => (
            <li className="chip-person" key={attendee.id}>
              <span>{attendee.name || attendee.email}</span>
              <button
                type="button"
                className="chip-remove"
                aria-label={`Remove ${attendee.name || attendee.email}`}
                onClick={() => onChange(value.filter((selectedAttendee) => selectedAttendee.id !== attendee.id))}
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
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {search.trim() && searchQuery && (
        <ul className="picker-results" aria-label="Search results" aria-live="polite">
          {attendeeOptions.length ? (
            attendeeOptions.map((attendee) => (
              <li key={attendee.id}>
                <button
                  type="button"
                  className="picker-option"
                  onClick={() => {
                    onChange([...value, attendee])
                    setSearch('')
                  }}
                >
                  <span className="picker-add" aria-hidden="true">
                    +
                  </span>
                  <span>
                    <strong>{attendee.name || attendee.email}</strong>
                    <small>{attendee.email}</small>
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="field-hint">No one else matches “{searchQuery}”.</li>
          )}
        </ul>
      )}

      {hasErrors && (
        <ul className="field-errors" id="attendee-error">
          {errors!.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
