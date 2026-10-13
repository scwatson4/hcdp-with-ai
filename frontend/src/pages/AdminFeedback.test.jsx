import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AdminFeedback, { KEY_STORAGE } from './AdminFeedback'

// P4 A (13 Oct): the admin page behind ADMIN_KEY.
const ROWS = [
  { id: 'b'.repeat(32), created_at: '2026-10-13T20:05:00Z', ask: 'rain', reply: 'Opening the map.', destination: '/data', overview_id: null, wanted_title: null, wanted_url: null, wanted_text: 'the Lowell wind map', chose_path: '/extreme-events/lowell', chose_at: '2026-10-13T20:06:00Z' },
  { id: 'a'.repeat(32), created_at: '2026-10-13T20:00:00Z', ask: 'fire', reply: 'Taking you there.', destination: '/viewer/ignition/day/2026-10-12/statewide', overview_id: 'f'.repeat(32), wanted_title: 'Access Data', wanted_url: '/data', wanted_text: null, chose_path: null, chose_at: null },
]
let mode, calls
const res = (status, body, text = '') => ({ ok: status < 300, status, json: async () => body, blob: async () => new Blob([text], { type: 'text/csv' }), text: async () => text })
const fetchMock = (url, init) => {
  calls.push({ url, key: init?.headers?.['X-Admin-Key'] })
  if (mode === 'disabled') return Promise.resolve(res(404, { detail: 'Not Found' }))
  if (init?.headers?.['X-Admin-Key'] !== 'right-key') return Promise.resolve(res(401, { detail: 'Not authorised' }))
  if (url === '/api/admin/feedback.csv') return Promise.resolve(res(200, null, 'id,when\r\n'))
  return Promise.resolve(res(200, { count: 2, rows: ROWS }))
}
const tick = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
const mount = () => render(<MemoryRouter initialEntries={['/admin/feedback']}><AdminFeedback /></MemoryRouter>)
const enter = async (key) => { fireEvent.change(screen.getByTestId('admin-key'), { target: { value: key } }); fireEvent.submit(screen.getByTestId('admin-key-form')); await tick(); await tick() }

beforeEach(() => { mode = 'on'; calls = []; vi.stubGlobal('fetch', vi.fn(fetchMock)); window.sessionStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('/admin/feedback', () => {
  it('asks for the key in a password field, says "Not authorised" for a wrong one, and keeps nothing', async () => {
    mount()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Wrong-page feedback')
    expect(screen.getByTestId('admin-key')).toHaveAttribute('type', 'password')
    expect(calls).toHaveLength(0)                                        // nothing is asked without a key
    await enter('wrong')
    expect(calls[0]).toEqual({ url: '/api/admin/feedback', key: 'wrong' })
    expect(screen.getByTestId('admin-unauthorised')).toHaveTextContent('Not authorised')
    expect(window.sessionStorage.getItem(KEY_STORAGE)).toBeNull()
    expect(screen.queryByTestId('admin-table')).toBeNull()
  })

  it('with the right key lists the reports newest first — when, ask, reply, destination, wanted, chose instead — with the count, and remembers the key for the tab', async () => {
    mount()
    await enter('right-key')
    expect(screen.getByTestId('admin-count')).toHaveTextContent('2 reports')
    const rows = screen.getAllByTestId('admin-row')
    expect(rows).toHaveLength(2)
    const cells = (r) => within(r).getAllByRole('cell').map((c) => c.textContent)
    expect(cells(rows[0]).slice(1)).toEqual(['rain', 'Opening the map.', '/data', '“the Lowell wind map”', '/extreme-events/lowell'])
    expect(cells(rows[1]).slice(1)).toEqual(['fire', 'Taking you there.', '/viewer/ignition/day/2026-10-12/statewide', 'Access Data /data', '—'])
    expect(cells(rows[0])[0]).toMatch(/Oct 13, 2026/)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['When', 'Ask', 'Reply', 'Destination', 'Wanted', 'Chose instead'])
    expect(window.sessionStorage.getItem(KEY_STORAGE)).toBe('right-key')
    expect(screen.queryByTestId('admin-key')).toBeNull()
  })

  it('a remembered key loads at once; "Export CSV" fetches the CSV with the header and saves it; "Forget key" forgets it', async () => {
    window.sessionStorage.setItem(KEY_STORAGE, 'right-key')
    const objectUrl = vi.fn(() => 'blob:csv'); const revoke = vi.fn()
    URL.createObjectURL = objectUrl; URL.revokeObjectURL = revoke
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mount()
    await tick(); await tick()
    expect(screen.getByTestId('admin-count')).toHaveTextContent('2 reports')
    await act(async () => { fireEvent.click(screen.getByTestId('admin-export')); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(calls.at(-1)).toEqual({ url: '/api/admin/feedback.csv', key: 'right-key' })
    expect(objectUrl).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('admin-forget'))
    expect(window.sessionStorage.getItem(KEY_STORAGE)).toBeNull()
    expect(screen.getByTestId('admin-key')).toBeInTheDocument()
  })

  it('says the admin view is not enabled when the API answers 404 (no ADMIN_KEY on the instance)', async () => {
    mode = 'disabled'
    mount()
    await enter('anything')
    expect(screen.getByTestId('admin-disabled')).toHaveTextContent('The admin view is not enabled on this instance')
    expect(screen.queryByTestId('admin-key')).toBeNull()
  })
})
