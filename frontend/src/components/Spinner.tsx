import { classNames } from '../classNames'
import type { SpinnerProps } from '../types/ui/spinner'

/**
 * A loading indicator (styles: `.spinner` in App.css): a ring with one lilac arc turning. With reduced motion
 * it stands still. The label is a polite live region for screen readers and never shown.
 */
export function Spinner({ label = 'Loading', className }: SpinnerProps) {
  return (
    <span className={classNames('spinner', className)} role="status">
      <span className="visually-hidden">{label}</span>
    </span>
  )
}
