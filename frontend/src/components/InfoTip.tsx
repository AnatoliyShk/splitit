import { useEffect, useId, useRef, useState } from 'react'
import { classNames } from '../classNames'
import type { InfoTipProps } from '../types/ui/infoTip'

/**
 * An info icon whose tooltip opens on mouse hover, keyboard focus and tap (styles: `.info-tip*` in App.css).
 * Escape, a tap elsewhere or leaving it closes the tooltip. The tooltip is placed against the nearest
 * positioned ancestor, so a parent that sets `position: relative` decides how wide it can be.
 */
export function InfoTip({ label, children, className }: InfoTipProps) {
  const [open, setOpen] = useState(false)
  const tipId = useId()
  const wrapperRef = useRef<HTMLSpanElement>(null)
  // Hover already opened the tooltip, so a mouse click shouldn't close it again
  const lastPointerType = useRef('')

  useEffect(() => {
    if (!open) return
    function closeOnOutsidePress(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress)
  }, [open])

  return (
    <span
      ref={wrapperRef}
      className={classNames('info-tip', className)}
      onPointerEnter={(event) => event.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={(event) => event.pointerType === 'mouse' && setOpen(false)}
      onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
    >
      <button
        className="info-tip-button"
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={tipId}
        onPointerDown={(event) => {
          lastPointerType.current = event.pointerType
        }}
        onClick={() => {
          if (lastPointerType.current === 'mouse') setOpen(true)
          else setOpen(!open)
          lastPointerType.current = ''
        }}
        // Only keyboard focus opens it; a tap focuses the button too and then toggles through onClick
        onFocus={(event) => event.currentTarget.matches(':focus-visible') && setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <svg className="info-tip-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5.5M12 7.5v.01" />
        </svg>
      </button>
      <span className="info-tip-bubble" id={tipId} role="tooltip" data-open={open}>
        {children}
      </span>
    </span>
  )
}
