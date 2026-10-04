import { useEffect, useMemo } from 'react'
import { IMAGE_SLOTS, IMAGE_TYPES, slotLabel, type ImageChanges, type SavedImages } from './shared'


type Props = {
  saved: SavedImages
  changes: ImageChanges
  errors: Record<number, string[]>
  onPick: (order: number, file: File) => void
  onRemove: (order: number) => void
  onUndo: (order: number) => void
}

export function ImageSlots({ saved, changes, errors, onPick, onRemove, onUndo }: Props) {
  // Local previews for files that aren't uploaded yet
  const previews = useMemo(() => {
    const urls: Record<number, string> = {}
    for (const [order, file] of Object.entries(changes)) if (file) urls[Number(order)] = URL.createObjectURL(file)
    return urls
  }, [changes])
  useEffect(() => () => Object.values(previews).forEach((url) => URL.revokeObjectURL(url)), [previews])

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
          const url = pending ? (previews[order] ?? null) : (saved[order] ?? null)
          const slotErrors = errors[order] ?? []
          const inputId = `image-${order}`
          return (
            <div className="image-slot" role="group" aria-label={label} key={order}>
              <span className="image-slot-label">
                {label}
                {pending && <span className="tag image-slot-pending">Unsaved</span>}
              </span>
              {url ? (
                <img className="image-slot-preview" src={url} alt={`${label} preview`} />
              ) : (
                <span className="image-slot-preview image-slot-empty">No image</span>
              )}
              <div className="image-slot-actions">
                <label className="btn btn-sm image-pick" htmlFor={inputId}>
                  {url ? 'Replace' : 'Add'}
                  <span className="visually-hidden"> {label.toLowerCase()}</span>
                </label>
                <input
                  id={inputId}
                  className="visually-hidden"
                  type="file"
                  accept={IMAGE_TYPES.join(',')}
                  aria-invalid={slotErrors.length > 0 || undefined}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    // Clear it so picking the same file again still fires a change
                    e.target.value = ''
                    if (file) onPick(order, file)
                  }}
                />
                {url && (
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
                  {slotErrors.map((e) => (
                    <li key={e}>{e}</li>
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
