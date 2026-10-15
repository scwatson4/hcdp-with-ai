import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, within } from '@testing-library/react'
import { NAME_KEY } from './reviewer'
import { click, posts, renderApp, setup, state, teardown, tick } from './harness.test-utils'

// F3 A + F4 A: the panel's "My feedback" (by the reviewer's name) and "Others" (titles + status only), and the rename.
const MINE = [
  { id: '1'.repeat(32), created_at: '2026-10-13T20:05:00.000Z', kind: 'selection', rating: null, feature: 'page', page_path: '/data', page_title: 'Access Data', quote: 'HCDP was founded in 2019',
    ask: null, reply: null, overview_id: null, wanted: null, text: 'The year is wrong — 2020.', reviewer_name: 'Ikaika', status: 'fixed', title: 'The year is wrong — 2020.' },
  { id: '2'.repeat(32), created_at: '2026-10-13T19:00:00.000Z', kind: 'thumbs', rating: 'up', feature: 'answer', page_path: '/mesonet', quote: null, text: null, reviewer_name: 'Ikaika', status: 'new', title: 'Thumbs up on an AI answer' },
]
const OTHERS = [
  { id: '3'.repeat(32), created_at: '2026-10-13T18:00:00.000Z', kind: 'tab', rating: null, feature: 'viewer', page_path: '/viewer/rainfall/day/2026-09-07/kauai', title: 'The legend hides the compass on my phone.', status: 'reviewed' },
  { id: '4'.repeat(32), created_at: '2026-10-13T17:00:00.000Z', kind: 'wrong_page', rating: null, feature: 'navigation', page_path: '/data', title: 'Wrong page — wanted Access Data', status: 'new' },
]
beforeEach(() => { setup(); state.mine = MINE; state.others = OTHERS })
afterEach(teardown)

const gets = (prefix) => state.calls.filter((c) => c.url.startsWith(prefix))

describe('My feedback and Others', () => {
  it('"My feedback" lists the items sent under this browser’s name with their status; a tap goes to the page', async () => {
    window.localStorage.setItem(NAME_KEY, 'Ikaika')
    renderApp('/mesonet')
    await click(screen.getByTestId('feedback-tab'))
    await click(screen.getByTestId('feedback-view-mine'))
    const panel = screen.getByTestId('feedback-panel')
    expect(panel).toHaveAttribute('data-view', 'mine')
    expect(within(panel).getByTestId('feedback-panel-title')).toHaveTextContent('My feedback')
    expect(gets('/api/feedback/mine').at(-1).url).toBe('/api/feedback/mine?name=Ikaika')
    expect(within(panel).getByTestId('reviewer-name')).toHaveTextContent('Ikaika')
    const items = within(panel).getAllByTestId('mine-item')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('“HCDP was founded in 2019”')
    expect(items[0]).toHaveTextContent('The year is wrong — 2020.')
    expect(within(items[0]).getByTestId('status-chip')).toHaveTextContent('Fixed')
    expect(items[0]).toHaveTextContent('A page'); expect(items[0]).toHaveTextContent('/data')
    expect(within(items[1]).getByTestId('status-chip')).toHaveTextContent('New')
    await click(items[0])
    expect(screen.getByTestId('probe')).toHaveTextContent('/data')
    expect(screen.queryByTestId('feedback-panel')).toBeNull()
  })

  it('"Others" shows everyone else’s titles and statuses — never a name', async () => {
    window.localStorage.setItem(NAME_KEY, 'Ikaika')
    renderApp('/data')
    await click(screen.getByTestId('feedback-tab'))
    await click(screen.getByTestId('feedback-view-others'))
    const panel = screen.getByTestId('feedback-panel')
    expect(gets('/api/feedback/others').at(-1).url).toBe('/api/feedback/others?name=Ikaika')
    const items = within(panel).getAllByTestId('others-item')
    expect(items.map((i) => within(i).getByTestId('item-title').textContent)).toEqual(['The legend hides the compass on my phone.', 'Wrong page — wanted Access Data'])
    expect(items.map((i) => within(i).getByTestId('status-chip').textContent)).toEqual(['Reviewed', 'New'])
    expect(panel).toHaveTextContent('Feedback given by other team members')
    expect(within(panel).queryByTestId('reviewer-line')).toBeNull()
  })

  it('the name can be changed there; earlier feedback follows it (rename), and the browser remembers the new one', async () => {
    window.localStorage.setItem(NAME_KEY, 'Ikaika')
    renderApp('/data')
    await click(screen.getByTestId('feedback-tab'))
    await click(screen.getByTestId('feedback-view-mine'))
    await click(screen.getByTestId('reviewer-rename'))
    const input = screen.getByTestId('reviewer-input')
    expect(input).toHaveValue('Ikaika')
    fireEvent.change(input, { target: { value: 'Ikaika K.' } })
    await click(screen.getByTestId('reviewer-save'))
    expect(state.calls.find((c) => c.url === '/api/feedback/rename').body).toEqual({ from: 'Ikaika', to: 'Ikaika K.' })
    expect(window.localStorage.getItem(NAME_KEY)).toBe('Ikaika K.')
    expect(screen.getByTestId('reviewer-name')).toHaveTextContent('Ikaika K.')
    expect(gets('/api/feedback/mine').at(-1).url).toBe('/api/feedback/mine?name=Ikaika%20K.')
    // the composer uses the new name too
    await click(screen.getByTestId('feedback-view-compose'))
    expect(screen.getByTestId('composer-name')).toHaveValue('Ikaika K.')
  })

  it('without a name, "My feedback" shows Entries (0) and the name form (no rename for a first name)', async () => {
    renderApp('/data')
    await click(screen.getByTestId('feedback-tab'))
    await click(screen.getByTestId('feedback-view-mine'))
    expect(screen.getByTestId('mine-count')).toHaveTextContent('Entries (0)')
    expect(gets('/api/feedback/mine')).toHaveLength(0)
    fireEvent.change(screen.getByTestId('reviewer-input'), { target: { value: 'Leilani' } })
    await click(screen.getByTestId('reviewer-save'))
    expect(state.calls.some((c) => c.url === '/api/feedback/rename')).toBe(false)
    expect(window.localStorage.getItem(NAME_KEY)).toBe('Leilani')
    expect(gets('/api/feedback/mine').at(-1).url).toBe('/api/feedback/mine?name=Leilani')
  })

  it('after a send, the toast’s "My feedback" opens the list', async () => {
    window.localStorage.setItem(NAME_KEY, 'Ikaika')
    renderApp('/data')
    await click(screen.getByTestId('feedback-tab'))
    fireEvent.change(screen.getByTestId('composer-text'), { target: { value: 'Nice page.' } })
    await click(screen.getByTestId('composer-send'))
    expect(posts()).toHaveLength(1)
    await click(screen.getByTestId('feedback-toast-action'))
    expect(screen.getByTestId('feedback-panel')).toHaveAttribute('data-view', 'mine')
    await tick(10)
    expect(screen.getAllByTestId('mine-item')).toHaveLength(2)
  })
})
