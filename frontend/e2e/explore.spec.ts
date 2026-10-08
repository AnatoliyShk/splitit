import { expect, test, type Page } from '@playwright/test'
import { exploreBody, makeOccasion, mockApi, USER, type TestOccasion } from './fixtures/user'

const occasions: TestOccasion[] = [
  makeOccasion(11, 'Rooftop Yoga', 1, { attendees_count: 0, tags: ['wellness'] }),
  makeOccasion(12, 'Board Game Night', 3, { attendees_count: 1, tags: ['games', 'social'] }),
  makeOccasion(13, 'Hike Day', 6, { attendees_count: 8 }),
]

const join = (id: number) => `POST /api/occasions/${id}/join/`
// Tags and who's going are folded away on each card until this is clicked
const showDetails = (page: Page) => page.getByRole('button', { name: 'Show details' }).click()
// The Filters button by the title opens the modal, which holds the saved filters and their on/off switch
const filtersToggle = (page: Page) => page.getByRole('button', { name: 'Filters', exact: true })
const filtersModal = (page: Page) => page.getByRole('dialog', { name: 'Filters' })

test('redirects to the login page when logged out', async ({ page }) => {
  await mockApi(page, { user: null })
  await page.goto('/explore')
  await expect(page).toHaveURL(/\/login$/)
})

