import type { Gender } from './types/api/users'

// Not in types/api/: that folder is types only, and a runtime file under a path with /api/ is caught by the e2e API mocks
/** Every gender with its label, in the order the pickers list them (same labels as the backend's Gender). */
export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'man', label: 'Man' },
  { value: 'woman', label: 'Woman' },
  { value: 'undisclosed', label: 'Do not want to tell' },
]
