import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type SubmitEvent } from 'react'
import { apiGet, apiPatch, apiPut, useFieldErrors } from '../api'
import { filtersApplied, hasFilters, useFilterPreference } from '../filterPreference'
import { queryKeys } from '../queryClient'
import type { Tag } from '../types/api/tags'
import type { FilterPreference, User, Weekday } from '../types/api/users'
import { FormAlert } from './Field'
import { Modal } from './Modal'
import { Switch } from './Switch'

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7]
// 2024-01-01 was a Monday, so day n of that week is ISO weekday n
const weekdayDate = (weekday: Weekday) => new Date(2024, 0, weekday)
const shortWeekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const longWeekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long' })

// The saved days as short names in week order, e.g. ["Sat", "Sun"]
function weekdayNames(weekdays: Weekday[]) {
  return [...weekdays]
    .sort((first, second) => first - second)
    .map((weekday) => shortWeekdayFormat.format(weekdayDate(weekday)))
}

// What's saved as one sentence, for screen readers (the card's list label would otherwise stand in for the names)
function chosenFiltersText(filterPreference: FilterPreference) {
  if (!hasFilters(filterPreference)) return 'All occasions'
  const parts = filterPreference.is_enabled ? [] : ['Off.']
  if (filterPreference.tags.length > 0) parts.push(`Tags: ${filterPreference.tags.map((tag) => tag.name).join(', ')}.`)
  if (filterPreference.weekdays.length > 0) parts.push(`Days: ${weekdayNames(filterPreference.weekdays).join(', ')}.`)
  return parts.join(' ')
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
  const [modalOpen, setModalOpen] = useState(false)
  const chosenFiltersId = useId()
  const savedTagIds = new Set(savedFilters.tags.map((tag) => tag.id))
  const savedWeekdays = new Set(savedFilters.weekdays)
  const [selectedTagIds, setSelectedTagIds] = useState<ReadonlySet<number>>(savedTagIds)
  const [selectedWeekdays, setSelectedWeekdays] = useState<ReadonlySet<Weekday>>(savedWeekdays)

  // Only needed once the modal is open
  const tagsQuery = useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => apiGet<Tag[]>('/api/tags/'),
    enabled: modalOpen,
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      apiPut<FilterPreference>(`/api/users/${user.uuid}/filter-preference/`, {
        tag_ids: [...selectedTagIds],
        weekdays: [...selectedWeekdays],
        // Saving new filters means wanting them applied
        is_enabled: true,
      }),
    onSuccess: (filterPreference) => {
      queryClient.setQueryData(queryKeys.filterPreference(user.uuid), filterPreference)
      setModalOpen(false)
      // The deck comes back filtered by the server
      return queryClient.invalidateQueries({ queryKey: queryKeys.explore })
    },
  })
  const errors = useFieldErrors(saveMutation.error, tagsQuery.error)

  // The switch: flips at once, and the server's answer (or a refetch, if it fails) settles it
  const filterPreferenceKey = queryKeys.filterPreference(user.uuid)
  const enabledMutation = useMutation({
    mutationFn: (isEnabled: boolean) =>
      apiPatch<FilterPreference>(`/api/users/${user.uuid}/filter-preference/`, { is_enabled: isEnabled }),
    onMutate: (isEnabled) => {
      queryClient.setQueryData<FilterPreference>(
        filterPreferenceKey,
        (cachedFilters) => cachedFilters && { ...cachedFilters, is_enabled: isEnabled },
      )
    },
    onSuccess: (filterPreference) => queryClient.setQueryData(filterPreferenceKey, filterPreference),
    onError: () => queryClient.invalidateQueries({ queryKey: filterPreferenceKey }),
    // On or off, the deck comes back from the server with or without the filters
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.explore }),
  })
  const switchErrors = useFieldErrors(enabledMutation.error)

  const changed = !sameSet(selectedTagIds, savedTagIds) || !sameSet(selectedWeekdays, savedWeekdays)
  const tags = tagsQuery.data

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    saveMutation.mutate()
  }

  // Every opening starts from what's saved, so closing without saving discards the changes
  function openModal() {
    setSelectedTagIds(savedTagIds)
    setSelectedWeekdays(savedWeekdays)
    saveMutation.reset()
    setModalOpen(true)
  }

  // Changing a choice hides the last error
  function edit(update: () => void) {
    update()
    if (!saveMutation.isPending) saveMutation.reset()
  }

  return (
    <>
      {/* Applied filters turn it lilac; the hidden text says what is saved */}
      <button
        className="btn btn-sm explore-filters-open"
        type="button"
        aria-haspopup="dialog"
        aria-describedby={chosenFiltersId}
        data-applied={filtersApplied(savedFilters) || undefined}
        onClick={openModal}
      >
        <svg className="btn-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        <span className="btn-label">Filters</span>
      </button>
      <span className="visually-hidden" id={chosenFiltersId}>
        {chosenFiltersText(savedFilters)}
      </span>
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Filters">
        <form className="form" onSubmit={onSubmit}>
          <FormAlert messages={errors.non_field_errors} />

          {/* Always shown; until something is saved there's nothing to turn on or off, so it's disabled */}
          <div className="filter-switch">
            <span className="filter-switch-text">
              <strong>Use saved filters</strong>
              <span className="field-hint">
                {hasFilters(savedFilters)
                  ? 'Off shows every occasion without losing them.'
                  : 'Save some tags or days first, then turn them on or off here.'}
              </span>
            </span>
            <Switch
              checked={hasFilters(savedFilters) && savedFilters.is_enabled}
              onChange={(isEnabled) => enabledMutation.mutate(isEnabled)}
              label="Use these filters"
              disabled={!hasFilters(savedFilters)}
            />
          </div>
          <FormAlert messages={switchErrors.non_field_errors} />

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
      </Modal>
    </>
  )
}

/** Explore's Filters button and the modal that edits them (and turns the saved ones on or off). Hidden until they load, and if they can't. */
export function ExploreFilters({ user }: { user: User }) {
  const filterPreferenceQuery = useFilterPreference(user)
  if (!filterPreferenceQuery.data) return null
  // Keyed by user so a different login starts from their own saved filters
  return <FiltersEditor key={user.uuid} user={user} savedFilters={filterPreferenceQuery.data} />
}
