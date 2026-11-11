import { useMutation } from '@tanstack/react-query'
import { useMemo, useRef, useState, type SubmitEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { apiPatch, apiPost, errorsFrom, useFocusFirstInvalid } from '../../api'
import { Field, FormAlert, TextAreaField } from '../../components/Field'
import { TagPicker } from '../../components/TagPicker'
import type { Tag } from '../../types/api/tags'
import type { PanelItemFormProps } from '../../types/ui/occasionForm'
import { ImageSlots } from './ImageSlots'
import { formatDate } from './shared'
import { ImagesNotSaved, useImageEdits } from './useImageEdits'

/**
 * The panel form an occasion and a template share: name, description, tags and images, saved to `apiPath`.
 * The page adds its own fields (`children`, placed before the tags) and sends their values in `body`.
 */
export function PanelItemForm({
  noun,
  listLabel,
  listPath,
  apiPath,
  itemId,
  item,
  loadErrors,
  descriptionHint,
  body,
  onSaved,
  children,
}: PanelItemFormProps) {
  const navigate = useNavigate()
  const formRef = useRef<HTMLFormElement>(null)
  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [tags, setTags] = useState<Tag[]>(item?.tags ?? [])
  const { savedImages, imageChanges, imageErrors, clearImageErrors, pickImage, removeImage, undoImage, saveImages } =
    useImageEdits(item?.images ?? [])
  // A new item that was created but whose images failed: saving again updates it instead of adding another
  const [createdId, setCreatedId] = useState<number | null>(null)

  const saveMutation = useMutation({
    mutationFn: async () => {
      clearImageErrors()
      const fullBody = { ...body, name, description, tag_ids: tags.map((tag) => tag.id) }
      const existingId = itemId ?? createdId
      let savedItem: { id: number }
      if (existingId) {
        savedItem = await apiPatch<{ id: number }>(`${apiPath}${existingId}/`, fullBody)
      } else {
        savedItem = await apiPost<{ id: number }>(apiPath, fullBody)
        setCreatedId(savedItem.id)
      }
      await saveImages(`${apiPath}${savedItem.id}/images/`)
    },
    onSuccess: async () => {
      await onSaved()
      navigate(listPath)
    },
  })
  const saveError = saveMutation.error
  const saveErrors = useMemo(
    () =>
      saveError instanceof ImagesNotSaved
        ? { non_field_errors: [`The ${noun} was saved, but some images weren’t. Fix them and save again.`] }
        : saveError
          ? errorsFrom(saveError)
          : null,
    [saveError, noun],
  )
  const errors = saveErrors ?? loadErrors

  useFocusFirstInvalid(formRef, errors)

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    saveMutation.mutate()
  }

  const saving = saveMutation.isPending || saveMutation.isSuccess

  return (
    <>
      <div className="panel-head">
        <div>
          <Link className="back-link" to={listPath}>
            ← {listLabel}
          </Link>
          <h1>{itemId ? `Edit ${noun}` : `New ${noun}`}</h1>
        </div>
        {item && <span className="muted">Last updated {formatDate(item.updated_at)}</span>}
      </div>

      <form ref={formRef} className="form panel-form" onSubmit={onSubmit} noValidate>
        <FormAlert messages={errors.non_field_errors} />
        <Field
          id="name"
          label="Name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          errors={errors.name}
        />
        <TextAreaField
          id="description"
          label="Description (optional)"
          hint={descriptionHint}
          maxLength={2000}
          rows={5}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          errors={errors.description}
        />
        {children(errors)}
        <TagPicker value={tags} onChange={setTags} errors={errors.tag_ids} />
        <ImageSlots
          saved={savedImages}
          changes={imageChanges}
          errors={imageErrors}
          onPick={pickImage}
          onRemove={removeImage}
          onUndo={undoImage}
        />
        <div className="form-actions">
          <Link className="btn" to={listPath}>
            Cancel
          </Link>
          <button className="btn btn-confirm" type="submit" disabled={saving}>
            {saving ? 'Saving…' : itemId || createdId ? 'Save changes' : `Create ${noun}`}
          </button>
        </div>
      </form>
    </>
  )
}
