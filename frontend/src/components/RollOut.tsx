import { useId, useState } from 'react'
import type { RollOutProps } from '../types/ui/rollOut'

const classNames = (...names: (string | undefined)[]) => names.filter(Boolean).join(' ')

/**
 * A button that rolls content open and closed (styles: `.roll-out*` in App.css). Closed content stays
 * rendered so it can slide, but is hidden from screen readers and the tab order. Renders the two parts
 * without a wrapper, so the parent's layout places them.
 */
export function RollOut({
  toggle,
  children,
  togglePosition = 'before',
  toggleClassName,
  className,
  onOpenChange,
}: RollOutProps) {
  const [open, setOpen] = useState(false)
  const contentId = useId()

  const toggleButton = (
    <button
      className={classNames('roll-out-toggle', toggleClassName)}
      type="button"
      aria-expanded={open}
      aria-controls={contentId}
      onClick={() => {
        setOpen(!open)
        onOpenChange?.(!open)
      }}
    >
      {typeof toggle === 'function' ? toggle(open) : toggle}
      <span className="roll-out-chevron" aria-hidden="true">
        ▾
      </span>
    </button>
  )
  const content = (
    <div className={classNames('roll-out', className)} id={contentId} data-open={open}>
      <div className="roll-out-body">{children}</div>
    </div>
  )

  return togglePosition === 'before' ? (
    <>
      {toggleButton}
      {content}
    </>
  ) : (
    <>
      {content}
      {toggleButton}
    </>
  )
}
