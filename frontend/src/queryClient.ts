import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The server answered (4xx/5xx): retrying won't change it. Network failures get one more try
      retry: (failureCount, error) => !(error instanceof ApiError) && failureCount < 1,
      refetchOnWindowFocus: false,
    },
  },
})

type ListParams = { page: number; search: string }

/**
 * Every query key in one place. Keys nest, so invalidating a prefix (e.g. `queryKeys.panel.all`)
 * covers everything under it. Data is stale right away (the default), so a page refetches when it mounts.
 */
export const queryKeys = {
  health: ['health'] as const,
  me: ['auth', 'me'] as const,
  userOccasions: (userUuid: string) => ['users', userUuid, 'occasions'] as const,
  userConnections: (userUuid: string) => ['users', userUuid, 'connections'] as const,
  connectionsGraph: (userUuid: string) => ['users', userUuid, 'connections', 'graph'] as const,
  filterPreference: (userUuid: string) => ['users', userUuid, 'filter-preference'] as const,
  tags: ['tags'] as const,
  explore: ['occasions', 'explore'] as const,
  occasion: (occasionId: string) => ['occasions', occasionId] as const,
  panel: {
    all: ['panel'] as const,
    stats: ['panel', 'stats'] as const,
    // Without params: the prefix of every page and search of that list
    users: (params?: ListParams) => (params ? ['panel', 'users', params] : ['panel', 'users']) as readonly unknown[],
    tags: (params?: ListParams) => (params ? ['panel', 'tags', params] : ['panel', 'tags']) as readonly unknown[],
    occasions: (params?: ListParams) =>
      (params ? ['panel', 'occasions', params] : ['panel', 'occasions']) as readonly unknown[],
    occasion: (occasionId: string) => ['panel', 'occasion', occasionId] as const,
  },
}

/** The query string for a panel list request. */
export function listQueryString({ page, search }: ListParams) {
  return new URLSearchParams({ page: String(page), search }).toString()
}
