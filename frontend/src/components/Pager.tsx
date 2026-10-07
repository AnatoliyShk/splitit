import type { PagerProps } from '../types/ui/pager'

export function Pager({ page, count, pageSize, onChange }: PagerProps) {
  const pages = Math.max(1, Math.ceil(count / pageSize))
  if (pages === 1) return null

  return (
    <nav className="pager" aria-label="Pagination">
      <button className="btn btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span className="pager-info">
        Page {page} of {pages}
      </span>
      <button className="btn btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </nav>
  )
}
