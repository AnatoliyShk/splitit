import { expect, test, type Page } from '@playwright/test'
import { deferred, mockApi, mockStaffSession, paginate, panelTag, type PanelTag } from './fixtures/panel'

test.use({ timezoneId: 'UTC', locale: 'en-US' })

function seed(): PanelTag[] {
  return [
    panelTag({ id: 1, name: 'Jazz', occasions_count: 3, has_embedding: true, created_at: '2025-04-01T08:00:00Z' }),
    panelTag({ id: 2, name: 'Hiking', occasions_count: 0, has_embedding: false, created_at: '2025-05-20T08:00:00Z' }),
    panelTag({ id: 3, name: 'Board games', occasions_count: 1, has_embedding: false }),
  ]
}

// Stateful in-memory API for /api/panel/tags/ and /api/panel/tags/<id>/
async function openTags(page: Page, tags = seed()) {
  let nextId = 1000
  const list = await mockApi(page, '/api/panel/tags/', {
    GET: ({ url }) => ({ body: paginate(tags, url, (tag) => [tag.name]) }),
    POST: ({ body }) => {
      const name = String((body as { name: string }).name).trim()
      if (tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
        return { status: 400, body: { name: ['A tag with this name already exists.'] } }
      }
      const tag = panelTag({ id: nextId++, name, occasions_count: 0, has_embedding: false })
      tags.push(tag)
      return { status: 201, body: tag }
    },
  })
  const detail = await mockApi(page, /^\/api\/panel\/tags\/\d+\/$/, {
    PATCH: ({ url, body }) => {
      const id = Number(url.pathname.split('/').at(-2))
      const name = String((body as { name: string }).name).trim()
      if (tags.some((tag) => tag.id !== id && tag.name.toLowerCase() === name.toLowerCase())) {
        return { status: 400, body: { name: ['A tag with this name already exists.'] } }
      }
      const tag = tags.find((tag) => tag.id === id)!
      tag.name = name
      return { body: tag }
    },
    DELETE: ({ url }) => {
      const id = Number(url.pathname.split('/').at(-2))
      tags.splice(
        tags.findIndex((tag) => tag.id === id),
        1,
      )
      return { status: 204 }
    },
  })
  await page.goto('/admin/tags')
  await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible()
  return { tags, list, detail }
}

const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name })

