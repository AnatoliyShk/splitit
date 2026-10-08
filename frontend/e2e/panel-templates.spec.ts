import { expect, test, type Page } from '@playwright/test'
import {
  deferred,
  mockApi,
  mockMedia,
  mockStaffSession,
  openActions,
  paginate,
  panelTag,
  panelTemplate,
  PNG,
  type PanelTemplate,
} from './fixtures/panel'

test.use({ timezoneId: 'UTC', locale: 'en-US' })

const jazzTag = panelTag({ id: 1, name: 'Jazz' })

function seed(): PanelTemplate[] {
  return [
    panelTemplate({ id: 1, name: 'Jazz night', duration_minutes: 180, tags: [{ id: 1, name: 'Jazz' }] }),
    panelTemplate({ id: 2, name: 'Hangout', duration_minutes: null, created_at: '2025-05-20T08:00:00Z' }),
    panelTemplate({ id: 3, name: 'Hike', duration_minutes: 1500 }),
  ]
}

// Stateful in-memory API for /api/admin/templates/ and /api/admin/templates/<id>/
async function openTemplates(page: Page, templates = seed()) {
  let nextId = 1000
  const list = await mockApi(page, '/api/admin/templates/', {
    GET: ({ url }) => ({ body: paginate(templates, url, (template) => [template.name]) }),
    POST: ({ body }) => {
      const fields = body as Pick<PanelTemplate, 'name' | 'description' | 'duration_minutes'> & { tag_ids: number[] }
      const template = panelTemplate({
        id: nextId++,
        name: fields.name,
        description: fields.description,
        duration_minutes: fields.duration_minutes,
        tags: fields.tag_ids.map((id) => ({ id, name: 'Jazz' })),
      })
      templates.push(template)
      return { status: 201, body: template }
    },
  })
  const detail = await mockApi(page, /^\/api\/admin\/templates\/\d+\/$/, {
    GET: ({ url }) => ({ body: templates.find((template) => url.pathname === `/api/admin/templates/${template.id}/`) }),
    PATCH: ({ url, body }) => {
      const template = templates.find((item) => url.pathname === `/api/admin/templates/${item.id}/`)!
      Object.assign(template, { ...(body as object), tags: template.tags })
      return { body: template }
    },
    DELETE: ({ url }) => {
      const id = Number(url.pathname.split('/').at(-2))
      templates.splice(
        templates.findIndex((template) => template.id === id),
        1,
      )
      return { status: 204 }
    },
  })
  await mockApi(page, '/api/admin/tags/', {
    GET: ({ url }) => ({ body: paginate([jazzTag], url, (tag) => [tag.name]) }),
  })
  await page.goto('/admin/templates')
  await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible()
  return { templates, list, detail }
}

const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name })

