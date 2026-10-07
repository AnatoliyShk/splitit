// Props and UI state types for pages/panel/ImageSlots.tsx (and the occasion form that holds its state)

// Saved image URLs by slot, as the server has them
export type SavedImages = Record<number, string>
// Edits waiting for Save: a File to upload into the slot, or null to empty it
export type ImageChanges = Record<number, File | null>

export type ImageSlotsProps = {
  saved: SavedImages
  changes: ImageChanges
  errors: Record<number, string[]>
  onPick: (order: number, file: File) => void
  onRemove: (order: number) => void
  onUndo: (order: number) => void
}
