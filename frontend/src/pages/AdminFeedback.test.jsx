import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AdminFeedback, { KEY_STORAGE } from './AdminFeedback'
import { BACKLOG_TIP, backlogEntry } from '../feedback/backlog'

// P4 A + F3 A (13 Oct): the admin's review page behind ADMIN_KEY — one list over the reviewers' feedback and the
// visitors' "Wrong page?" reports, with filters, a status and a note per row, counts, CSV, eval cases and the backlog copy.
const ROWS = [
  { id: 'd'.repeat(32), created_at: '2026-10-13T20:10:00.000Z', kind: 'thumbs', rating: 'down', feature: 'overview', page_path: '/mesonet', page_title: 'Hawaiʻi Mesonet', quote: null,
    ask: 'station data', reply: 'Opening the Mesonet.\n\nAI Overview: This page embeds the live viewer.', overview_id: 'f'.repeat(32), wanted: { title: 'Access Data', url: '/data' },
    chose_path: null, text: 'I wanted the station CSVs.', reviewer_name: 'Ikaika', status: 'new', admin_note: null, updated_at: null },
  { id: 'c'.repeat(32), created_at: '2026-10-13T20:05:00.000Z', kind: 'selection', rating: null, feature: 'page', page_path: '/about', page_title: 'About', quote: 'The HCDP\'s founding year',
    ask: null, reply: null, overview_id: null, wanted: null, chose_path: null, text: 'The year is wrong — 2020.', reviewer_name: 'Leilani', status: 'reviewed', admin_note: 'Checking with Ryan.', updated_at: '2026-10-13T21:00:00.000Z' },
  { id: 'a'.repeat(32), created_at: '2026-10-13T20:00:00Z', kind: 'wrong_page', rating: null, feature: 'navigation', page_path: '/viewer/ignition/day/2026-10-12/statewide', page_title: null, quote: null,
    ask: 'fire', reply: 'Taking you there.', overview_id: null, wanted: { text: 'the fire risk outlook' }, chose_path: '/extreme-events/lowell', text: null, reviewer_name: null, status: 'new', admin_note: null, updated_at: null },
]
const COUNTS = { total: 3, by_status: { new: 2, reviewed: 1 }, by_kind: { thumbs: 1, selection: 1, wrong_page: 1 }, by_feature: { overview: 1, page: 1, navigation: 1 }, thumbs: { up: 4, down: 1, by_feature: {} } }
let mode, calls, writeText
const res = (status, body, text = '') => ({ ok: status < 300, status, json: async () => body, blob: async () => new Blob([text]), text: async () => text })
const fetchMock = (url, init) => {
  const body = init?.body ? JSON.parse(init.body) : null
  calls.push({ url, key: init?.headers?.['X-Admin-Key'], method: init?.method || 'GET', body })
  if (mode === 'disabled') return Promise.resolve(res(404, { detail: 'Not Found' }))
  if (init?.headers?.['X-Admin-Key'] !== 'right-key') return Promise.resolve(res(401, { detail: 'Not authorised' }))
  if (url.startsWith('/api/admin/feedback/review.csv')) return Promise.resolve(res(200, null, 'id,when\r\n'))
  if (url === '/api/admin/feedback/evals.json') return Promise.resolve(res(200, { as_of: '2026-10-14', cases: [] }))
  if (init?.method === 'DELETE') return Promise.resolve(res(200, { ok: true, id: url.split('/').pop() }))
  if (init?.method === 'PATCH') {
    const id = url.split('/').pop()
    return Promise.resolve(res(200, { ok: true, row: { ...ROWS.find((r) => r.id === id), ...body, updated_at: '2026-10-14T00:00:00.000Z' } }))
  }
  const q = new URL(url, 'http://x').searchParams
  const rows = ROWS.filter((r) => (!q.get('kind') || r.kind === q.get('kind')) && (!q.get('feature') || r.feature === q.get('feature')) && (!q.get('status') || r.status === q.get('status')))
  return Promise.resolve(res(200, { count: rows.length, counts: COUNTS, rows }))
}
const tick = async () => { await act(async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve() }) }
const mount = () => render(<MemoryRouter initialEntries={['/admin/feedback']}><AdminFeedback /></MemoryRouter>)
const enter = async (key) => { fireEvent.change(screen.getByTestId('admin-key'), { target: { value: key } }); fireEvent.submit(screen.getByTestId('admin-key-form')); await tick(); await tick() }
const open = async () => { window.sessionStorage.setItem(KEY_STORAGE, 'right-key'); mount(); await tick(); await tick() }