test.describe('browsing', () => {
  test('shows the first occasion with its tags', async ({ page }) => {
    await mockApi(page, { user: USER, explore: occasions })
    await page.goto('/explore')

    await expect(page.getByRole('heading', { level: 1, name: 'Explore' })).toBeVisible()
    const card = page.getByRole('article', { name: 'Rooftop Yoga' })
    await expect(card).toBeVisible()
    await showDetails(page)
    await expect(card.getByText('wellness', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Decline' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Accept' })).toBeEnabled()
  })

  test("does not draw the occasion's name, but still names the card and opens the occasion on click", async ({ page }) => {
    await mockApi(page, { user: USER, explore: occasions })
    await page.goto('/explore')

    const card = page.getByRole('article', { name: 'Rooftop Yoga' })
    await expect(card).toBeVisible()
    // Zero-size text: the name takes no room on the card
    const nameBox = await card.getByRole('heading', { name: 'Rooftop Yoga' }).boundingBox()
    expect(nameBox?.height ?? 0).toBe(0)
    await expect(card.getByRole('link', { name: 'Rooftop Yoga' })).toHaveAttribute('href', /\/occasions\/\d+$/)

    await card.locator('.explore-title').click()
    await expect(page).toHaveURL(/\/occasions\/\d+$/)
  })

  test('shows who is going by gender, with the exact numbers on hover', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      explore: [makeOccasion(11, 'Rooftop Yoga', 1, { attendees_count: 6, gender_counts: { man: 3, woman: 2, undisclosed: 1 } })],
    })
    await page.goto('/explore')

    const bar = page.getByRole('group', { name: 'Who is going, by gender' })
    const men = bar.getByRole('img', { name: '3 men' })
    const women = bar.getByRole('img', { name: '2 women' })
    await expect(bar.getByRole('img', { name: '1 did not say' })).toBeVisible()
    // Left to right: the male icon, the line, the female icon
    expect((await men.boundingBox())!.x).toBeLessThan((await women.boundingBox())!.x)

    await expect(men.getByText('3 men')).toBeHidden()
    await men.hover()
    await expect(men.getByText('3 men')).toBeVisible()
    await women.hover()
    await expect(women.getByText('2 women')).toBeVisible()
    await expect(men.getByText('3 men')).toBeHidden()
  })

  test('sizes the line by the counts', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      explore: [makeOccasion(11, 'Rooftop Yoga', 1, { attendees_count: 4, gender_counts: { man: 3, woman: 0, undisclosed: 1 } })],
    })
    await page.goto('/explore')

    const widthOf = async (kind: string) => (await page.locator(`.gender-segment-${kind}`).boundingBox())!.width
    const manWidth = await widthOf('man')
    const undisclosedWidth = await widthOf('undisclosed')
    expect(manWidth / undisclosedWidth).toBeCloseTo(3, 0)
    expect(await widthOf('woman')).toBe(0)
  })

  test('words one man and one woman in the singular', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      explore: [makeOccasion(11, 'Rooftop Yoga', 1, { attendees_count: 2, gender_counts: { man: 1, woman: 1, undisclosed: 0 } })],
    })
    await page.goto('/explore')

    await expect(page.getByRole('img', { name: '1 man', exact: true })).toBeVisible()
    await expect(page.getByRole('img', { name: '1 woman', exact: true })).toBeVisible()
  })

  test('hides the gender line while nobody is going', async ({ page }) => {
    await mockApi(page, { user: USER, explore: [makeOccasion(11, 'Rooftop Yoga', 1, { attendees_count: 0 })] })
    await page.goto('/explore')

    await expect(page.getByRole('article', { name: 'Rooftop Yoga' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Who is going, by gender' })).toHaveCount(0)
  })

  test('words the attendee count for none, one and many', async ({ page }) => {
    await mockApi(page, { user: USER, explore: occasions })
    await page.goto('/explore')

    await showDetails(page)
    await expect(page.getByText('Nobody is going yet. Be the first!')).toBeVisible()
    await page.getByRole('button', { name: 'Decline' }).click()
    // Each new card starts folded again
    await showDetails(page)
    await expect(page.getByText('1 person is going')).toBeVisible()
    await page.getByRole('button', { name: 'Decline' }).click()
    await showDetails(page)
    await expect(page.getByText('8 people are going')).toBeVisible()
  })

  test('shows a card without tags for an untagged occasion', async ({ page }) => {
    await mockApi(page, { user: USER, explore: [makeOccasion(13, 'Hike Day', 6, { attendees_count: 8 })] })
    await page.goto('/explore')
    const card = page.getByRole('article', { name: 'Hike Day' })
    await expect(card).toBeVisible()
    await expect(card.locator('.tag')).toHaveCount(0)
  })

  test('keeps tags and who is going folded away until Show details is clicked', async ({ page }) => {
    await mockApi(page, { user: USER, explore: occasions })
    await page.goto('/explore')
    const card = page.getByRole('article', { name: 'Rooftop Yoga' })
    const toggle = card.getByRole('button', { name: 'Show details' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(card.getByText('wellness', { exact: true })).toBeHidden()
    await expect(card.getByText('Nobody is going yet. Be the first!')).toBeHidden()

    await toggle.click()
    const hideToggle = card.getByRole('button', { name: 'Hide details' })
    await expect(hideToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(card.getByText('wellness', { exact: true })).toBeVisible()
    await expect(card.getByText('Nobody is going yet. Be the first!')).toBeVisible()
    // The button opens the details, not the occasion page under the card's link
    await expect(page).toHaveURL(/\/explore$/)

    await hideToggle.click()
    await expect(card.getByText('wellness', { exact: true })).toBeHidden()
    await expect(card.getByRole('button', { name: 'Show details' })).toHaveAttribute('aria-expanded', 'false')
  })

  test('shows an alert when the occasions cannot be loaded', async ({ page }) => {
    await mockApi(page, { user: USER, explore: 500 })
    await page.goto('/explore')
    await expect(page.getByRole('alert')).toHaveText('Mocked failure.')
    await expect(page.getByText('Loading…')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0)
  })
})

test.describe('description', () => {
  // 130 characters, so a closed card cuts it after 100
  const longDescription =
    'Bring a mat and water. We start with ten minutes of breathing, then a slow flow for all levels; tea after on the terrace.'
  const preview = `${longDescription.slice(0, 100).trimEnd()}…`

  test('shows a short description whole', async ({ page }) => {
    await mockApi(page, { user: USER, explore: [makeOccasion(11, 'Rooftop Yoga', 1, { description: 'Bring a mat.' })] })
    await page.goto('/explore')
    const card = page.getByRole('article', { name: 'Rooftop Yoga' })
    await expect(card.getByText('Bring a mat.', { exact: true })).toBeVisible()
    // Not repeated in the details
    await showDetails(page)
    await expect(card.getByText('Bring a mat.', { exact: true })).toHaveCount(1)
  })

  test('shows the first 100 characters of a long one, and all of it under Show details', async ({ page }) => {
    await mockApi(page, { user: USER, explore: [makeOccasion(11, 'Rooftop Yoga', 1, { description: longDescription })] })
    await page.goto('/explore')
    const card = page.getByRole('article', { name: 'Rooftop Yoga' })
    await expect(card.getByText(preview, { exact: true })).toBeVisible()
    await expect(card.getByText(longDescription, { exact: true })).toBeHidden()

    await showDetails(page)
    await expect(card.getByText(longDescription, { exact: true })).toBeVisible()
    await expect(card.getByText(preview, { exact: true })).toBeHidden()

    await card.getByRole('button', { name: 'Hide details' }).click()
    await expect(card.getByText(preview, { exact: true })).toBeVisible()
  })

  test('shows nothing for an occasion without one', async ({ page }) => {
    await mockApi(page, { user: USER, explore: [makeOccasion(11, 'Rooftop Yoga', 1)] })
    await page.goto('/explore')
    await expect(page.getByRole('article', { name: 'Rooftop Yoga' }).locator('.explore-description')).toHaveCount(0)
  })
})

test.describe('people you know', () => {
  const known = (...names: string[]) =>
    names.map((name, i) => ({ uuid: `0190a1b2-0000-7000-8000-00000000000${i}`, name }))

  test('names the attendees the user has a connection with', async ({ page }) => {
    const deck = [makeOccasion(11, 'Rooftop Yoga', 1, { attendees_count: 2, known_attendees: known('Grace Hopper') })]
    await mockApi(page, { user: USER, explore: deck })
    await page.goto('/explore')
    const card = page.getByRole('article', { name: 'Rooftop Yoga' })
    await showDetails(page)
    await expect(card.getByText('2 people are going')).toBeVisible()
    await expect(card.getByText('You know 1 of them: Grace Hopper')).toBeVisible()
  })

  test('collapses long lists and says when the user knows everyone', async ({ page }) => {
    const names = known('Alan', 'Barbara', 'Claude', 'Dennis')
    const deck = [makeOccasion(11, 'Rooftop Yoga', 1, { attendees_count: 4, known_attendees: names })]
    await mockApi(page, { user: USER, explore: deck })
    await page.goto('/explore')
    await showDetails(page)
    await expect(page.getByText(/You know all of them: Alan, Barbara, Claude,? and 1 more/)).toBeVisible()
  })

  test('says nothing when the user knows nobody going', async ({ page }) => {
    await mockApi(page, { user: USER, explore: occasions })
    await page.goto('/explore')
    await showDetails(page)
    await expect(page.getByText(/You know/)).toHaveCount(0)
  })
})

test.describe('decline', () => {
  test('skips to the next occasion without calling the API', async ({ page }) => {
    const mock = await mockApi(page, { user: USER, explore: occasions })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Decline' }).click()

    await expect(page.getByRole('article', { name: 'Board Game Night' })).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Skipped Rooftop Yoga')
    expect(mock.requests.filter((request) => request.startsWith('POST'))).toEqual([])
  })
})

test.describe('one occasion at a time', () => {
  test('explains the rule in a tooltip by the title', async ({ page }) => {
    await mockApi(page, { user: USER, explore: occasions })
    await page.goto('/explore')
    const info = page.getByRole('button', { name: 'About one occasion at a time' })
    const rule = page.getByRole('tooltip')
    await expect(rule).toBeHidden()

    await info.hover()
    await expect(rule).toBeVisible()
    await expect(rule).toContainText('Once it ends or is cancelled, you can pick your next one.')
    await page.mouse.move(0, 400)
    await expect(rule).toBeHidden()

    await info.focus()
    await page.keyboard.press('Escape')
    await expect(rule).toBeHidden()
  })

  test('opens the tooltip on click and closes it on a click elsewhere', async ({ page }) => {
    await mockApi(page, { user: USER, explore: occasions })
    await page.goto('/explore')
    const rule = page.getByRole('tooltip')
    await page.getByRole('button', { name: 'About one occasion at a time' }).click()
    await expect(rule).toBeVisible()
    await page.getByRole('heading', { level: 1, name: 'Explore' }).click()
    await expect(rule).toBeHidden()
  })

  test('shows the active occasion instead of the deck', async ({ page }) => {
    const active = makeOccasion(21, 'Pottery Class', 4, { attendees_count: 4, tags: ['crafts'] })
    await mockApi(page, { user: USER, active, occasions: [], connections: [] })
    await page.goto('/explore')

    await expect(page.getByText("You're going to", { exact: true })).toBeVisible()
    const card = page.getByRole('article', { name: 'Pottery Class' })
    await expect(card).toBeVisible()
    await showDetails(page)
    await expect(card.getByText('crafts', { exact: true })).toBeVisible()
    await expect(card.getByText('You and 3 others are going')).toBeVisible()
    await expect(page.getByText(/You can join your next occasion once this one ends .* or if it's cancelled/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'About one occasion at a time' })).toBeVisible()

    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Decline' })).toHaveCount(0)
    await expect(page.getByText(/\d of \d/)).toHaveCount(0)
    await page.getByRole('link', { name: 'Your occasions' }).click()
    await expect(page).toHaveURL(/\/profile$/)
  })

  test('words a lone attendee as the first one going', async ({ page }) => {
    await mockApi(page, { user: USER, active: makeOccasion(21, 'Pottery Class', 4, { attendees_count: 1 }) })
    await page.goto('/explore')
    await showDetails(page)
    await expect(page.getByText("You're the first one going")).toBeVisible()
  })

  test('says one other person in the singular', async ({ page }) => {
    await mockApi(page, { user: USER, active: makeOccasion(21, 'Pottery Class', 4, { attendees_count: 2 }) })
    await page.goto('/explore')
    await showDetails(page)
    await expect(page.getByText('You and 1 other person are going')).toBeVisible()
  })

  test('a refused join shows the alert and the occasion the user is already going to', async ({ page }) => {
    const active = makeOccasion(21, 'Pottery Class', 4, { attendees_count: 2 })
    let refused = false
    await mockApi(page, {
      user: USER,
      handlers: {
        // Nothing active at first (joined in another tab since); the reload after the 409 sees it
        'GET /api/occasions/explore/': (route) =>
          route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(exploreBody(refused ? { active } : { explore: occasions })),
          }),
        [join(11)]: (route) => {
          refused = true
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              detail: "You're already going to Pottery Class. You can join another occasion once it ends or is cancelled.",
            }),
          })
        },
      },
    })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Accept' }).click()

    await expect(page.getByRole('alert')).toHaveText(
      "You're already going to Pottery Class. You can join another occasion once it ends or is cancelled.",
    )
    await expect(page.getByRole('article', { name: 'Pottery Class' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0)
  })
})

test.describe('accept', () => {
  test('joins the occasion and shows it as the one the user is going to', async ({ page }) => {
    const mock = await mockApi(page, {
      user: USER,
      explore: occasions,
      handlers: { [join(11)]: (route) => route.fulfill({ status: 204 }) },
    })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Accept' }).click()

    await expect(page.getByText("You're going to", { exact: true })).toBeVisible()
    const card = page.getByRole('article', { name: 'Rooftop Yoga' })
    await showDetails(page)
    await expect(card.getByText("You're the first one going")).toBeVisible()
    await expect(page.getByRole('status')).toHaveText("You're going to Rooftop Yoga")
    // The rest of the deck is paused
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0)
    await expect(page.getByRole('article', { name: 'Board Game Night' })).toHaveCount(0)
    await expect(page.getByText('1 of 3')).toHaveCount(0)
    expect(mock.requests).toContain(join(11))
  })

  test('disables both buttons and shows Joining while the request is pending', async ({ page }) => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    await mockApi(page, {
      user: USER,
      explore: occasions,
      handlers: {
        [join(11)]: async (route) => {
          await gate
          await route.fulfill({ status: 204 })
        },
      },
    })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Accept' }).click()

    await expect(page.getByRole('button', { name: 'Joining…' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Decline' })).toBeDisabled()
    release()
    await expect(page.getByText("You're going to", { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Accept|Joining/ })).toHaveCount(0)
  })

  test('stays on the same occasion and shows an alert when joining fails', async ({ page }) => {
    const mock = await mockApi(page, {
      user: USER,
      explore: occasions,
      handlers: {
        [join(11)]: (route) =>
          route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ detail: 'No Occasion matches the given query.' }),
          }),
      },
    })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Accept' }).click()

    await expect(page.getByRole('alert')).toHaveText('No Occasion matches the given query.')
    await expect(page.getByRole('article', { name: 'Rooftop Yoga' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Accept' })).toBeEnabled()
    expect(mock.requests).toContain(join(11))
  })

  test('clears the alert after declining the occasion that failed', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      explore: occasions,
      handlers: {
        [join(11)]: (route) =>
          route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Gone.' }) }),
      },
    })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Accept' }).click()
    await expect(page.getByRole('alert')).toHaveText('Gone.')

    await page.getByRole('button', { name: 'Decline' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('article', { name: 'Board Game Night' })).toBeVisible()
  })

  test('tells the user when the server cannot be reached', async ({ page }) => {
    await mockApi(page, { user: USER, explore: occasions, handlers: { [join(11)]: (route) => route.abort() } })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Accept' }).click()
    await expect(page.getByRole('alert')).toHaveText("Can't reach the server. Check your connection and try again.")
    await expect(page.getByRole('article', { name: 'Rooftop Yoga' })).toBeVisible()
  })
})

