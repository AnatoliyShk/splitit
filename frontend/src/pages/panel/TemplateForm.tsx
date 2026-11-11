import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router'
import { apiGet, useFieldErrors } from '../../api'
import { Field } from '../../components/Field'
import { queryKeys } from '../../queryClient'
import type { PanelTemplate } from '../../types/api/admin'
import type { TemplateEditorProps } from '../../types/ui/occasionForm'
import { PanelItemForm } from './PanelItemForm'

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
  const queryClient = useQueryClient()
  const [durationMinutes, setDurationMinutes] = useState(
    template?.duration_minutes == null ? '' : String(template.duration_minutes),
  )

  async function refreshTemplates() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.panel.templates() })
    // Users see the templates on their profile
    await queryClient.invalidateQueries({ queryKey: queryKeys.occasionTemplates })
  }

  return (
    <PanelItemForm
      noun="template"
      listLabel="Templates"
      listPath="/admin/templates"
      apiPath="/api/admin/templates/"
      itemId={templateId}
      item={template}
      loadErrors={loadErrors}
      descriptionHint="Copied to every occasion made from this template."
      body={{ duration_minutes: durationMinutes.trim() === '' ? null : Number(durationMinutes) }}
      onSaved={refreshTemplates}
    >
      {(errors) => (
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
      )}
    </PanelItemForm>
  )
}