test.describe('panel templates', () => {
  test.beforeEach(async ({ page }) => {
    await mockStaffSession(page)
  })

  test('has a Templates tab in the panel', async ({ page }) => {
    await openTemplates(page)
    await expect(page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Templates' })).toBeVisible()
  })

  test('lists templates with length, tags and total', async ({ page }) => {
    await openTemplates(page)

    await expect(page.getByText('3 total')).toBeVisible()
    await expect(row(page, 'Jazz night')).toContainText('3 h')
    await expect(row(page, 'Jazz night')).toContainText('Jazz')
    await expect(row(page, 'Hangout')).toContainText('Open')
    await expect(row(page, 'Hike')).toContainText('1 day 1 h')
  })

  test('searching filters the list by name', async ({ page }) => {
    await openTemplates(page)

    await page.getByLabel('Search by name').fill('hang')

    await expect(page.getByRole('row').filter({ hasText: /Jazz night|Hike/ })).toHaveCount(0)
    await expect(row(page, 'Hangout')).toBeVisible()
  })

  test('shows an empty message with a link to the form', async ({ page }) => {
    await openTemplates(page, [])

    await expect(page.getByText('No templates yet.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'New template' }).first()).toHaveAttribute('href', '/admin/templates/new')
  })

  test.describe('new template form', () => {
    test('is the occasion form without dates and people, with the same image slots', async ({ page }) => {
      await openTemplates(page)
      await page.getByRole('link', { name: 'New template' }).click()

      await expect(page.getByRole('heading', { name: 'New template' })).toBeVisible()
      await expect(page.getByLabel('Name', { exact: true })).toBeVisible()
      await expect(page.getByLabel('Description (optional)')).toBeVisible()
      await expect(page.getByLabel('Length in minutes')).toBeVisible()
      await expect(page.getByLabel('Starts')).toHaveCount(0)
      await expect(page.getByText('Attendees')).toHaveCount(0)
      for (const label of ['Main image', 'Gallery 1', 'Gallery 2', 'Gallery 3']) {
        await expect(page.getByRole('group', { name: label, exact: true })).toBeVisible()
      }
    })

    test('creates the template and goes back to the list', async ({ page }) => {
      const { list } = await openTemplates(page)
      await page.getByRole('link', { name: 'New template' }).click()
      await expect(page.getByRole('heading', { name: 'New template' })).toBeVisible()

      await page.getByLabel('Name', { exact: true }).fill('Pub quiz')
      await page.getByLabel('Description (optional)').fill('Teams of four.')
      await page.getByLabel('Length in minutes').fill('120')
      await page.getByRole('searchbox', { name: /tag/i }).fill('Jazz')
      await page.getByRole('button', { name: /Jazz/ }).first().click()
      await page.getByRole('button', { name: 'Create template' }).click()

      await expect(page).toHaveURL(/\/admin\/templates$/)
      await expect(row(page, 'Pub quiz')).toContainText('2 h')
      const post = list.find((call) => call.method === 'POST')!
      expect(post.body).toEqual({
        name: 'Pub quiz',
        description: 'Teams of four.',
        duration_minutes: 120,
        tag_ids: [1],
      })
    })

    test('an empty length is sent as null', async ({ page }) => {
      const { list } = await openTemplates(page)
      await page.getByRole('link', { name: 'New template' }).click()

      await page.getByLabel('Name', { exact: true }).fill('Hangout 2')
      await page.getByRole('button', { name: 'Create template' }).click()

      await expect(page).toHaveURL(/\/admin\/templates$/)
      expect(list.find((call) => call.method === 'POST')!.body.duration_minutes).toBeNull()
    })

    test('shows the server errors next to the fields', async ({ page }) => {
      await openTemplates(page)
      await mockApi(page, '/api/admin/templates/', {
        POST: () => ({ status: 400, body: { name: ['Enter a name.'], duration_minutes: ['Ensure this value is greater than or equal to 1.'] } }),
      })
      await page.getByRole('link', { name: 'New template' }).click()

      await page.getByRole('button', { name: 'Create template' }).click()

      await expect(page.getByText('Enter a name.')).toBeVisible()
      await expect(page.getByText('Ensure this value is greater than or equal to 1.')).toBeVisible()
      await expect(page).toHaveURL(/\/admin\/templates\/new$/)
    })
  })

  test.describe('images', () => {
    const png = (name = 'photo.png') => ({ name, mimeType: 'image/png', buffer: PNG })
    const slot = (page: Page, label: string) => page.getByRole('group', { name: label, exact: true })
    const withImages = panelTemplate({
      id: 1,
      name: 'Jazz night',
      images: [
        { order: 0, url: '/media/occasion_templates/1/main.png' },
        { order: 2, url: '/media/occasion_templates/1/two.png' },
      ],
    })

    test('a new template is created first, then its images go to the new id', async ({ page }) => {
      await mockMedia(page)
      const { list } = await openTemplates(page)
      const uploads = await mockApi(page, /^\/api\/admin\/templates\/\d+\/images\/$/, {
        POST: () => ({ status: 201, body: panelTemplate({ id: 1000 }) }),
      })
      await page.getByRole('link', { name: 'New template' }).click()
      await expect(page.getByRole('heading', { name: 'New template' })).toBeVisible()

      await page.getByLabel('Name', { exact: true }).fill('Pub quiz')
      await page.getByLabel('Add main image').setInputFiles(png('cover.png'))
      await expect(slot(page, 'Main image').getByText('Unsaved')).toBeVisible()
      await page.getByRole('button', { name: 'Create template' }).click()

      await expect(page).toHaveURL(/\/admin\/templates$/)
      expect(list.filter((call) => call.method === 'POST')).toHaveLength(1)
      expect(uploads.map((call) => call.url.pathname)).toEqual(['/api/admin/templates/1000/images/'])
      expect(uploads[0].raw).toContain('name="order"')
      expect(uploads[0].raw).toContain('cover.png')
    })

    test('editing shows the saved images, and removing one deletes it on save', async ({ page }) => {
      await mockMedia(page)
      await openTemplates(page, [withImages])
      const deletes = await mockApi(page, /^\/api\/admin\/templates\/\d+\/images\/\d+\/$/, {
        DELETE: () => ({ body: withImages }),
      })
      await openActions(row(page, 'Jazz night'))
      await row(page, 'Jazz night').getByRole('link', { name: 'Edit' }).click()

      await expect(slot(page, 'Main image').getByRole('img', { name: 'Main image preview' })).toHaveAttribute(
        'src',
        '/media/occasion_templates/1/main.png',
      )
      await expect(slot(page, 'Gallery 2').getByRole('img')).toBeVisible()
      await expect(slot(page, 'Gallery 1').getByText('No image')).toBeVisible()

      await page.getByRole('button', { name: 'Remove gallery 2' }).click()
      await page.getByRole('button', { name: 'Save changes' }).click()

      await expect(page).toHaveURL(/\/admin\/templates$/)
      expect(deletes.map((call) => call.url.pathname)).toEqual(['/api/admin/templates/1/images/2/'])
    })

    test('a failed upload keeps the form open, and saving again updates the created template', async ({ page }) => {
      await mockMedia(page)
      const { list } = await openTemplates(page)
      let attempt = 0
      await mockApi(page, /^\/api\/admin\/templates\/\d+\/images\/$/, {
        POST: () => (attempt++ === 0 ? { status: 400, body: { image: ['The image must be 5 MB or smaller.'] } } : { status: 201, body: panelTemplate({ id: 1000 }) }),
      })
      await page.getByRole('link', { name: 'New template' }).click()
      await expect(page.getByRole('heading', { name: 'New template' })).toBeVisible()
      await page.getByLabel('Name', { exact: true }).fill('Pub quiz')
      await page.getByLabel('Add main image').setInputFiles(png())

      await page.getByRole('button', { name: 'Create template' }).click()

      await expect(page.getByRole('alert')).toContainText('The template was saved, but some images weren’t')
      await expect(slot(page, 'Main image').getByText('The image must be 5 MB or smaller.')).toBeVisible()
      await expect(page).toHaveURL(/\/admin\/templates\/new$/)

      await page.getByRole('button', { name: 'Save changes' }).click()

      await expect(page).toHaveURL(/\/admin\/templates$/)
      // Created once; the second save went to the created template
      expect(list.filter((call) => call.method === 'POST')).toHaveLength(1)
    })
  })

  test('editing starts from the saved template and saves changes', async ({ page }) => {
    const { detail } = await openTemplates(page)
    await openActions(row(page, 'Jazz night'))
    await row(page, 'Jazz night').getByRole('link', { name: 'Edit' }).click()

    await expect(page.getByRole('heading', { name: 'Edit template' })).toBeVisible()
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Jazz night')
    await expect(page.getByLabel('Length in minutes')).toHaveValue('180')
    await page.getByLabel('Length in minutes').fill('')
    await page.getByRole('button', { name: 'Save changes' }).click()

    await expect(page).toHaveURL(/\/admin\/templates$/)
    await expect(row(page, 'Jazz night')).toContainText('Open')
    expect(detail.find((call) => call.method === 'PATCH')!.body.duration_minutes).toBeNull()
  })

  test.describe('delete', () => {
    test('asks first, and Keep leaves the template', async ({ page }) => {
      await openTemplates(page)
      await openActions(row(page, 'Hike'))
      await row(page, 'Hike').getByRole('button', { name: 'Delete' }).click()
      await expect(page.getByRole('group', { name: 'Delete Hike?' })).toBeVisible()

      await page.getByRole('button', { name: 'Keep' }).click()

      await expect(page.getByRole('group', { name: 'Delete Hike?' })).toHaveCount(0)
      await expect(row(page, 'Hike')).toBeVisible()
    })

    test('confirming deletes it', async ({ page }) => {
      const { detail } = await openTemplates(page)
      await openActions(row(page, 'Hike'))
      await row(page, 'Hike').getByRole('button', { name: 'Delete' }).click()

      await page.getByRole('group', { name: 'Delete Hike?' }).getByRole('button', { name: 'Delete' }).click()

      await expect(row(page, 'Hike')).toHaveCount(0)
      expect(detail.some((call) => call.method === 'DELETE')).toBe(true)
      await expect(page.getByText('2 total')).toBeVisible()
    })

    test('the confirm button is disabled while the delete is in flight', async ({ page }) => {
      await openTemplates(page)
      const gate = deferred()
      await mockApi(page, /^\/api\/admin\/templates\/\d+\/$/, {
        DELETE: async () => {
          await gate.promise
          return { status: 204 }
        },
      })
      await openActions(row(page, 'Hike'))
      await row(page, 'Hike').getByRole('button', { name: 'Delete' }).click()
      const confirmDelete = page.getByRole('group', { name: 'Delete Hike?' }).getByRole('button', { name: 'Delete' })

      await confirmDelete.click()
      await expect(confirmDelete).toBeDisabled()
      gate.resolve()
    })
  })
})