test.describe('cancelled occasions', () => {
  const explore = 'GET /api/occasions/explore/'

  test('drops an occasion that was cancelled after the deck loaded when joining it fails', async ({ page }) => {
    let deck = occasions
    await mockApi(page, {
      user: USER,
      handlers: {
        [explore]: (route) => route.fulfill({ json: { active_occasion: null, occasions: deck } }),
        [join(11)]: (route) => {
          deck = occasions.slice(1)
          return route.fulfill({ status: 404, json: { detail: 'This occasion is no longer available.' } })
        },
      },
    })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Accept' }).click()

    await expect(page.getByRole('alert')).toHaveText('This occasion is no longer available.')
    await expect(page.getByRole('article', { name: 'Board Game Night' })).toBeVisible()
  })

  test('refreshes when the user comes back to the page, keeping declined occasions skipped', async ({ page }) => {
    let deck = occasions
    await mockApi(page, {
      user: USER,
      handlers: { [explore]: (route) => route.fulfill({ json: { active_occasion: null, occasions: deck } }) },
    })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Decline' }).click()
    await expect(page.getByRole('article', { name: 'Board Game Night' })).toBeVisible()

    // Board Game Night is cancelled while the tab is in the background
    deck = [occasions[0], occasions[2]]
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })))

    await expect(page.getByRole('article', { name: 'Hike Day' })).toBeVisible()
  })

  test('shows the deck again when the active occasion is cancelled', async ({ page }) => {
    let active: TestOccasion | null = makeOccasion(21, 'Pottery Class', 4)
    await mockApi(page, {
      user: USER,
      handlers: {
        [explore]: (route) =>
          route.fulfill({ json: { active_occasion: active, occasions: active ? [] : occasions } }),
      },
    })
    await page.goto('/explore')
    await expect(page.getByText("You're going to", { exact: true })).toBeVisible()

    active = null
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })))

    await expect(page.getByRole('article', { name: 'Rooftop Yoga' })).toBeVisible()
    await expect(page.getByText("You're going to", { exact: true })).toHaveCount(0)
  })
})

