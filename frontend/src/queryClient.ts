import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The server answered (4xx/5xx): retrying won't change it. Network failures get one more try
      retry: (failures, error) => !(error instanceof ApiError) && failures < 1,
      refetchOnWindowFocus: false,
    },
  },
})
