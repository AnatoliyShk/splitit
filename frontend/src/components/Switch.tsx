import { classNames } from '../classNames'
import type { SwitchProps } from '../types/ui/switch'

/**
 * An on/off switch (styles: `.switch*` in App.css). A button with role="switch", so screen readers
 * announce it as on or off and Space or Enter flips it. The thumb springs across with an elastic overshoot.
 */
export function Switch({ checked, onChange, label, disabled, className }: SwitchProps) {
  return (
    <button
      className={classNames('switch', className)}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" aria-hidden="true" />
    </button>
  )
}
