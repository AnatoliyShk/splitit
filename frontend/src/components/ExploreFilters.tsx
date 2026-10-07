import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type SubmitEvent } from 'react'
import { apiGet, apiPut, useFieldErrors } from '../api'
import { hasFilters, useFilterPreference } from '../filterPreference'
import { queryKeys } from '../queryClient'
import type { Tag } from '../types/tags'
import type { FilterPreference, User, Weekday } from '../types/users'
import { FormAlert } from './Field'

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7]
// 2024-01-01 was a Monday, so day n of that week is ISO weekday n
const weekdayDate = (weekday: Weekday) => new Date(2024, 0, weekday)
const shortWeekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const longWeekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long' })

function filtersSummary(filterPreference: FilterPreference) {
  if (!hasFilters(filterPreference)) return 'All occasions'
  const parts = []
  if (filterPreference.tags.length > 0) {
    parts.push(filterPreference.tags.length === 1 ? filterPreference.tags[0].name : `${filterPreference.tags.length} tags`)
  }
  if (filterPreference.weekdays.length > 0) {
    parts.push(filterPreference.weekdays.map((weekday) => shortWeekdayFormat.format(weekdayDate(weekday))).join(', '))
  }
  return parts.join(' · ')
}

// Toggles a value in a set, returning a new set
function toggled<T>(values: ReadonlySet<T>, value: T) {
  const toggledValues = new Set(values)
  if (toggledValues.has(value)) toggledValues.delete(value)
  else toggledValues.add(value)
  return toggledValues
}

function sameSet<T>(first: ReadonlySet<T>, second: ReadonlySet<T>) {
  return first.size === second.size && [...first].every((value) => second.has(value))
}

function FiltersEditor({ user, savedFilters }: { user: User; savedFilters: FilterPreference }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const savedTagIds = new Set(savedFilters.tags.map((tag) => tag.id))
  const savedWeekdays = new Set(savedFilters.weekdays)
  const [selectedTagIds, setSelectedTagIds] = useState<ReadonlySet<number>>(savedTagIds)
  const [selectedWeekdays, setSelectedWeekdays] = useState<ReadonlySet<Weekday>>(savedWeekdays)

  // Only needed once the panel is open
  const tagsQuery = useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => apiGet<Tag[]>('/api/tags/'),
    enabled: open,
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      apiPut<FilterPreference>(`/api/users/${user.uuid}/filter-preference/`, {
        tag_ids: [...selectedTagIds],
        weekdays: [...selectedWeekdays],
      }),
    onSuccess: (filterPreference) => {
      queryClient.setQueryData(queryKeys.filterPreference(user.uuid), filterPreference)
      // The deck comes back filtered by the server
      return queryClient.invalidateQueries({ queryKey: queryKeys.explore })
    },
  })
  const errors = useFieldErrors(saveMutation.error, tagsQuery.error)

  const changed = !sameSet(selectedTagIds, savedTagIds) || !sameSet(selectedWeekdays, savedWeekdays)
  const tags = tagsQuery.data

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    saveMutation.mutate()
  }

  // Changing a choice hides the last "Saved" or error
  function edit(update: () => void) {
    update()
    if (!saveMutation.isPending) saveMutation.reset()
  }

  return (
    <details className="explore-filters" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="explore-filters-title">Filters</span>
        <span className="explore-filters-summary">{filtersSummary(savedFilters)}</span>
      </summary>

      <form className="form explore-filters-form" onSubmit={onSubmit}>
        <FormAlert messages={errors.non_field_errors} />

        <fieldset className="filter-group">
          <legend>Tags</legend>
          <p className="field-hint">Show occasions with any of these tags.</p>
          {!tags && !tagsQuery.error && <p className="muted">Loading…</p>}
          {tags && tags.length === 0 && <p className="muted">No tags yet.</p>}
          {tags && tags.length > 0 && (
            <div className="filter-options">
              {tags.map((tag) => (
                <label className="filter-option" key={tag.id}>
                  <input
                    type="checkbox"
                    checked={selectedTagIds.has(tag.id)}
                    onChange={() => edit(() => setSelectedTagIds((tagIds) => toggled(tagIds, tag.id)))}
                  />
                  {tag.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className="filter-group">
          <legend>Days</legend>
          <p className="field-hint">Show occasions starting on these days.</p>
          <div className="filter-options">
            {WEEKDAYS.map((weekday) => (
              <label className="filter-option" key={weekday}>
                <input
                  type="checkbox"
                  aria-label={longWeekdayFormat.format(weekdayDate(weekday))}
                  checked={selectedWeekdays.has(weekday)}
                  onChange={() => edit(() => setSelectedWeekdays((weekdays) => toggled(weekdays, weekday)))}
                />
                {shortWeekdayFormat.format(weekdayDate(weekday))}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="form-actions">
          {saveMutation.isSuccess && (
            <p className="form-status" role="status">
              Saved
            </p>
          )}
          <button
            className="btn btn-sm"
            type="button"
            disabled={selectedTagIds.size === 0 && selectedWeekdays.size === 0}
            onClick={() =>
              edit(() => {
                setSelectedTagIds(new Set())
                setSelectedWeekdays(new Set())
              })
            }
          >
            Clear
          </button>
          <button className="btn btn-sm btn-confirm" type="submit" disabled={!changed || saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save filters'}
          </button>
        </div>
      </form>
    </details>
  )
}

/** Explore's filter panel: the user's saved tags and days. Hidden if they can't be loaded. */
export function ExploreFilters({ user }: { user: User }) {
  const filterPreferenceQuery = useFilterPreference(user)
  if (!filterPreferenceQuery.data) return null
  // Keyed by user so a different login starts from their own saved filters
  return <FiltersEditor key={user.uuid} user={user} savedFilters={filterPreferenceQuery.data} />
}
