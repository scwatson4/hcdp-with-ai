import React, { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AssistantProvider, HOLD_MS } from './AssistantProvider'
import AssistantBar from './AssistantBar'
import { QUIET_HOLD_MS, GHOST_FADE_MS } from './AssistantPanel'
import { useViewFollowups, VIEW_FOLLOWUPS_DELAY_MS, clearViewFollowupsCache } from './useViewFollowups'
import { parseViewerPath } from '../viewer/urlGrammar'
import SiteHeader from '../components/SiteHeader'
import { ThemeProvider } from '../components/ThemeProvider'
import { TooltipProvider } from '../components/ui/tooltip'
import { useAssistant } from './AssistantProvider'

// N4 A (13 Oct): follow-ups that follow the visitor's own clicks in the viewer.
const A = '/viewer/rainfall/day/2026-09-07/kauai'
const B = '/viewer/rainfall/day/2026-09-06/kauai'
const C = '/viewer/rainfall/month/2026-08/kauai'
const D = '/viewer/temperature-max/day/2026-09-07/oahu'
const FOLLOWUPS_B = ['Show me the 7 September map', 'Turn on the stations for 6 September', 'Compare 6 and 7 September']
const FOLLOWUPS_C = ['Show me August on Oʻahu', 'Which month was wettest in 2026?', 'Download the August grid']
const SUMMARY = { summary: 'x', chunks: ['You asked for Kauaʻi rain.', 'The map shows 7 September.'], cites: [[], []], more: [], more_cites: [], sources: [], followups: ['Summary follow-up one', 'Summary follow-up two', 'Summary follow-up three'] }
const json = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) })
let calls, followupsFor, api, nav
const fetchMock = (url, init) => {
  const body = init?.body ? JSON.parse(init.body) : null
  calls.push({ url, body })
  if (url === '/api/followups') { const r = followupsFor(body.path); return r instanceof Error ? Promise.reject(r) : Promise.resolve(json({ followups: r })) }
  if (url === '/api/navigate') return Promise.resolve(json({ intent: 'navigate', reply: 'Taking you there.', actions: [{ type: 'navigate', path: D }], alternatives: [], minimize: true, destination: { title: 'Maximum temperature map', path: D } }))
  if (url === '/api/summary') return Promise.resolve(json(SUMMARY))
  if (/\/chose$/.test(url)) return Promise.resolve(json({ ok: true }))
  if (url === '/api/feedback/wrong-page') return Promise.resolve(json({ id: 'd'.repeat(32) }))
  return Promise.resolve(json({ items: [] }))
}
/** A stand-in for the viewer: parses the address and runs the hook, as Viewer does. */
function ViewerStub() {
  const { pathname, search } = useLocation()
  const v = parseViewerPath(pathname, search)
  useViewFollowups(v && !v.error ? v : null)
  return <div data-testid="viewer-stub">{pathname}{search}</div>
}
function Grab() { api = useAssistant(); nav = useNavigate(); return null }
function Shell() { return <><div data-testid="sticky-header"><SiteHeader /><AssistantBar /></div><Grab /><Outlet /></> }
const renderAt = (entry) => render(
  <ThemeProvider><TooltipProvider><MemoryRouter initialEntries={[entry]}><AssistantProvider>
    <Routes><Route element={<Shell />}><Route path="viewer/*" element={<ViewerStub />} /><Route path="*" element={<div>page</div>} /></Route></Routes>
  </AssistantProvider></MemoryRouter></TooltipProvider></ThemeProvider>,
)
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const go = async (path) => { await act(async () => { nav(path) }); await tick(10) }
const followupCalls = () => calls.filter((c) => c.url === '/api/followups')
const ghostText = () => within(screen.getByTestId('assistant-bar')).queryByTestId('composer-ghost-text')?.textContent ?? null
/** Tick in 100 ms steps until the ghost's text differs from `prev` (or `maxMs` pass); returns the ms waited. */
const untilChange = async (prev, maxMs) => { let waited = 0; while (ghostText() === prev && waited < maxMs) { await tick(100); waited += 100 } return waited }

