import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom'
import { AssistantProvider, HOLD_MS, TRAVEL_MS } from './AssistantProvider'
import AssistantBar from './AssistantBar'
import Landing from '../pages/Landing'
import SiteHeader from '../components/SiteHeader'
import { ThemeProvider } from '../components/ThemeProvider'
import { TooltipProvider } from '../components/ui/tooltip'
import { PageShell } from '../pages/content/PageShell'
import { DEBOUNCE_MS } from './localMatch'

// R6 D (13 Oct): catalogue matches while you type — no AI call; choosing one opens it with the staged wait line and
// the overview flow (reply "You chose {title}.").
const LOWELL_SUMMARY = { summary: 'x', chunks: ['You chose the Hurricane Lowell report.', 'This section tells the story of the storm.'], cites: [[1], []], more: [], more_cites: [], sources: [{ title: 'Hurricane Lowell report', url: 'https://www.hawaii.edu/climate-data-portal/hurricane-lowell/' }], followups: ['Show me the daily rainfall map for 7 September'] }
const json = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) })
let calls
const fetchMock = (url, init) => {
  calls.push({ url, body: init?.body ? JSON.parse(init.body) : null })
  if (url === '/api/navigate') return Promise.resolve(json({ intent: 'info', reply: 'The AI answered.', actions: [], alternatives: [] }))
  if (url === '/api/summary') return Promise.resolve(json(LOWELL_SUMMARY))
  return Promise.resolve(json({ items: [] }))
}
function Probe() { const { pathname } = useLocation(); return <div data-testid="probe">{pathname}</div> }
function Page() { const { pathname } = useLocation(); return <PageShell title={`Page ${pathname}`}><p>body</p></PageShell> }
function Shell() { return <><div data-testid="sticky-header"><SiteHeader /><AssistantBar /></div><Probe /><Outlet /></> }
const renderApp = (entry = '/') => render(
  <ThemeProvider><TooltipProvider><MemoryRouter initialEntries={[entry]}><AssistantProvider>
    <Routes><Route element={<Shell />}><Route index element={<Landing />} /><Route path="*" element={<Page />} /></Route></Routes>
  </AssistantProvider></MemoryRouter></TooltipProvider></ThemeProvider>,
)
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const input = () => screen.getAllByTestId('assistant-input')[0]
const type = async (text) => { fireEvent.change(input(), { target: { value: text } }); await tick(DEBOUNCE_MS + 10) }
const rows = () => screen.queryAllByTestId('typeahead-row')
const navigateCalls = () => calls.filter((c) => c.url === '/api/navigate')

