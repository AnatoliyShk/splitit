// Shape of paged list responses

/** DRF PageNumberPagination response (the admin lists). */
export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] }
