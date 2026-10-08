import { useQuery } from '@tanstack/react-query'
import { apiGet } from './api'
import { queryKeys } from './queryClient'
import type { FilterPreference, User } from './types/api/users'

/** The user's saved Explore filters; shares its cache with the filter panel. */
export function useFilterPreference(user: User | null) {
  const userUuid = user?.uuid ?? ''
  return useQuery({
    queryKey: queryKeys.filterPreference(userUuid),
    queryFn: () => apiGet<FilterPreference>(`/api/users/${userUuid}/filter-preference/`),
    enabled: Boolean(user),
  })
}

/** Whether anything is saved, on or off. */
export function hasFilters(filterPreference: FilterPreference | undefined) {
  return Boolean(filterPreference && (filterPreference.tags.length > 0 || filterPreference.weekdays.length > 0))
}

/** Whether the saved filters are narrowing Explore right now: something is saved and they're turned on. */
export function filtersApplied(filterPreference: FilterPreference | undefined) {
  return Boolean(filterPreference?.is_enabled) && hasFilters(filterPreference)
}