beforeEach(() => {
  mode = 'on'; calls = []
  vi.stubGlobal('fetch', vi.fn(fetchMock))
  window.sessionStorage.clear()
  writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('/admin/feedback', () => {
  it('asks for the key in a password field, says "Not authorised" for a wrong one, and keeps nothing', async () => {
    mount()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Feedback review')
    expect(screen.getByTestId('admin-key')).toHaveAttribute('type', 'password')
    expect(calls).toHaveLength(0)                                        // nothing is asked without a key
    await enter('wrong')
    expect(calls[0]).toMatchObject({ url: '/api/admin/feedback/review', key: 'wrong' })
    expect(screen.getByTestId('admin-unauthorised')).toHaveTextContent('Not authorised')
    expect(window.sessionStorage.getItem(KEY_STORAGE)).toBeNull()
    expect(screen.queryByTestId('admin-table')).toBeNull()
  })

  it('says the admin view is not enabled when the API answers 404 (no ADMIN_KEY on the instance)', async () => {
    mode = 'disabled'
    mount()
    await enter('anything')
    expect(screen.getByTestId('admin-disabled')).toHaveTextContent('The admin view is not enabled on this instance')
    expect(screen.queryByTestId('admin-key')).toBeNull()
  })

  it('with the right key lists both stores newest first, with the counts, and remembers the key for the tab', async () => {
    mount()
    await enter('right-key')
    expect(window.sessionStorage.getItem(KEY_STORAGE)).toBe('right-key')
    expect(screen.getByTestId('admin-counts')).toHaveTextContent('3 items')
    expect(screen.getByTestId('admin-counts')).toHaveTextContent('New 2 · Reviewed 1 · Fixed 0 · Won’t fix 0')
    expect(screen.getByTestId('admin-thumbs')).toHaveTextContent('▲ 4·▼ 1')
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['When', 'Kind', 'Feature', 'Page', 'What was said', 'Reviewer', 'Status', 'Team note', 'Actions'])
    const rows = screen.getAllByTestId('admin-row')
    expect(rows.map((r) => r.dataset.kind)).toEqual(['thumbs', 'selection', 'wrong_page'])
    const cells = (r) => within(r).getAllByRole('cell').map((c) => c.textContent)
    expect(cells(rows[0]).slice(1, 4)).toEqual(['Thumbs', 'AI Overview', 'Hawaiʻi Mesonet/mesonet'])
    expect(within(rows[0]).getByTestId('admin-rating')).toHaveTextContent('▼ down')
    expect(within(rows[0]).getByTestId('admin-text')).toHaveTextContent('I wanted the station CSVs.')
    expect(within(rows[0]).getByTestId('admin-exchange')).toHaveTextContent('“station data” → Opening the Mesonet.')
    expect(within(rows[0]).getByTestId('admin-wanted')).toHaveTextContent('Wanted Access Data /data')
    expect(cells(rows[0])[5]).toBe('Ikaika')
    expect(within(rows[1]).getByTestId('admin-quote')).toHaveTextContent('“The HCDP\'s founding year”')
    expect(within(rows[1]).getByTestId('admin-note')).toHaveValue('Checking with Ryan.')
    expect(within(rows[1]).getByTestId('admin-status')).toHaveValue('reviewed')
    expect(cells(rows[2]).slice(1, 3)).toEqual(['Wrong page?', 'Navigation result'])
    expect(within(rows[2]).getByTestId('admin-wanted')).toHaveTextContent('Wanted “the fire risk outlook”')
    expect(within(rows[2]).getByTestId('admin-chose')).toHaveTextContent('Went to instead /extreme-events/lowell')
    expect(cells(rows[0])[0]).toMatch(/Oct 13, 2026/)
    expect(screen.queryByTestId('admin-key')).toBeNull()
  })

  it('filters by kind, feature and status (the server filters; Clear filters resets)', async () => {
    await open()
    fireEvent.change(screen.getByTestId('admin-filter-kind'), { target: { value: 'thumbs' } })
    await tick()
    expect(calls.at(-1).url).toBe('/api/admin/feedback/review?kind=thumbs')
    expect(screen.getAllByTestId('admin-row')).toHaveLength(1)
    fireEvent.change(screen.getByTestId('admin-filter-feature'), { target: { value: 'overview' } })
    fireEvent.change(screen.getByTestId('admin-filter-status'), { target: { value: 'new' } })
    await tick()
    expect(calls.at(-1).url).toBe('/api/admin/feedback/review?kind=thumbs&feature=overview&status=new')
    expect(screen.getByTestId('admin-count')).toHaveTextContent('1 row shown (filtered)')
    const kinds = [...screen.getByTestId('admin-filter-kind').options].map((o) => o.textContent)
    expect(kinds).toEqual(['All', 'Thumbs', 'Selected text', 'Feedback tab', 'Wrong page?'])
    expect([...screen.getByTestId('admin-filter-status').options].map((o) => o.value)).toEqual(['', 'new', 'reviewed', 'fixed', 'wontfix'])
    fireEvent.click(screen.getByTestId('admin-filter-clear'))
    await tick()
    expect(calls.at(-1).url).toBe('/api/admin/feedback/review')
    expect(screen.getAllByTestId('admin-row')).toHaveLength(3)
  })

  it('a status is saved at once and a note on Save — PATCH with the key — on either store', async () => {
    await open()
    let rows = screen.getAllByTestId('admin-row')
    fireEvent.change(within(rows[2]).getByTestId('admin-status'), { target: { value: 'wontfix' } })
    await tick()
    expect(calls.at(-1)).toMatchObject({ url: `/api/admin/feedback/${'a'.repeat(32)}`, method: 'PATCH', key: 'right-key', body: { status: 'wontfix' } })
    rows = screen.getAllByTestId('admin-row')
    expect(within(rows[2]).getByTestId('admin-status')).toHaveValue('wontfix')
    expect(screen.getByTestId('admin-counts')).toHaveTextContent('New 1 · Reviewed 1 · Fixed 0 · Won’t fix 1')   // the counts follow
    expect(within(rows[0]).queryByTestId('admin-note-save')).toBeNull()
    fireEvent.change(within(rows[0]).getByTestId('admin-note'), { target: { value: 'Add the CSV link to the overview.' } })
    fireEvent.click(within(rows[0]).getByTestId('admin-note-save'))
    await tick()
    expect(calls.at(-1)).toMatchObject({ url: `/api/admin/feedback/${'d'.repeat(32)}`, method: 'PATCH', body: { admin_note: 'Add the CSV link to the overview.' } })
    expect(within(screen.getAllByTestId('admin-row')[0]).getByRole('status')).toHaveTextContent('Saved')
  })

  it('Delete removes an entry for good — DELETE with the key after a confirm — and the row and the counts follow', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await open()
    const rows = screen.getAllByTestId('admin-row')
    const n = rows.length
    fireEvent.click(within(rows[0]).getByTestId('admin-delete'))
    await tick()
    expect(calls.at(-1)).toMatchObject({ url: `/api/admin/feedback/${rows[0].getAttribute('data-id') || calls.at(-1).url.split('/').pop()}`, method: 'DELETE', key: 'right-key' })
    expect(screen.getAllByTestId('admin-row')).toHaveLength(n - 1)
    window.confirm.mockReturnValue(false)
    fireEvent.click(within(screen.getAllByTestId('admin-row')[0]).getByTestId('admin-delete'))
    await tick()
    expect(screen.getAllByTestId('admin-row')).toHaveLength(n - 1)                                          // a cancelled confirm deletes nothing
  })

  it('Export CSV (with the filters), Export as eval cases, Add to backlog and Forget key', async () => {
    const objectUrl = vi.fn(() => 'blob:x'); const revoke = vi.fn()
    URL.createObjectURL = objectUrl; URL.revokeObjectURL = revoke
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await open()
    fireEvent.change(screen.getByTestId('admin-filter-kind'), { target: { value: 'selection' } })
    await tick()
    await act(async () => { fireEvent.click(screen.getByTestId('admin-export')); await tick() })
    expect(calls.at(-1)).toMatchObject({ url: '/api/admin/feedback/review.csv?kind=selection', key: 'right-key' })
    await act(async () => { fireEvent.click(screen.getByTestId('admin-evals')); await tick() })
    expect(calls.at(-1)).toMatchObject({ url: '/api/admin/feedback/evals.json', key: 'right-key' })
    expect(objectUrl).toHaveBeenCalledTimes(2); expect(anchorClick).toHaveBeenCalledTimes(2)
    // Add to backlog: a ready-made team-backlog entry on the clipboard; the tooltip says where the CLI lives
    const btn = within(screen.getAllByTestId('admin-row')[0]).getByTestId('admin-backlog')
    expect(btn).toHaveAttribute('title', BACKLOG_TIP)
    expect(BACKLOG_TIP).toMatch(/another VM/)
    await act(async () => { fireEvent.click(btn); await tick() })
    const copied = writeText.mock.calls[0][0]
    expect(copied).toMatch(/^docker exec hcdp-team-backlog python \/app\/cli\.py add --actor 'HCDP website feedback' --id FB-20261013-cccccccc --category general-ui --title /)
    expect(copied).toContain('Quote: “The HCDP'); expect(copied).toContain('Page: About (/about).')
    expect(btn).toHaveTextContent('Copied')
    fireEvent.click(screen.getByTestId('admin-forget'))
    expect(window.sessionStorage.getItem(KEY_STORAGE)).toBeNull()
    expect(screen.getByTestId('admin-key')).toBeInTheDocument()
  })
})