beforeEach(() => {
  vi.useFakeTimers()
  calls = []
  vi.stubGlobal('fetch', vi.fn(fetchMock))
  vi.spyOn(window, 'open').mockImplementation(() => ({ opener: 'x' }))
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('the typeahead listbox', () => {
  it('appears under the landing bar from two characters (QB-Q4 B), 80 ms after the last keystroke: "Ask AI: {typed}" first, then up to five matches with grey kind words; never while the ghost shows', async () => {
    renderApp('/')
    expect(screen.queryByTestId('typeahead')).toBeNull()
    fireEvent.change(input(), { target: { value: 'L' } })
    await tick(200)
    expect(screen.queryByTestId('typeahead')).toBeNull()                 // one character: nothing
    fireEvent.change(input(), { target: { value: 'Lo' } })
    await tick(DEBOUNCE_MS + 20)
    expect(screen.getByTestId('typeahead')).toBeInTheDocument()          // two: the list is up
    expect(screen.getByTestId('typeahead-ask')).toHaveTextContent('Ask AI:Lo')
    fireEvent.change(input(), { target: { value: 'Lowe' } })
    await tick(DEBOUNCE_MS - 20)
    expect(screen.getByTestId('typeahead-ask')).toHaveTextContent('Ask AI:Lowe')   // the Ask AI row follows the text at once
    await tick(30)
    const list = screen.getByTestId('typeahead')
    expect(list).toHaveAttribute('role', 'listbox')
    expect(screen.getByTestId('typeahead-ask')).toHaveAttribute('role', 'option')
    expect(list.firstElementChild).toBe(screen.getByTestId('typeahead-ask'))      // always the first row
    expect(rows().length).toBeGreaterThanOrEqual(2); expect(rows().length).toBeLessThanOrEqual(5)
    expect(rows()[0]).toHaveTextContent('Hurricane Lowell report')
    expect(within(rows()[0]).getByTestId('typeahead-kind')).toHaveTextContent('report')
    expect(within(rows()[0]).getByTestId('typeahead-kind').className).toContain('text-subtle')
    expect(rows().map((r) => r.dataset.kind)).toContain('map')
    rows().forEach((r) => { expect(r).toHaveAttribute('role', 'option'); expect(r.className).toContain('min-h-11') })
    expect(input()).toHaveAttribute('aria-expanded', 'true')
    expect(input()).toHaveAttribute('aria-controls', list.id)
    expect(screen.queryByTestId('composer-ghost')).toBeNull()           // text present: no ghost typewriter
    expect(navigateCalls()).toHaveLength(0)                             // no AI call
    // below two characters again: the list goes
    fireEvent.change(input(), { target: { value: 'L' } })
    await tick(100)
    expect(screen.queryByTestId('typeahead')).toBeNull()
    // a dated row: the viewer template filled with the latest available date, named in the row
    fireEvent.change(input(), { target: { value: 'daily rainfall' } })
    await tick(DEBOUNCE_MS + 20)
    expect(rows()[0]).toHaveTextContent(/Daily rainfall map · \d{1,2} \w{3} \d{4}/)
  })

  it('and under the docked bar too', async () => {
    renderApp('/data')
    await type('Lowe')
    expect(within(screen.getByTestId('assistant-bar')).getByTestId('typeahead')).toBeInTheDocument()
    expect(rows()[0]).toHaveTextContent('Hurricane Lowell report')
  })

  it('↑/↓ move through all rows starting on the Ask AI row (aria-activedescendant on the field), Esc closes until the text changes, a click outside closes', async () => {
    renderApp('/')
    await type('Lowe')
    const list = screen.getByTestId('typeahead')
    const askRow = screen.getByTestId('typeahead-ask')
    expect(askRow).toHaveAttribute('aria-selected', 'true')                      // the highlight starts on Ask AI
    expect(input()).toHaveAttribute('aria-activedescendant', askRow.id)
    expect(askRow.id).toBe(`${list.id}-0`)
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(rows()[0]).toHaveAttribute('aria-selected', 'true'); expect(askRow).toHaveAttribute('aria-selected', 'false')
    expect(input()).toHaveAttribute('aria-activedescendant', rows()[0].id)
    expect(rows()[0].id).toBe(`${list.id}-1`)
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(rows()[1]).toHaveAttribute('aria-selected', 'true'); expect(rows()[0]).toHaveAttribute('aria-selected', 'false')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(rows()[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(askRow).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(rows()[rows().length - 1]).toHaveAttribute('aria-selected', 'true')   // wraps
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(screen.queryByTestId('typeahead')).toBeNull()
    expect(input()).toHaveValue('Lowe')                                  // Esc only closes the list
    await tick(200)
    expect(screen.queryByTestId('typeahead')).toBeNull()                 // stays closed for this text
    await type('Lowel')
    expect(screen.getByTestId('typeahead')).toBeInTheDocument()          // a change reopens it
    fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('typeahead')).toBeNull()
  })

  it('Enter (or a tap on the Ask AI row) asks the AI as today unless a match has been arrow-keyed to', async () => {
    renderApp('/data')
    await type('Lowe')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await tick(30)
    expect(navigateCalls()).toHaveLength(1)
    expect(navigateCalls()[0].body.message).toBe('Lowe')
    await tick(HOLD_MS + 50)
    expect(screen.queryByTestId('typeahead')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    await type('Lowell re')
    fireEvent.click(screen.getByTestId('typeahead-ask'))              // a tap on the Ask AI row sends too
    await tick(30)
    expect(navigateCalls()).toHaveLength(2)
    expect(navigateCalls()[1].body.message).toBe('Lowell re')
    await tick(HOLD_MS + 50)
    // a second time, with ↓ first: the row is chosen, the AI is not asked
    fireEvent.keyDown(window, { key: 'Escape' })   // close the dropdown the info reply opened
    await type('Lowell rep')
    expect(rows()[0]).toHaveTextContent('Hurricane Lowell report')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await tick(10)
    expect(navigateCalls()).toHaveLength(2)
    expect(screen.getByTestId('docked-status')).toHaveTextContent('Opening Hurricane Lowell report…')
  })

  it('tapping a row from the landing: no AI call, the field keeps the text, "Opening {title}…" for the hold, then the travel, the page and the overview with reply "You chose {title}."', async () => {
    renderApp('/')
    await type('Lowe')
    fireEvent.click(rows()[0])
    await tick(10)
    expect(navigateCalls()).toHaveLength(0)
    expect(screen.queryByTestId('typeahead')).toBeNull()
    expect(input()).toHaveValue('Lowe')
    expect(screen.getByTestId('landing-status')).toHaveTextContent('Opening Hurricane Lowell report…')
    expect(screen.getByTestId('landing-hero')).toHaveAttribute('data-travel', 'hold')
    expect(screen.getByTestId('probe').textContent).toBe('/')
    // the overview is asked for at once, with the typed text as the ask and the choice as the reply
    const summaries = calls.filter((c) => c.url === '/api/summary')
    expect(summaries).toHaveLength(1)
    expect(summaries[0].body).toEqual({ message: 'Lowe', reply: 'You chose Hurricane Lowell report.', path: '/extreme-events/lowell', intent: 'navigate' })
    await tick(HOLD_MS - 50)
    expect(screen.getByTestId('probe').textContent).toBe('/')
    await tick(60)
    expect(screen.getByTestId('landing-hero')).toHaveAttribute('data-travel', 'travel')
    await tick(TRAVEL_MS + 20)
    expect(screen.getByTestId('probe').textContent).toBe('/extreme-events/lowell')
    expect(screen.queryByTestId('landing-working')).toBeNull()
    const block = screen.getByTestId('ai-summary')
    expect(block).toHaveAttribute('data-status', 'ready')
    expect(within(block).getAllByTestId('ai-summary-chunk')[0]).toHaveTextContent('You chose the Hurricane Lowell report.')
    expect(screen.queryByTestId('reply-strip')).toBeNull()
    expect(navigateCalls()).toHaveLength(0)
  })

  it('from the docked bar: "Opening {title}…" for one hold, then a cut to the page with its overview; the docked ghost then cycles the follow-ups', async () => {
    renderApp('/data')
    await type('Lowe')
    fireEvent.click(rows()[0])
    await tick(10)
    expect(navigateCalls()).toHaveLength(0)
    expect(within(screen.getByTestId('assistant-bar')).getByTestId('docked-status')).toHaveTextContent('Opening Hurricane Lowell report…')
    expect(screen.getByTestId('probe').textContent).toBe('/data')
    expect(input()).toHaveValue('Lowe')
    await tick(HOLD_MS + 20)
    expect(screen.getByTestId('probe').textContent).toBe('/extreme-events/lowell')
    expect(screen.queryByTestId('docked-working')).toBeNull()
    expect(screen.getByTestId('ai-summary')).toHaveAttribute('data-status', 'ready')
    expect(screen.queryByTestId('reply-strip')).toBeNull()
  })

  it('an external row opens in a new tab at once, says so for one hold, and asks for no overview', async () => {
    renderApp('/data')
    await type('rainfall mapping history')
    const row = rows().find((r) => r.dataset.kind === 'external')
    expect(row).toBeTruthy()
    expect(within(row).getByTestId('typeahead-kind')).toHaveTextContent('external ↗')
    fireEvent.click(row)
    await tick(10)
    expect(window.open).toHaveBeenCalledWith('https://www.hawaii.edu/climate-data-portal/rainfall-mapping-history/', '_blank')
    expect(screen.getByTestId('docked-status')).toHaveTextContent('Opening Rainfall Mapping History in a new tab…')
    await tick(HOLD_MS + 20)
    expect(screen.queryByTestId('docked-working')).toBeNull()
    expect(calls.filter((c) => c.url === '/api/summary')).toHaveLength(0)
    expect(navigateCalls()).toHaveLength(0)
    expect(screen.getByTestId('probe').textContent).toBe('/data')
  })
})