beforeEach(() => {
  vi.useFakeTimers()
  calls = []; api = null; nav = null
  followupsFor = (path) => (path.startsWith(C) ? FOLLOWUPS_C : FOLLOWUPS_B)
  clearViewFollowupsCache()
  vi.stubGlobal('fetch', vi.fn(fetchMock))
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('follow-ups that follow the visitor’s clicks (N4 A)', () => {
  it('asks nothing on the first load, nor for a display option; one call 1.5 s after a burst of three quick rail changes, with the view as context', async () => {
    renderAt(A)
    await tick(VIEW_FOLLOWUPS_DELAY_MS + 500)
    expect(followupCalls()).toHaveLength(0)
    await go(`${A}?units=in`)                         // a display option: not the view
    await tick(VIEW_FOLLOWUPS_DELAY_MS + 100)
    expect(followupCalls()).toHaveLength(0)
    await go(B); await tick(300); await go(C); await tick(300); await go(B)   // a burst: the last change wins
    await tick(VIEW_FOLLOWUPS_DELAY_MS - 200)
    expect(followupCalls()).toHaveLength(0)
    await tick(300)
    expect(followupCalls()).toHaveLength(1)
    expect(followupCalls()[0].body).toEqual({ path: B, context: { dataset: 'rainfall', period: 'day', date: '2026-09-06', extent: 'kauai', title: 'Rainfall, September 6, 2026, Kauaʻi' } })
    // stored under the address, source 'view': the docked bar's ghost cycles them — once the example it is showing has had its hold
    expect(api.followups[B]).toMatchObject({ list: FOLLOWUPS_B, source: 'view' })
    expect(FOLLOWUPS_B).not.toContain(ghostText())
    await tick(QUIET_HOLD_MS + GHOST_FADE_MS + 200)
    expect(FOLLOWUPS_B).toContain(ghostText())
  })

  it('answers a return to a view from the memory cache without a second call; a failed call changes nothing', async () => {
    renderAt(A)
    await go(B); await tick(VIEW_FOLLOWUPS_DELAY_MS + 50)
    await go(C); await tick(VIEW_FOLLOWUPS_DELAY_MS + 50)
    expect(followupCalls().map((c) => c.body.path)).toEqual([B, C])
    expect(api.followupsFor(C.split('?')[0], '')).toEqual(FOLLOWUPS_C)
    await go(B); await tick(VIEW_FOLLOWUPS_DELAY_MS + 50)
    expect(followupCalls()).toHaveLength(2)                      // the cache answered
    expect(api.followupsFor(B, '')).toEqual(FOLLOWUPS_B)
    followupsFor = () => new Error('down')
    await go(D); await tick(VIEW_FOLLOWUPS_DELAY_MS + 50)
    expect(followupCalls()).toHaveLength(3)
    expect(api.followupsFor(D, '')).toBeNull()                   // nothing stored for the failed view
    followupsFor = () => []
    await go(C.replace('kauai', 'oahu')); await tick(VIEW_FOLLOWUPS_DELAY_MS + 50)
    expect(api.followupsFor(C.replace('kauai', 'oahu'), '')).toBeNull()
  })

  it('a view the assistant opened is not asked for again (its overview carries the follow-ups); a newer change aborts the call in flight', async () => {
    renderAt(A)
    const input = within(screen.getByTestId('assistant-bar')).getByTestId('assistant-input')
    fireEvent.change(input, { target: { value: 'temperature max map for oahu' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await tick(50)
    expect(screen.getByTestId('viewer-stub')).toHaveTextContent(D)
    await tick(VIEW_FOLLOWUPS_DELAY_MS + 100)
    expect(followupCalls()).toHaveLength(0)
    expect(api.followupsFor(D, '')).toEqual(SUMMARY.followups)
    // a slow call is abandoned when the view changes again before it answers
    let resolveSlow
    followupsFor = (path) => (path === B ? new Promise((r) => { resolveSlow = r }) : FOLLOWUPS_C)
    vi.mocked(fetch).mockImplementation((url, init) => {
      const body = init?.body ? JSON.parse(init.body) : null
      if (url === '/api/followups' && body.path === B) { calls.push({ url, body }); return new Promise((resolve, reject) => { resolveSlow = () => resolve(json({ followups: FOLLOWUPS_B })); init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))) }) }
      return fetchMock(url, init)
    })
    await go(B); await tick(VIEW_FOLLOWUPS_DELAY_MS + 50)
    expect(followupCalls().map((c) => c.body.path)).toEqual([B])
    await go(C); await tick(VIEW_FOLLOWUPS_DELAY_MS + 50)
    expect(followupCalls().map((c) => c.body.path)).toEqual([B, C])
    expect(api.followupsFor(C, '')).toEqual(FOLLOWUPS_C)
    expect(api.followupsFor(B, '')).toBeNull()                   // the aborted call stored nothing
  })

  it('the docked bar adopts the new set only at the end of the current example’s hold, with a crossfade; the old set keeps cycling meanwhile', async () => {
    renderAt(A)
    await go(B); await tick(VIEW_FOLLOWUPS_DELAY_MS + 50)
    await tick(QUIET_HOLD_MS + GHOST_FADE_MS + 200)              // the B set has been adopted
    expect(within(screen.getByTestId('assistant-bar')).getByTestId('composer-ghost')).toHaveAttribute('data-variant', 'quiet')
    // wait for the next crossfade, so the phase of the hold is known: a new example has just come in
    const shown = ghostText()
    expect(FOLLOWUPS_B).toContain(shown)
    expect(await untilChange(shown, QUIET_HOLD_MS + GHOST_FADE_MS + 500)).toBeLessThan(QUIET_HOLD_MS + GHOST_FADE_MS + 500)
    const first = ghostText()
    expect(FOLLOWUPS_B).toContain(first)
    // one second into its time the view changes; the new set arrives 1.5 s later — well before this example's hold ends
    await tick(1000)
    await go(C); await tick(VIEW_FOLLOWUPS_DELAY_MS + 50)
    expect(api.followupsFor(C, '')).toEqual(FOLLOWUPS_C)
    expect(ghostText()).toBe(first)                               // never mid-example: the old set is still up
    // at the end of the hold the crossfade into the new set: the old text on its way out under the new one
    const waited = await untilChange(first, QUIET_HOLD_MS + GHOST_FADE_MS)
    expect(waited).toBeGreaterThan(500)                           // not at once
    expect(FOLLOWUPS_C).toContain(ghostText())
    expect(within(screen.getByTestId('assistant-bar')).getByTestId('composer-ghost')).toHaveAttribute('data-pool', 'followups')
    const outgoing = within(screen.getByTestId('assistant-bar')).queryByTestId('composer-ghost-outgoing')
    expect(outgoing).not.toBeNull(); expect(outgoing).toHaveTextContent(first)
    await tick(GHOST_FADE_MS + 20)
    expect(within(screen.getByTestId('assistant-bar')).queryByTestId('composer-ghost-outgoing')).toBeNull()
  })

  it('a rail change counts as the visitor’s next page for an open "Wrong page?" report', async () => {
    renderAt(A)
    const input = within(screen.getByTestId('assistant-bar')).getByTestId('assistant-input')
    fireEvent.change(input, { target: { value: 'temperature' } }); fireEvent.keyDown(input, { key: 'Enter' })
    await tick(50)
    await act(async () => { await api.reportWrongPage({ text: 'the humidity map' }) })
    await go(B); await tick(20)
    const chose = calls.filter((c) => /\/chose$/.test(c.url))
    expect(chose).toHaveLength(1)
    expect(chose[0].body).toEqual({ path: B })
  })
})