describe('the backlog entry', () => {
  it('carries the quote, the page, the ask, the reply and the wanted page, quoted for the shell', () => {
    const e = backlogEntry(ROWS[0])
    expect(e.id).toBe(`FB-20261013-${'d'.repeat(8)}`)
    expect(e.category).toBe('ai-behavior')
    expect(e.title).toBe('Website feedback · AI Overview: I wanted the station CSVs.')
    expect(e.summary).toContain('(2026-10-13, Ikaika; 👎 on an AI Overview)')
    expect(e.summary).toContain('Page: Hawaiʻi Mesonet (/mesonet).')
    expect(e.summary).toContain('Asked: “station data”.')
    expect(e.summary).toContain('AI reply: “Opening the Mesonet. AI Overview: This page embeds the live viewer.”.')
    expect(e.summary).toContain('Wanted: Access Data (/data).')
    expect(e.summary).toContain(`Feedback id ${'d'.repeat(32)}.`)
    const w = backlogEntry(ROWS[2])
    expect(w.summary).toContain('anonymous; “Wrong page?” under an AI overview')
    expect(w.summary).toContain('Wanted: “the fire risk outlook”.')
    expect(w.summary).toContain('Went to instead: /extreme-events/lowell.')
    expect(w.title).toBe('Website feedback · Navigation result: wanted the fire risk outlook')
    // a quote inside the text survives the shell quoting
    expect(backlogEntry(ROWS[1]).command).toContain(`The HCDP'"'"'s founding year`)
  })
})
