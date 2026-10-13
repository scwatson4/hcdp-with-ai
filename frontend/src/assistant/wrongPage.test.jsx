import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom'
import { AssistantProvider, HOLD_MS, WRONG_PAGE_WINDOW_MS } from './AssistantProvider'
import AssistantBar from './AssistantBar'
import SiteHeader from '../components/SiteHeader'
import { ThemeProvider } from '../components/ThemeProvider'
import { TooltipProvider } from '../components/ui/tooltip'
import { PageShell } from '../pages/content/PageShell'

// P4 A (13 Oct): "Wrong page?" at the bottom of the AI overview, and the visitor's next page attached to the report.
const ALTS = [{ title: 'Access Data', url: '/data', why: 'downloads' }, { title: 'Mesonet app', url: 'https://hawaiimesonet.app/', why: 'the app' }]
const navigateReply = (path) => ({ intent: 'navigate', reply: `Taking you to ${path}.`, actions: [{ type: 'navigate', path }], alternatives: ALTS, minimize: true, destination: { title: 'A page', path } })
const summary = () => ({ summary: 'x', chunks: ['You asked for the Mesonet.', 'This page embeds the live viewer.'], cites: [[], []], more: [], more_cites: [], sources: [], followups: [], request_id: 'f'.repeat(32) })
const json = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) })
let calls, replies, feedbackIds
const fetchMock = (url, init) => {
  const body = init?.body ? JSON.parse(init.body) : null
  calls.push({ url, method: init?.method || 'GET', body })
  if (url === '/api/navigate') return Promise.resolve(json(replies.shift() || navigateReply('/mesonet')))
  if (url === '/api/summary') return Promise.resolve(json(summary()))
  if (url === '/api/feedback/wrong-page') return Promise.resolve(json({ id: feedbackIds.shift() || 'a'.repeat(32) }))
  if (/^\/api\/feedback\/wrong-page\/[0-9a-f]{32}\/chose$/.test(url)) return Promise.resolve(json({ ok: true }))
  return Promise.resolve(json({ items: [] }))
}
function Probe() { const { pathname } = useLocation(); return <div data-testid="probe">{pathname}</div> }
function Page() { const { pathname } = useLocation(); return <PageShell title={`Page ${pathname}`}><p>body</p></PageShell> }
function Shell() { return <><div data-testid="sticky-header"><SiteHeader /><AssistantBar /></div><Probe /><Outlet /></> }
const renderApp = (entry = '/data') => render(
  <ThemeProvider><TooltipProvider><MemoryRouter initialEntries={[entry]}><AssistantProvider>
    <Routes><Route element={<Shell />}><Route path="*" element={<Page />} /></Route></Routes>
  </AssistantProvider></MemoryRouter></TooltipProvider></ThemeProvider>,
)
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const ask = async (q) => { const input = screen.getAllByTestId('assistant-input')[0]; fireEvent.change(input, { target: { value: q } }); fireEvent.keyDown(input, { key: 'Enter' }); await tick(30) }
const reports = () => calls.filter((c) => c.url === '/api/feedback/wrong-page')
const choses = () => calls.filter((c) => /\/chose$/.test(c.url))