test.describe('end of the list', () => {
  test('shows "all caught up" after declining every occasion', async ({ page }) => {
    const mock = await mockApi(page, { user: USER, explore: occasions })
    await page.goto('/explore')
    await page.getByRole('button', { name: 'Decline' }).click()
    await page.getByRole('button', { name: 'Decline' }).click()
    await page.getByRole('button', { name: 'Decline' }).click()

    await expect(page.getByRole('heading', { name: "You're all caught up" })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Decline' })).toHaveCount(0)
    await expect(page.getByText(/\d of 3/)).toHaveCount(0)
    expect(mock.requests.filter((request) => request.startsWith('POST'))).toEqual([])
  })

  test('shows the empty state when there are no new occasions', async ({ page }) => {
    await mockApi(page, { user: USER, explore: [] })
    await page.goto('/explore')
    await expect(page.getByRole('heading', { name: 'No new occasions right now' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0)
  })

  test('links on to the profile from the done state', async ({ page }) => {
    await mockApi(page, { user: USER, explore: [], occasions: [], connections: [] })
    await page.goto('/explore')
    await page.getByRole('link', { name: 'Your occasions' }).click()
    await expect(page).toHaveURL(/\/profile$/)
  })
})

test.describe('filters', () => {
  const tags = [
    { id: 1, name: 'games' },
    { id: 2, name: 'wellness' },
  ]
  const exploreRequests = (requests: string[]) =>
    requests.filter((request) => request === 'GET /api/occasions/explore/').length

  test('shows just a Filters button by the title, with the modal closed', async ({ page }) => {
    await mockApi(page, { user: USER, explore: occasions, tags })
    await page.goto('/explore')
    await expect(page.locator('.explore-head').getByRole('button', { name: 'Filters', exact: true })).toBeVisible()
    await expect(filtersToggle(page)).toHaveAccessibleDescription('All occasions')
    await expect(filtersToggle(page)).not.toHaveAttribute('data-applied')
    await expect(filtersToggle(page)).toHaveAttribute('aria-haspopup', 'dialog')
    await expect(filtersModal(page)).toBeHidden()
    await expect(page.getByRole('checkbox', { name: 'Monday' })).toBeHidden()
  })

  test('opens the filters in a modal that Escape and the close button dismiss without saving', async ({ page }) => {
    const mock = await mockApi(page, { user: USER, explore: occasions, tags })
    await page.goto('/explore')

    await filtersToggle(page).click()
    await expect(filtersModal(page)).toBeVisible()
    await expect(filtersModal(page).getByRole('group', { name: 'Tags' })).toBeVisible()
    await expect(filtersModal(page).getByRole('group', { name: 'Days' })).toBeVisible()
    await page.getByRole('checkbox', { name: 'Monday' }).check()
    await page.keyboard.press('Escape')
    await expect(filtersModal(page)).toBeHidden()
    // Focus goes back to the button that opened it
    await expect(filtersToggle(page)).toBeFocused()

    // Reopening starts from what's saved, so the unsaved Monday is gone
    await filtersToggle(page).click()
    await expect(page.getByRole('checkbox', { name: 'Monday' })).not.toBeChecked()
    await filtersModal(page).getByRole('button', { name: 'Close' }).click()
    await expect(filtersModal(page)).toBeHidden()
    expect(mock.requests.filter((request) => request.startsWith('PUT'))).toEqual([])
  })

  test('saves the chosen tags and days and reloads the deck', async ({ page }) => {
    const mock = await mockApi(page, { user: USER, explore: occasions, tags })
    await page.goto('/explore')
    await expect(page.getByRole('article', { name: 'Rooftop Yoga' })).toBeVisible()

    await filtersToggle(page).click()
    const save = page.getByRole('button', { name: 'Save filters' })
    await expect(save).toBeDisabled()
    await page.getByRole('group', { name: 'Tags' }).getByText('wellness', { exact: true }).click()
    await page.getByRole('checkbox', { name: 'Saturday' }).check()
    await page.getByRole('checkbox', { name: 'Sunday' }).check()
    const requestsBeforeSave = exploreRequests(mock.requests)
    await save.click()

    // Saving closes the modal
    await expect(filtersModal(page)).toBeHidden()
    expect(mock.bodies[`PUT /api/users/${USER.uuid}/filter-preference/`]).toEqual({ tag_ids: [2], weekdays: [6, 7], is_enabled: true })
    await expect(filtersToggle(page)).toHaveAccessibleDescription('Tags: wellness. Days: Sat, Sun.')
    await expect(filtersToggle(page)).toHaveAttribute('data-applied', 'true')
    expect(exploreRequests(mock.requests)).toBeGreaterThan(requestsBeforeSave)
  })

  test('opens with the saved filters checked, and Clear unchecks them', async ({ page }) => {
    const mock = await mockApi(page, {
      user: USER,
      explore: occasions,
      tags,
      filters: { tags: [tags[0]], weekdays: [5] },
    })
    await page.goto('/explore')
    await expect(filtersToggle(page)).toHaveAccessibleDescription('Tags: games. Days: Fri.')

    await filtersToggle(page).click()
    await expect(page.getByRole('checkbox', { name: 'games' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'wellness' })).not.toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Friday' })).toBeChecked()

    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(page.getByRole('checkbox', { name: 'games' })).not.toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Friday' })).not.toBeChecked()
    await page.getByRole('button', { name: 'Save filters' }).click()
    await expect(filtersToggle(page)).toHaveAccessibleDescription('All occasions')
    expect(mock.bodies[`PUT /api/users/${USER.uuid}/filter-preference/`]).toEqual({ tag_ids: [], weekdays: [], is_enabled: true })
  })

  test('describes every saved tag and day on the button, lilac while they apply', async ({ page }) => {
    const savedTags = [
      { id: 1, name: 'games' },
      { id: 3, name: 'music' },
      { id: 2, name: 'wellness' },
    ]
    await mockApi(page, { user: USER, explore: occasions, tags, filters: { tags: savedTags, weekdays: [7, 6] } })
    await page.goto('/explore')
    // Screen readers hear what's saved along with the button
    await expect(filtersToggle(page)).toHaveAccessibleDescription('Tags: games, music, wellness. Days: Sat, Sun.')
    await expect(filtersToggle(page)).toHaveAttribute('data-applied', 'true')
  })

  test('the switch in the modal turns the saved filters off and on, keeping them', async ({ page }) => {
    const mock = await mockApi(page, {
      user: USER,
      explore: occasions,
      tags,
      filters: { tags: [tags[1]], weekdays: [6] },
    })
    await page.goto('/explore')
    // Not on the page itself any more
    await expect(page.getByRole('switch')).toHaveCount(0)
    await filtersToggle(page).click()
    const filtersSwitch = filtersModal(page).getByRole('switch', { name: 'Use these filters' })
    await expect(filtersSwitch).toBeChecked()
    const requestsBeforeOff = exploreRequests(mock.requests)

    await filtersSwitch.click()
    await expect(filtersSwitch).not.toBeChecked()
    expect(mock.bodies[`PATCH /api/users/${USER.uuid}/filter-preference/`]).toEqual({ is_enabled: false })
    // The choices stay, the deck reloads without them and the button stops being lilac
    await expect(filtersToggle(page)).toHaveAccessibleDescription('Off. Tags: wellness. Days: Sat.')
    await expect(filtersToggle(page)).not.toHaveAttribute('data-applied')
    await expect(page.getByRole('checkbox', { name: 'wellness' })).toBeChecked()
    await expect.poll(() => exploreRequests(mock.requests)).toBeGreaterThan(requestsBeforeOff)
    // Flipping the switch leaves the modal open
    await expect(filtersModal(page)).toBeVisible()

    // Keyboard works too
    await filtersSwitch.focus()
    await page.keyboard.press('Space')
    await expect(filtersSwitch).toBeChecked()
    expect(mock.bodies[`PATCH /api/users/${USER.uuid}/filter-preference/`]).toEqual({ is_enabled: true })
    await expect(filtersToggle(page)).toHaveAttribute('data-applied', 'true')
  })

  test('shows the switch disabled while nothing is saved', async ({ page }) => {
    await mockApi(page, { user: USER, explore: occasions, tags })
    await page.goto('/explore')
    await filtersToggle(page).click()
    const filtersSwitch = filtersModal(page).getByRole('switch', { name: 'Use these filters' })
    await expect(filtersSwitch).toBeVisible()
    await expect(filtersSwitch).toBeDisabled()
    await expect(filtersSwitch).not.toBeChecked()
    await expect(filtersModal(page)).toContainText('Save some tags or days first')
  })

  test('switches back when turning the filters off fails', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      explore: occasions,
      tags,
      filters: { tags: [tags[1]], weekdays: [] },
      handlers: {
        [`PATCH /api/users/${USER.uuid}/filter-preference/`]: (route) =>
          route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail": "Mocked failure."}' }),
      },
    })
    await page.goto('/explore')
    await filtersToggle(page).click()
    const filtersSwitch = page.getByRole('switch', { name: 'Use these filters' })
    await filtersSwitch.click()
    await expect(filtersModal(page).getByRole('alert')).toHaveText('Mocked failure.')
    await expect(filtersSwitch).toBeChecked()
  })

  test('does not say "no match" while the filters are off', async ({ page }) => {
    await mockApi(page, { user: USER, explore: [], tags, filters: { tags: [tags[0]], weekdays: [], is_enabled: false } })
    await page.goto('/explore')
    await expect(page.getByRole('heading', { name: 'No new occasions right now' })).toBeVisible()
  })

  test('says when no occasion matches the saved filters', async ({ page }) => {
    await mockApi(page, { user: USER, explore: [], tags, filters: { tags: [tags[0]], weekdays: [] } })
    await page.goto('/explore')
    await expect(page.getByRole('heading', { name: 'No occasions match your filters' })).toBeVisible()
  })

  test('keeps the modal open with an alert when saving fails', async ({ page }) => {
    await mockApi(page, {
      user: USER,
      explore: occasions,
      tags,
      handlers: {
        [`PUT /api/users/${USER.uuid}/filter-preference/`]: (route) =>
          route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail": "Mocked failure."}' }),
      },
    })
    await page.goto('/explore')
    await filtersToggle(page).click()
    await page.getByRole('checkbox', { name: 'Monday' }).check()
    await page.getByRole('button', { name: 'Save filters' }).click()
    await expect(filtersModal(page).getByRole('alert')).toHaveText('Mocked failure.')
    await expect(page.getByRole('checkbox', { name: 'Monday' })).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(filtersToggle(page)).toHaveAccessibleDescription('All occasions')
  })

  test('are hidden while an occasion is active', async ({ page }) => {
    await mockApi(page, { user: USER, active: makeOccasion(21, 'Pottery Class', 4), tags })
    await page.goto('/explore')
    await expect(page.getByRole('article', { name: 'Pottery Class' })).toBeVisible()
    await expect(filtersToggle(page)).toHaveCount(0)
  })

  test('are hidden when the saved filters cannot be loaded', async ({ page }) => {
    await mockApi(page, { user: USER, explore: occasions, filters: 500 })
    await page.goto('/explore')
    await expect(page.getByRole('article', { name: 'Rooftop Yoga' })).toBeVisible()
    await expect(filtersToggle(page)).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('sits by the title without changing the header height', async ({ page }) => {
    await mockApi(page, { user: USER, explore: occasions, tags })
    await page.goto('/explore')
    const heading = page.getByRole('heading', { level: 1, name: 'Explore' })
    const button = filtersToggle(page)
    await expect(button).toBeVisible()
    const headingBox = (await heading.boundingBox())!
    const buttonBox = (await button.boundingBox())!
    // Same row as the title, and big enough to tap
    expect(Math.abs(buttonBox.y + buttonBox.height / 2 - (headingBox.y + headingBox.height / 2))).toBeLessThan(headingBox.height)
    expect(buttonBox.height).toBeGreaterThanOrEqual(44)
  })
})

test.describe('loading', () => {
  test('shows a spinner until the occasions have loaded', async ({ page }) => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    await mockApi(page, {
      user: USER,
      explore: occasions,
      handlers: {
        'GET /api/occasions/explore/': async (route) => {
          await gate
          await route.fulfill({ json: exploreBody({ explore: occasions }) })
        },
      },
    })
    await page.goto('/explore')

    await expect(page.getByRole('status').filter({ hasText: 'Loading occasions' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0)

    release()
    await expect(page.getByRole('article', { name: 'Rooftop Yoga' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Loading occasions' })).toHaveCount(0)
  })
})
