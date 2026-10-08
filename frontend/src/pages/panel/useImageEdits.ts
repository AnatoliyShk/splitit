import { useState } from 'react'
import { apiDelete, apiUpload, errorsFrom } from '../../api'
import type { OccasionImage } from '../../types/api/admin'
import type { ImageChanges, SavedImages } from '../../types/ui/imageSlots'
import { IMAGE_SLOTS, imageProblem } from './shared'

function savedFrom(images: OccasionImage[]): SavedImages {
  return Object.fromEntries(images.map((image) => [image.order, image.url]))
}

function without<T>(record: Record<number, T>, key: number) {
  const copy = { ...record }
  delete copy[key]
  return copy
}

// The owner (an occasion or a template) was saved but at least one image wasn't; each failed slot shows its own error
export class ImagesNotSaved extends Error {}

/**
 * The state behind `ImageSlots` for a form: the images the server has, the edits waiting for Save and each slot's
 * error. `saveImages(imagesUrl)` applies the edits to that owner's `.../images/` endpoints, one slot at a time;
 * each success leaves the pending list, so a retry redoes only the rest. Throws ImagesNotSaved if a slot fails.
 */
export function useImageEdits(initialImages: OccasionImage[]) {
  const [savedImages, setSavedImages] = useState<SavedImages>(() => savedFrom(initialImages))
  const [imageChanges, setImageChanges] = useState<ImageChanges>({})
  const [imageErrors, setImageErrors] = useState<Record<number, string[]>>({})

  function pickImage(order: number, file: File) {
    const problem = imageProblem(file)
    setImageErrors((slotErrors) => (problem ? { ...slotErrors, [order]: [problem] } : without(slotErrors, order)))
    if (!problem) setImageChanges((changes) => ({ ...changes, [order]: file }))
  }

  function removeImage(order: number) {
    setImageErrors((slotErrors) => without(slotErrors, order))
    // Nothing on the server to delete: just drop the picked file
    setImageChanges((changes) => (order in savedImages ? { ...changes, [order]: null } : without(changes, order)))
  }

  function undoImage(order: number) {
    setImageErrors((slotErrors) => without(slotErrors, order))
    setImageChanges((changes) => without(changes, order))
  }

  async function saveImages(imagesUrl: string) {
    for (const order of IMAGE_SLOTS) {
      if (!(order in imageChanges)) continue
      const file = imageChanges[order]
      try {
        if (file) {
          const formData = new FormData()
          formData.append('order', String(order))
          formData.append('image', file)
          const updatedOwner = await apiUpload<{ images: OccasionImage[] }>(imagesUrl, formData)
          setSavedImages(savedFrom(updatedOwner.images))
        } else {
          await apiDelete(`${imagesUrl}${order}/`)
          setSavedImages((images) => without(images, order))
        }
        setImageChanges((changes) => without(changes, order))
      } catch (error) {
        setImageErrors((slotErrors) => ({ ...slotErrors, [order]: Object.values(errorsFrom(error)).flat() }))
        throw new ImagesNotSaved()
      }
    }
  }

  return {
    savedImages,
    imageChanges,
    imageErrors,
    clearImageErrors: () => setImageErrors({}),
    pickImage,
    removeImage,
    undoImage,
    saveImages,
  }
}