beforeEach(() => {
  vi.useFakeTimers()
  calls = []; replies = []; feedbackIds = []
  vi.stubGlobal('fetch', vi.fn(fetchMock))
  vi.spyOn(window, 'open').mockImplementation(() => ({ opener: 'x' }))
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('"Wrong page?" under the AI overview (P4 A)', () => {
  it('unfolds a two-tap chooser after Show more: the alternatives as rows and an "Other…" row that reveals a field and Send', async () => {
    replies = [navigateReply('/mesonet')]
    renderApp('/data')
    await ask('take me to the mesonet')
    const block = screen.getByTestId('ai-summary')
    expect(block).toHaveAttribute('data-status', 'ready')
    const link = within(block).getByTestId('wrong-page-link')
    expect(link).toHaveTextContent('Wrong page?')
    expect(link.className).toMatch(/text-\[12px\]/); expect(link.className).toContain('text-subtle')   // small and subtle
    expect(Boolean(within(block).getByTestId('ai-summary-toggle').compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)   // after Show more
    expect(within(block).queryByTestId('wrong-page-chooser')).toBeNull()
    fireEvent.click(link)
    const chooser = within(block).getByTestId('wrong-page-chooser')
    expect(chooser).toHaveTextContent('Which page did you want?')
    const rows = within(chooser).getAllByTestId('wrong-page-row')
    expect(rows.map((r) => r.textContent)).toEqual(['Access Data · downloads', 'Mesonet app · the app'])
    rows.forEach((r) => expect(r.className).toContain('min-h-11'))
    expect(within(chooser).queryByTestId('wrong-page-other-form')).toBeNull()
    const other = within(chooser).getByTestId('wrong-page-other')
    expect(other).toHaveTextContent('Other…')
    fireEvent.click(other)
    const field = within(chooser).getByTestId('wrong-page-text')
    expect(field).toHaveAttribute('type', 'text'); expect(field.className).toContain('min-h-11')
    const send = within(chooser).getByTestId('wrong-page-send')
    expect(send).toHaveTextContent('Send'); expect(send.className).toContain('min-h-11'); expect(send).toBeDisabled()
    expect(reports()).toHaveLength(0)
  })

  it('a row reports the want (ask, reply, destination, overview id, wanted link) and opens that page with no AI call; the page itself is not "chose instead", the next one is, once', async () => {
    replies = [navigateReply('/mesonet')]
    feedbackIds = ['b'.repeat(32)]
    renderApp('/data')
    await ask('take me to the mesonet')
    fireEvent.click(screen.getByTestId('wrong-page-link'))
    await act(async () => { fireEvent.click(screen.getAllByTestId('wrong-page-row')[0]); await vi.advanceTimersByTimeAsync(10) })
    expect(reports()).toHaveLength(1)
    expect(reports()[0].method).toBe('POST')
    expect(reports()[0].body).toEqual({ ask: 'take me to the mesonet', reply: 'Taking you to /mesonet.', destination: '/mesonet', overview_id: 'f'.repeat(32), wanted: { title: 'Access Data', url: '/data' } })
    // then the wanted page opens through choose(): the wait line, one hold, the page, its overview — and no new AI call
    expect(calls.filter((c) => c.url === '/api/navigate')).toHaveLength(1)
    expect(screen.getByTestId('docked-status')).toHaveTextContent('Opening Access Data…')
    await tick(HOLD_MS + 20)
    expect(screen.getByTestId('probe').textContent).toBe('/data')
    expect(calls.filter((c) => c.url === '/api/summary').at(-1).body).toMatchObject({ message: 'take me to the mesonet', reply: 'You chose Access Data.', path: '/data' })
    expect(choses()).toHaveLength(0)                                   // the page they asked for by name is not "instead"
    // the NEXT navigation is attached to the report, fire-and-forget, once
    replies = [navigateReply('/extreme-events/lowell')]
    await ask('lowell')
    expect(screen.getByTestId('probe').textContent).toBe('/extreme-events/lowell')
    expect(choses()).toHaveLength(1)
    expect(choses()[0]).toMatchObject({ url: `/api/feedback/wrong-page/${'b'.repeat(32)}/chose`, method: 'POST', body: { path: '/extreme-events/lowell' } })
    replies = [navigateReply('/pacific')]
    await ask('pacific')
    expect(choses()).toHaveLength(1)
  })

  it('"Other…" reports the text, asks the assistant with it, and that answer\'s page is attached', async () => {
    replies = [navigateReply('/mesonet')]
    feedbackIds = ['c'.repeat(32)]
    renderApp('/data')
    await ask('station data')
    fireEvent.click(screen.getByTestId('wrong-page-link'))
    fireEvent.click(screen.getByTestId('wrong-page-other'))
    fireEvent.change(screen.getByTestId('wrong-page-text'), { target: { value: 'the Lowell wind map' } })
    replies = [navigateReply('/extreme-events/lowell')]
    await act(async () => { fireEvent.click(screen.getByTestId('wrong-page-send')); await vi.advanceTimersByTimeAsync(30) })
    expect(reports()).toHaveLength(1)
    expect(reports()[0].body.wanted).toEqual({ text: 'the Lowell wind map' })
    expect(reports()[0].body.ask).toBe('station data')
    const nav = calls.filter((c) => c.url === '/api/navigate')
    expect(nav).toHaveLength(2); expect(nav[1].body.message).toBe('the Lowell wind map')
    await tick(50)
    expect(screen.getByTestId('probe').textContent).toBe('/extreme-events/lowell')
    expect(choses()).toHaveLength(1)
    expect(choses()[0].body).toEqual({ path: '/extreme-events/lowell' })
  })

  it('a report older than ten minutes attaches nothing; a pending overview offers no link', async () => {
    let resolve
    replies = [navigateReply('/mesonet')]
    renderApp('/data')
    vi.mocked(fetch).mockImplementationOnce(fetchMock).mockImplementation((url, init) => (url === '/api/summary' ? new Promise((r) => { resolve = r }) : fetchMock(url, init)))
    await ask('mesonet')
    expect(screen.getByTestId('ai-summary')).toHaveAttribute('data-status', 'pending')
    expect(screen.queryByTestId('wrong-page-link')).toBeNull()
    await act(async () => { resolve(json(summary())); await vi.advanceTimersByTimeAsync(10) })
    fireEvent.click(screen.getByTestId('wrong-page-link'))
    fireEvent.click(screen.getByTestId('wrong-page-other'))
    fireEvent.change(screen.getByTestId('wrong-page-text'), { target: { value: 'something' } })
    vi.mocked(fetch).mockImplementation((url, init) => (url === '/api/navigate' ? Promise.resolve(json({ intent: 'info', reply: 'Hmm.', actions: [], alternatives: [] })) : fetchMock(url, init)))
    await act(async () => { fireEvent.click(screen.getByTestId('wrong-page-send')); await vi.advanceTimersByTimeAsync(30) })
    expect(reports()).toHaveLength(1)
    await tick(WRONG_PAGE_WINDOW_MS + 1000)
    vi.mocked(fetch).mockImplementation(fetchMock)
    replies = [navigateReply('/pacific')]
    fireEvent.keyDown(window, { key: 'Escape' })
    await ask('pacific')
    expect(screen.getByTestId('probe').textContent).toBe('/pacific')
    expect(choses()).toHaveLength(0)
  })
})
