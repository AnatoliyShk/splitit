// Props and UI state types for components/Pager.tsx

export type PagerProps = {
  page: number
  count: number
  pageSize: number
  onChange: (page: number) => void
}
