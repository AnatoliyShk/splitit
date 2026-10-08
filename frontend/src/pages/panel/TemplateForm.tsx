import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { apiGet, apiPatch, apiPost, errorsFrom, useFieldErrors, type FieldErrors } from '../../api'
import { Field, FormAlert, TextAreaField } from '../../components/Field'
import { TagPicker } from '../../components/TagPicker'
import { queryKeys } from '../../queryClient'
import type { PanelTemplate } from '../../types/api/admin'
import type { Tag } from '../../types/api/tags'
import type { TemplateEditorProps } from '../../types/ui/occasionForm'
import { ImageSlots } from './ImageSlots'
import { formatDate } from './shared'
import { ImagesNotSaved, useImageEdits } from './useImageEdits'

const IMAGES_NOT_SAVED: FieldErrors = {
  non_field_errors: ['The template was saved, but some images weren’t. Fix them and save again.'],
}

// Same limit as the server (OccasionTemplate.duration_minutes): two weeks
const MAX_DURATION_MINUTES = 14 * 24 * 60

// The occasion form without its date and people: a template holds what's the same every time
export default function TemplateForm() {
  const { id: templateId } = useParams()
  const templateQuery = useQuery({
    queryKey: queryKeys.panel.template(templateId ?? ''),
    queryFn: () => apiGet<PanelTemplate>(`/api/admin/templates/${templateId}/`),
    enabled: Boolean(templateId),
    // Always load the latest copy: the form starts from it and never picks up later changes
    gcTime: 0,
  })
  const loadErrors = useFieldErrors(templateQuery.error)

  if (templateId && !templateQuery.data) {
    if (!loadErrors.non_field_errors) return <p className="muted">Loading…</p>
    return <TemplateEditor templateId={templateId} template={null} loadErrors={loadErrors} />
  }
  return <TemplateEditor templateId={templateId} template={templateQuery.data ?? null} loadErrors={loadErrors} />
}

function TemplateEditor({ templateId, template, loadErrors }: TemplateEditorProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const [name, setName] = useState(template?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [durationMinutes, setDurationMinutes] = useState(
    template?.duration_minutes == null ? '' : String(template.duration_minutes),
  )
  const [tags, setTags] = useState<Tag[]>(template?.tags ?? [])
  const { savedImages, imageChanges, imageErrors, clearImageErrors, pickImage, removeImage, undoImage, saveImages } =
    useImageEdits(template?.images ?? [])
  // A new template that was created but whose images failed: saving again updates it instead of adding another
  const [createdId, setCreatedId] = useState<number | null>(null)

  const saveMutation = useMutation({
    mutationFn: async () => {
      clearImageErrors()
      const body = {
        name,
        description,
        duration_minutes: durationMinutes.trim() === '' ? null : Number(durationMinutes),
        tag_ids: tags.map((tag) => tag.id),
      }
      const existingId = templateId ?? createdId
      let savedTemplate: PanelTemplate
      if (existingId) {
        savedTemplate = await apiPatch<PanelTemplate>(`/api/admin/templates/${existingId}/`, body)
      } else {
        savedTemplate = await apiPost<PanelTemplate>('/api/admin/templates/', body)
        setCreatedId(savedTemplate.id)
      }
      await saveImages(`/api/admin/templates/${savedTemplate.id}/images/`)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.panel.templates() })
      // Users see the templates on their profile
      await queryClient.invalidateQueries({ queryKey: queryKeys.occasionTemplates })
      navigate('/admin/templates')
    },
  })
  const saveError = saveMutation.error
  const saveErrors = useMemo(
    () => (saveError instanceof ImagesNotSaved ? IMAGES_NOT_SAVED : saveError ? errorsFrom(saveError) : null),
    [saveError],
  )
  const errors = saveErrors ?? loadErrors

  // After a failed save, move focus to the first invalid field
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
  }, [errors])

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    saveMutation.mutate()
  }

  const saving = saveMutation.isPending || saveMutation.isSuccess

  return (
    <>
      <div className="panel-head">
        <div>
          <Link className="back-link" to="/admin/templates">
            ← Templates
          </Link>
          <h1>{templateId ? 'Edit template' : 'New template'}</h1>
        </div>
        {template && <span className="muted">Last updated {formatDate(template.updated_at)}</span>}
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
          hint="Copied to every occasion made from this template."
          maxLength={2000}
          rows={5}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          errors={errors.description}
        />
        <Field
          id="duration_minutes"
          label="Length in minutes"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_DURATION_MINUTES}
          hint="Optional. Leave empty if occasions made from it have no fixed end."
          value={durationMinutes}
          onChange={(event) => setDurationMinutes(event.target.value)}
          errors={errors.duration_minutes}
        />
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
          <Link className="btn" to="/admin/templates">
            Cancel
          </Link>
          <button className="btn btn-confirm" type="submit" disabled={saving}>
            {saving ? 'Saving…' : templateId || createdId ? 'Save changes' : 'Create template'}
          </button>
        </div>
      </form>
    </>
  )
}
