import { useEffect, useMemo } from 'react'
import type { ImageSlotsProps } from '../../types/ui/imageSlots'
import { IMAGE_SLOTS, IMAGE_TYPES, slotLabel } from './shared'


export function ImageSlots({ saved, changes, errors, onPick, onRemove, onUndo }: ImageSlotsProps) {
  // Local previews for files that aren't uploaded yet
  const previews = useMemo(() => {
    const previewUrls: Record<number, string> = {}
    for (const [order, file] of Object.entries(changes)) if (file) previewUrls[Number(order)] = URL.createObjectURL(file)
    return previewUrls
  }, [changes])
  useEffect(() => () => Object.values(previews).forEach((previewUrl) => URL.revokeObjectURL(previewUrl)), [previews])

  return (
    <fieldset className="image-slots" aria-describedby="images-hint">
      <legend>Images</legend>
      <p className="field-hint" id="images-hint">
        The main image shows on occasion cards. Up to 3 more make the gallery on the occasion's page. JPEG, PNG or
        WebP, up to 5 MB each. Changes are saved with the form.
      </p>
      <div className="image-grid">
        {IMAGE_SLOTS.map((order) => {
          const label = slotLabel(order)
          const pending = order in changes
          const imageUrl = pending ? (previews[order] ?? null) : (saved[order] ?? null)
          const slotErrors = errors[order] ?? []
          const inputId = `image-${order}`
          return (
            <div className="image-slot" role="group" aria-label={label} key={order}>
              <span className="image-slot-label">
                {label}
                {pending && <span className="tag image-slot-pending">Unsaved</span>}
              </span>
              {imageUrl ? (
                <img className="image-slot-preview" src={imageUrl} alt={`${label} preview`} />
              ) : (
                <span className="image-slot-preview image-slot-empty">No image</span>
              )}
              <div className="image-slot-actions">
                <label className="btn btn-sm image-pick" htmlFor={inputId}>
                  {imageUrl ? 'Replace' : 'Add'}
                  <span className="visually-hidden"> {label.toLowerCase()}</span>
                </label>
                <input
                  id={inputId}
                  className="visually-hidden"
                  type="file"
                  accept={IMAGE_TYPES.join(',')}
                  aria-invalid={slotErrors.length > 0 || undefined}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    // Clear it so picking the same file again still fires a change
                    event.target.value = ''
                    if (file) onPick(order, file)
                  }}
                />
                {imageUrl && (
                  <button className="btn btn-sm" type="button" onClick={() => onRemove(order)}>
                    Remove<span className="visually-hidden"> {label.toLowerCase()}</span>
                  </button>
                )}
                {pending && (
                  <button className="btn btn-sm" type="button" onClick={() => onUndo(order)}>
                    Undo<span className="visually-hidden"> {label.toLowerCase()} change</span>
                  </button>
                )}
              </div>
              {slotErrors.length > 0 && (
                <ul className="field-errors">
                  {slotErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}
