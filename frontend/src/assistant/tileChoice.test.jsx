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

// R5 C (13 Oct): did-you-mean tiles, only for a clarify answer that carries options.
const OPTIONS = [
  { id: 'ignition-daily-map', kind: 'viewer', title: 'Fire ignition probability map', url: '/viewer/ignition/day/2026-10-12/statewide', why: "today's fire risk on a map" },
  { id: 'ignition-forecast', kind: 'dataset', title: 'Fire ignition probability and 1–3 day predictions', url: '/data', why: 'the 1–3 day predictions' },
  { id: 'h-rip', kind: 'tool', title: 'Hawaiʻi Rangeland Information Portal', url: '/tools/h-rip', why: 'ranch drought conditions' },
  { id: 'hurricane-lane-2018', kind: 'event', title: 'Hurricane Lane (2018): Fire and Rain', url: 'https://www.hawaii.edu/climate-data-portal/fire-and-rain/', why: 'the 2018 fire story' },
]
const ALTS = [{ title: 'Access Data', url: '/data', why: 'downloads' }, { title: 'Climate Tools', url: '/tools', why: 'tools' }]
const clarify = (options) => ({ intent: 'clarify', reply: 'Which fire map do you mean?', actions: [], alternatives: ALTS, ...(options ? { options } : {}) })
const info = () => ({ intent: 'info', reply: 'I could not find that page. Here are the closest places.', actions: [], alternatives: ALTS })
const SUMMARY = { summary: 'x', chunks: ['You chose the rangeland portal.', 'It shows ranch drought.'], cites: [[], []], more: [], more_cites: [], sources: [{ title: 'H-RIP', url: 'https://hrip.manoa.hawaii.edu/' }], followups: [] }
const json = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) })
let reply, calls
const fetchMock = (url, init) => {
  calls.push({ url, body: init?.body ? JSON.parse(init.body) : null })
  if (url === '/api/navigate') return Promise.resolve(json(reply()))
  if (url === '/api/summary') return Promise.resolve(json(SUMMARY))
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
const ask = async (q) => { const input = screen.getAllByTestId('assistant-input')[0]; fireEvent.change(input, { target: { value: q } }); fireEvent.keyDown(input, { key: 'Enter' }); await tick(30) }
const navigateCalls = () => calls.filter((c) => c.url === '/api/navigate')

beforeEach(() => {
  vi.useFakeTimers()
  calls = []; reply = () => clarify(OPTIONS)
  vi.stubGlobal('fetch', vi.fn(fetchMock))
  vi.spyOn(window, 'open').mockImplementation(() => ({ opener: 'x' }))
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('did-you-mean tiles (R5 C)', () => {
  it('a clarify answer with options shows the question and the portal-style tiles in the landing card, each with the right picture, and no alternatives rows', async () => {
    renderApp('/')
    await ask('fire')
    const card = screen.getByTestId('landing-answers')
    expect(within(card).getByTestId('assistant-bubble')).toHaveTextContent('Which fire map do you mean?')
    const list = within(card).getByRole('list', { name: 'Did you mean' })
    expect(list.className).toContain('grid-cols-2'); expect(list.className).toContain('sm:grid-cols-4')   // 2 across on phones, 4 on desktop
    const tiles = within(list).getAllByTestId('tool')
    expect(tiles).toHaveLength(4)
    tiles.forEach((t) => { expect(t.tagName).toBe('BUTTON'); expect(t.className).toContain('aspect-[3/2]'); expect(t.className).toContain('rounded-[10px]') })
    expect(tiles.map((t) => within(t).getByRole('heading', { level: 3 }).textContent)).toEqual(OPTIONS.map((o) => o.title))
    expect(tiles[0]).toHaveTextContent("today's fire risk on a map")                                  // the why as the caption
    expect(tiles[0].querySelector('[aria-hidden="true"]').style.backgroundImage).toContain('rgba(10, 30, 80, 0.8)')   // the navy shade
    expect(within(tiles[0]).getByRole('img')).toHaveAttribute('src', '/api/map.webp?dataset=ignition&period=day&date=2026-10-12&extent=statewide&w=800&bg=bfe0f7')
    expect(within(tiles[1]).getByRole('img')).toHaveAttribute('src', '/backdrop-fallback-light.webp')
    expect(within(tiles[2]).getByRole('img')).toHaveAttribute('src', '/tools/h-rip.jpg')
    expect(within(tiles[3]).getByRole('img')).toHaveAttribute('src', '/backdrop-fallback-light.webp')
    expect(tiles[3]).toHaveAccessibleName('Hurricane Lane (2018): Fire and Rain (opens in a new tab)')
    expect(tiles[2]).toHaveAccessibleName('Hawaiʻi Rangeland Information Portal')
    expect(tiles[2]).toHaveAccessibleDescription('ranch drought conditions')
    expect(within(card).queryByRole('link', { name: /Access Data/ })).toBeNull()                    // the rows step aside for the tiles
  })

  it('tapping a tile: no AI call, "Opening {title}…" for the hold, the travel, the page, and the overview with reply "You chose {title}."', async () => {
    renderApp('/')
    await ask('fire')
    fireEvent.click(within(screen.getByRole('list', { name: 'Did you mean' })).getAllByTestId('tool')[2])
    await tick(10)
    expect(navigateCalls()).toHaveLength(1)                                   // only the original question
    expect(screen.queryByTestId('landing-answers')).toBeNull()
    expect(screen.getByTestId('landing-status')).toHaveTextContent('Opening Hawaiʻi Rangeland Information Portal…')
    expect(screen.getByTestId('assistant-input')).toHaveValue('fire')
    const summaries = calls.filter((c) => c.url === '/api/summary')
    expect(summaries).toHaveLength(1)
    expect(summaries[0].body).toEqual({ message: 'fire', reply: 'You chose Hawaiʻi Rangeland Information Portal.', path: '/tools/h-rip', intent: 'navigate' })
    await tick(HOLD_MS + TRAVEL_MS + 50)
    expect(screen.getByTestId('probe').textContent).toBe('/tools/h-rip')
    expect(screen.getByTestId('ai-summary')).toHaveAttribute('data-status', 'ready')
    expect(screen.queryByTestId('user-bubble')).toBeNull()                    // a tile answers the question already asked: no new turn
  })

  it('in the docked dropdown the tiles show too; a tap closes the dropdown, shows the line under the bar, then cuts to the page', async () => {
    renderApp('/data')
    await ask('fire')
    const dropdown = screen.getByTestId('assistant-dropdown')
    const tiles = within(dropdown).getAllByTestId('tool')
    expect(tiles).toHaveLength(4)
    expect(within(dropdown).queryByText(/Also:/)).toBeNull()
    fireEvent.click(tiles[0])
    await tick(10)
    expect(screen.queryByTestId('assistant-dropdown')).toBeNull()
    expect(screen.getByTestId('docked-status')).toHaveTextContent('Opening Fire ignition probability map…')
    expect(screen.getByTestId('probe').textContent).toBe('/data')
    await tick(HOLD_MS + 20)
    expect(screen.getByTestId('probe').textContent).toBe('/viewer/ignition/day/2026-10-12/statewide')
    expect(navigateCalls()).toHaveLength(1)
    expect(calls.filter((c) => c.url === '/api/summary')[0].body.reply).toBe('You chose Fire ignition probability map.')
  })

  it('an external tile opens in a new tab at once and asks for no overview', async () => {
    renderApp('/')
    await ask('fire')
    fireEvent.click(within(screen.getByRole('list', { name: 'Did you mean' })).getAllByTestId('tool')[3])
    await tick(10)
    expect(window.open).toHaveBeenCalledWith('https://www.hawaii.edu/climate-data-portal/fire-and-rain/', '_blank')
    expect(screen.getByTestId('landing-status')).toHaveTextContent('Opening Hurricane Lane (2018): Fire and Rain in a new tab…')   // only a trailing parenthetical is dropped
    await tick(HOLD_MS + 20)
    expect(screen.queryByTestId('landing-working')).toBeNull()
    expect(calls.filter((c) => c.url === '/api/summary')).toHaveLength(0)
    expect(screen.getByTestId('probe').textContent).toBe('/')
  })

  it('a clarify without options, or a miss, keeps today’s alternatives rows and shows no tiles', async () => {
    reply = () => clarify(null)
    renderApp('/')
    await ask('show me the map')
    let card = screen.getByTestId('landing-answers')
    expect(within(card).queryByRole('list', { name: 'Did you mean' })).toBeNull()
    expect(within(card).getByRole('link', { name: /Access Data/ })).toHaveAttribute('href', '/data')
    reply = () => clarify([OPTIONS[0]])   // one option is no choice
    await ask('fire?')
    card = screen.getByTestId('landing-answers')
    expect(within(card).queryByRole('list', { name: 'Did you mean' })).toBeNull()
    reply = info
    await ask('zzz')
    card = screen.getByTestId('landing-answers')
    expect(within(card).queryByRole('list', { name: 'Did you mean' })).toBeNull()
    expect(within(card).getAllByRole('link', { name: /Access Data/ }).length).toBeGreaterThan(0)
  })
})
