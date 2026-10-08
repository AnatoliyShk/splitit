import { useEffect, useId, useRef } from 'react'
import { classNames } from '../classNames'
import type { ModalProps } from '../types/ui/modal'

/**
 * A modal dialog on the native <dialog> (styles: `.modal*` in App.css). The browser keeps focus inside it,
 * makes the page behind it inert and returns focus to the opener on close. Controlled by `open`.
 */
export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className={classNames('modal', className)}
      aria-labelledby={titleId}
      // Escape: let the parent close it, so `open` stays the source of truth
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      // The dialog has no padding, so a click that lands on the element itself is on the backdrop
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal-content">
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button className="modal-close" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