test.describe('panel tags', () => {
  test.beforeEach(async ({ page }) => {
    await mockStaffSession(page)
  })

  test.describe('list', () => {
    test('lists tags with occasions count, creation date and total', async ({ page }) => {
      await openTags(page)

      await expect(page.getByText('3 total')).toBeVisible()
      const jazz = row(page, 'Jazz')
      await expect(jazz.getByRole('cell').nth(1)).toHaveText('3')
      await expect(jazz).toContainText('Apr 1, 2025')
      await expect(row(page, 'Hiking').getByRole('cell').nth(1)).toHaveText('0')
      await expect(row(page, 'Hiking')).toContainText('May 20, 2025')
    })

    test('has the expected column headers', async ({ page }) => {
      await openTags(page)

      for (const name of ['Tag', 'Occasions', 'Embedding', 'Created']) {
        await expect(page.getByRole('columnheader', { name, exact: true })).toBeVisible()
      }
    })

    test('the Embedding column shows a "Ready" check mark when the vector exists', async ({ page }) => {
      await openTags(page)

      const jazz = row(page, 'Jazz')
      await expect(jazz.getByRole('img', { name: 'Ready' })).toBeVisible()
      await expect(jazz.getByRole('img', { name: 'Missing' })).toHaveCount(0)
    })

    test('the Embedding column shows a "Missing" dash when there is no vector', async ({ page }) => {
      await openTags(page)

      for (const name of ['Hiking', 'Board games']) {
        const tagRow = row(page, name)
        await expect(tagRow.getByRole('img', { name: 'Missing' })).toHaveText('–')
        await expect(tagRow.getByRole('img', { name: 'Ready' })).toHaveCount(0)
      }
    })

    test('shows an empty state when there are no tags', async ({ page }) => {
      await openTags(page, [])

      await expect(page.getByText('No tags yet. Add the first one above.')).toBeVisible()
      await expect(page.getByRole('table')).toHaveCount(0)
    })

    test('searching filters tags', async ({ page }) => {
      const { list } = await openTags(page)

      await page.getByLabel('Search tags').fill('game')

      await expect(row(page, 'Board games')).toBeVisible()
      await expect(row(page, 'Jazz')).toHaveCount(0)
      await expect(page.getByText('1 total')).toBeVisible()
      expect(list.at(-1)!.url.searchParams.get('search')).toBe('game')
    })

    test('a search with no match says so', async ({ page }) => {
      await openTags(page)

      await page.getByLabel('Search tags').fill('zzz')

      await expect(page.getByText('No tags match “zzz”.')).toBeVisible()
    })

    test('pages through a long list', async ({ page }) => {
      const many = Array.from({ length: 23 }, (_, i) => panelTag({ id: 100 + i, name: `Tag ${i + 1}` }))
      await openTags(page, many)
      const pager = page.getByRole('navigation', { name: 'Pagination' })

      await expect(pager.getByText('Page 1 of 2')).toBeVisible()
      await expect(row(page, 'Tag 21')).toHaveCount(0)
      await pager.getByRole('button', { name: 'Next' }).click()

      await expect(pager.getByText('Page 2 of 2')).toBeVisible()
      await expect(row(page, 'Tag 21')).toBeVisible()
    })

    test('shows an alert when the list fails to load', async ({ page }) => {
      await mockApi(page, '/api/panel/tags/', { GET: () => ({ status: 500, body: { detail: 'Server error.' } }) })
      await page.goto('/admin/tags')

      await expect(page.getByRole('alert')).toHaveText('Server error.')
    })
  })

  test.describe('create', () => {
    test('"Add tag" is disabled until a name is typed', async ({ page }) => {
      await openTags(page)
      const add = page.getByRole('button', { name: 'Add tag' })

      await expect(add).toBeDisabled()
      await page.getByLabel('New tag').fill('   ')
      await expect(add).toBeDisabled()
      await page.getByLabel('New tag').fill('Jazz fusion')
      await expect(add).toBeEnabled()
    })

    test('adds a tag, clears the field and shows the new row without an embedding', async ({ page }) => {
      const { list } = await openTags(page)

      await page.getByLabel('New tag').fill('Climbing')
      await page.getByRole('button', { name: 'Add tag' }).click()

      const climbing = row(page, 'Climbing')
      await expect(climbing).toBeVisible()
      await expect(climbing.getByRole('img', { name: 'Missing' })).toBeVisible()
      await expect(climbing.getByRole('cell').nth(1)).toHaveText('0')
      await expect(page.getByLabel('New tag')).toHaveValue('')
      await expect(page.getByText('4 total')).toBeVisible()
      expect(list.find((call) => call.method === 'POST')!.body).toEqual({ name: 'Climbing' })
    })

    test('submitting with Enter adds the tag', async ({ page }) => {
      await openTags(page)

      await page.getByLabel('New tag').fill('Pottery')
      await page.getByLabel('New tag').press('Enter')

      await expect(row(page, 'Pottery')).toBeVisible()
    })

    test('a duplicate name shows the server error and adds nothing', async ({ page }) => {
      await openTags(page)

      await page.getByLabel('New tag').fill('jazz')
      await page.getByRole('button', { name: 'Add tag' }).click()

      await expect(page.getByText('A tag with this name already exists.')).toBeVisible()
      await expect(page.getByLabel('New tag')).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByLabel('New tag')).toHaveValue('jazz')
      await expect(page.getByText('3 total')).toBeVisible()
    })

    test('the duplicate-name error goes away when the name is edited', async ({ page }) => {
      await openTags(page)

      await page.getByLabel('New tag').fill('Jazz')
      await page.getByRole('button', { name: 'Add tag' }).click()
      await expect(page.getByText('A tag with this name already exists.')).toBeVisible()
      await page.getByLabel('New tag').fill('Jazz fusion')

      await expect(page.getByText('A tag with this name already exists.')).toHaveCount(0)
    })

    test('a form-wide failure is shown under the field', async ({ page }) => {
      await openTags(page)
      await mockApi(page, '/api/panel/tags/', {
        GET: () => ({ body: { count: 0, next: null, previous: null, results: [] } }),
        POST: () => ({ status: 500, body: { detail: 'Could not save the tag.' } }),
      })

      await page.getByLabel('New tag').fill('Anything')
      await page.getByRole('button', { name: 'Add tag' }).click()

      await expect(page.getByText('Could not save the tag.')).toBeVisible()
    })
  })

  test.describe('rename', () => {
    test('opens an inline field prefilled with the current name', async ({ page }) => {
      await openTags(page)

      await row(page, 'Jazz').getByRole('button', { name: 'Rename' }).click()

      await expect(page.getByLabel('Rename “Jazz”')).toHaveValue('Jazz')
      await expect(page.getByLabel('Rename “Jazz”')).toBeFocused()
    })

    test('saves the new name and keeps the other columns', async ({ page }) => {
      const { detail } = await openTags(page)

      await row(page, 'Jazz').getByRole('button', { name: 'Rename' }).click()
      await page.getByLabel('Rename “Jazz”').fill('Smooth jazz')
      await page.getByRole('button', { name: 'Save' }).click()

      const renamed = row(page, 'Smooth jazz')
      await expect(renamed).toBeVisible()
      await expect(renamed.getByRole('cell').nth(1)).toHaveText('3')
      await expect(renamed.getByRole('img', { name: 'Ready' })).toBeVisible()
      await expect(page.getByLabel('Rename “Jazz”')).toHaveCount(0)
      const patchCall = detail.find((call) => call.method === 'PATCH')!
      expect(patchCall.url.pathname).toBe('/api/panel/tags/1/')
      expect(patchCall.body).toEqual({ name: 'Smooth jazz' })
    })

    test('submitting with Enter saves', async ({ page }) => {
      await openTags(page)

      await row(page, 'Hiking').getByRole('button', { name: 'Rename' }).click()
      await page.getByLabel('Rename “Hiking”').fill('Trekking')
      await page.getByLabel('Rename “Hiking”').press('Enter')

      await expect(row(page, 'Trekking')).toBeVisible()
    })

    test('renaming to an existing name shows the duplicate error and keeps editing', async ({ page }) => {
      await openTags(page)

      await row(page, 'Hiking').getByRole('button', { name: 'Rename' }).click()
      await page.getByLabel('Rename “Hiking”').fill('JAZZ')
      await page.getByRole('button', { name: 'Save' }).click()

      await expect(page.getByText('A tag with this name already exists.')).toBeVisible()
      await expect(page.getByLabel('Rename “Hiking”')).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByLabel('Rename “Hiking”')).toHaveValue('JAZZ')
    })

    test('Save is disabled for an empty name', async ({ page }) => {
      await openTags(page)

      await row(page, 'Hiking').getByRole('button', { name: 'Rename' }).click()
      await page.getByLabel('Rename “Hiking”').fill('  ')

      await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
    })

    test('Cancel and Escape leave the name unchanged', async ({ page }) => {
      const { detail } = await openTags(page)

      await row(page, 'Jazz').getByRole('button', { name: 'Rename' }).click()
      await page.getByLabel('Rename “Jazz”').fill('Changed')
      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect(row(page, 'Jazz')).toBeVisible()
      await expect(page.getByLabel('Rename “Jazz”')).toHaveCount(0)

      await row(page, 'Jazz').getByRole('button', { name: 'Rename' }).click()
      await page.getByLabel('Rename “Jazz”').fill('Changed')
      await page.getByLabel('Rename “Jazz”').press('Escape')
      await expect(row(page, 'Jazz')).toBeVisible()
      await expect(page.getByLabel('Rename “Jazz”')).toHaveCount(0)
      expect(detail).toHaveLength(0)
    })
  })

  test.describe('delete', () => {
    test('asks for confirmation first and does nothing until confirmed', async ({ page }) => {
      const { detail } = await openTags(page)

      await row(page, 'Hiking').getByRole('button', { name: 'Delete' }).click()

      const confirm = page.getByRole('group', { name: 'Delete Hiking?' })
      await expect(confirm.getByText('Delete?')).toBeVisible()
      await expect(confirm.getByRole('button', { name: 'Keep' })).toBeFocused()
      expect(detail).toHaveLength(0)
    })

    test('the confirmation warns when the tag is used by occasions', async ({ page }) => {
      await openTags(page)

      await row(page, 'Jazz').getByRole('button', { name: 'Delete' }).click()
      await expect(page.getByRole('group', { name: 'Delete Jazz?' }).getByText('Remove from 3 occasions?')).toBeVisible()
      await page.getByRole('button', { name: 'Keep' }).click()

      await row(page, 'Board games').getByRole('button', { name: 'Delete' }).click()
      await expect(
        page.getByRole('group', { name: 'Delete Board games?' }).getByText('Remove from 1 occasion?'),
      ).toBeVisible()
    })

    test('"Keep" cancels', async ({ page }) => {
      const { detail } = await openTags(page)

      await row(page, 'Hiking').getByRole('button', { name: 'Delete' }).click()
      await page.getByRole('button', { name: 'Keep' }).click()

      await expect(page.getByRole('group', { name: 'Delete Hiking?' })).toHaveCount(0)
      await expect(row(page, 'Hiking').getByRole('button', { name: 'Delete' })).toBeVisible()
      expect(detail).toHaveLength(0)
    })

    test('confirming deletes the tag and reloads the list', async ({ page }) => {
      const { detail } = await openTags(page)

      await row(page, 'Hiking').getByRole('button', { name: 'Delete' }).click()
      await page.getByRole('group', { name: 'Delete Hiking?' }).getByRole('button', { name: 'Delete' }).click()

      await expect(row(page, 'Hiking')).toHaveCount(0)
      await expect(page.getByText('2 total')).toBeVisible()
      const deleteCall = detail.find((call) => call.method === 'DELETE')!
      expect(deleteCall.url.pathname).toBe('/api/panel/tags/2/')
    })

    test('a failed delete shows the error and keeps the tag', async ({ page }) => {
      await openTags(page)
      await mockApi(page, '/api/panel/tags/2/', {
        DELETE: () => ({ status: 500, body: { detail: 'Could not delete.' } }),
      })

      await row(page, 'Hiking').getByRole('button', { name: 'Delete' }).click()
      await page.getByRole('group', { name: 'Delete Hiking?' }).getByRole('button', { name: 'Delete' }).click()

      await expect(page.getByRole('alert')).toHaveText('Could not delete.')
      await expect(row(page, 'Hiking')).toBeVisible()
    })

    test('starting a rename closes an open delete confirmation', async ({ page }) => {
      await openTags(page)

      await row(page, 'Hiking').getByRole('button', { name: 'Delete' }).click()
      await expect(page.getByRole('group', { name: 'Delete Hiking?' })).toBeVisible()
      await row(page, 'Jazz').getByRole('button', { name: 'Rename' }).click()

      await expect(page.getByRole('group', { name: 'Delete Hiking?' })).toHaveCount(0)
      await expect(page.getByLabel('Rename “Jazz”')).toBeVisible()
    })

    test('the confirm button is disabled while the delete is in flight', async ({ page }) => {
      await openTags(page)
      const gate = deferred()
      await mockApi(page, '/api/panel/tags/2/', {
        DELETE: async () => {
          await gate.promise
          return { status: 204 }
        },
      })

      await row(page, 'Hiking').getByRole('button', { name: 'Delete' }).click()
      const confirmDelete = page.getByRole('group', { name: 'Delete Hiking?' }).getByRole('button', { name: 'Delete' })
      await confirmDelete.click()

      await expect(confirmDelete).toBeDisabled()
      gate.resolve()
      await expect(confirmDelete).toHaveCount(0)
    })
  })
})
