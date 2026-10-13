import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet, useLocation, Link } from 'react-router-dom'
import { AssistantProvider, HOLD_MS, TRAVEL_MS } from './AssistantProvider'
import AssistantBar from './AssistantBar'
import AISummary, { CHUNK_STAGGER_MS, superscript } from './AISummary'
import Landing from '../pages/Landing'
import SiteHeader from '../components/SiteHeader'
import { ThemeProvider } from '../components/ThemeProvider'
import { TooltipProvider } from '../components/ui/tooltip'
import { PageShell } from '../pages/content/PageShell'
import ExtremeEvents from '../pages/content/ExtremeEvents'
import ClimateTools from '../pages/content/ClimateTools'
import Mesonet from '../pages/content/Mesonet'
import ClimateSummary from '../pages/content/ClimateSummary'

// 13 Oct: after a navigation the destination opens with the AI overview (instead of the reply strip) and the docked
// bar's ghost cycles the overview's follow-up asks.
const MESONET = 'https://www.hawaii.edu/climate-data-portal/hawaii-mesonet/'
const LIVE = 'https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/'
const LOWELL = 'https://www.hawaii.edu/climate-data-portal/hurricane-lowell/'
const CHUNKS = ['You asked for the Hawaiʻi Mesonet.', 'This page describes the station network and embeds the live viewer.', 'Pick a station below to see its readings.']
const MORE = ['The page lists what every station measures.', 'The live viewer has a map, a table and per-station dashboards.']
const FOLLOWUPS_A = ['Which stations are on Kauaʻi?', 'Show me the Mesonet wind map', 'Take me to the station list']
const FOLLOWUPS_B = ['Open the Hurricane Lowell Mesonet viewer', 'Show me Kauaʻi rainfall for 7 September', 'Where is the Lowell rainfall download?']
const summaryA = () => ({ summary: CHUNKS.join(' '), chunks: CHUNKS, cites: [[1], [1, 2], []], more: MORE, more_cites: [[1], [2]], sources: [{ title: 'Hawaiʻi Mesonet', url: MESONET }, { title: 'Hawaiʻi Mesonet Live Data Access', url: LIVE }], followups: FOLLOWUPS_A })
const summaryB = () => ({ summary: 'x', chunks: ['You asked for the Hurricane Lowell report.', 'This section tells the story of the storm.'], cites: [[1], []], more: [], more_cites: [], sources: [{ title: 'Hurricane Lowell report', url: LOWELL }], followups: FOLLOWUPS_B })
const emptySummary = () => ({ summary: '', chunks: [], cites: [], more: [], more_cites: [], sources: [], followups: [] })
const navigateReply = (path) => ({ intent: 'navigate', reply: `Taking you to ${path}.`, actions: [{ type: 'navigate', path }], alternatives: [{ title: 'Access Data', url: '/data', why: 'downloads' }, { title: 'Mesonet app', url: 'https://hawaiimesonet.app/', why: 'the app' }], minimize: true })
const json = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) })

let replies, summaries, calls, narrate
const next = (queue) => {
  const s = queue.shift()
  if (s instanceof Error) return Promise.reject(s)
  if (s && typeof s.then === 'function') return s
  return Promise.resolve(json(s))
}
const fetchMock = (url, init) => {
  calls.push({ url, body: init?.body ? JSON.parse(init.body) : null })
  if (url === '/api/navigate') return next(replies)
  if (url === '/api/summary') return next(summaries)
  if (url === '/api/narrate') return narrate ? Promise.resolve(json({ line: narrate })) : Promise.reject(new Error('no narration'))
  return Promise.resolve(json({ items: [] }))
}

function Probe() { const { pathname } = useLocation(); return <div data-testid="probe">{pathname}</div> }
function Page() { const { pathname } = useLocation(); return <PageShell title={`Page ${pathname}`}><p>body</p><Link to="/elsewhere" data-testid="go-elsewhere">elsewhere</Link></PageShell> }
function Shell() { return <><div data-testid="sticky-header"><SiteHeader /><AssistantBar /></div><Probe /><Outlet /></> }
const renderApp = (entry = '/') => render(
  <ThemeProvider><TooltipProvider><MemoryRouter initialEntries={[entry]}><AssistantProvider>
    <Routes><Route element={<Shell />}><Route index element={<Landing />} /><Route path="*" element={<Page />} /></Route></Routes>
  </AssistantProvider></MemoryRouter></TooltipProvider></ThemeProvider>,
)
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const ask = async (q) => { const input = screen.getAllByTestId('assistant-input')[0]; fireEvent.change(input, { target: { value: q } }); fireEvent.keyDown(input, { key: 'Enter' }); await tick(30) }
const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
const summaryCalls = () => calls.filter((c) => c.url === '/api/summary')

beforeEach(() => {
  vi.useFakeTimers()
  calls = []; replies = []; summaries = []; narrate = null
  vi.stubGlobal('fetch', vi.fn(fetchMock))
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('the AI overview after a navigation', () => {
  it('from the landing: the header, the numbered sources first, the cited sentences 350 ms apart, no reply strip; ✕ dismisses', async () => {
    replies = [navigateReply('/mesonet')]; summaries = [summaryA()]
    renderApp('/')
    await ask('take me to the mesonet')
    // the overview is asked for as soon as the answer arrives, with the ask, the reply, the destination and the intent
    expect(summaryCalls()).toHaveLength(1)
    expect(summaryCalls()[0].body).toEqual({ message: 'take me to the mesonet', reply: 'Taking you to /mesonet.', path: '/mesonet', intent: 'navigate' })
    expect(screen.queryByTestId('ai-summary')).toBeNull()   // not on the landing page: it belongs to the destination
    await tick(HOLD_MS + TRAVEL_MS + 50)
    expect(screen.getByTestId('probe').textContent).toBe('/mesonet')
    const block = screen.getByTestId('ai-summary')
    expect(block).toHaveAttribute('data-status', 'ready')
    expect(block).toHaveAccessibleName('AI Overview')
    expect(block.className).not.toMatch(/border-border|bg-card/)                 // a quiet block, no card
    expect(block.querySelector('.hcdp-ai-summary-rule')).not.toBeNull()          // the 3 px spectrum rule
    // the header row: the spectrum star, "AI Overview", then at the right "Generated by HCDP AI" and the ✕
    const header = within(block).getByTestId('ai-summary-header')
    expect(within(header).getByTestId('ai-overview-star').tagName).toBe('svg')
    expect(within(header).getByTestId('ai-overview-title')).toHaveTextContent('AI Overview')
    expect(within(header).getByTestId('ai-summary-eyebrow')).toHaveTextContent('Generated by HCDP AI')
    expect(within(header).getByTestId('ai-summary-eyebrow').className).toMatch(/text-\[11px\]/)
    expect(within(header).getByTestId('ai-summary-eyebrow').querySelector('.hcdp-ai-words')).toHaveTextContent('HCDP AI')
    expect(within(header).getByTestId('ai-summary-dismiss')).toBeInTheDocument()
    // the sources row comes first, numbered, every link a real HCDP page in a new tab
    const sources = within(block).getByTestId('ai-summary-sources')
    const text = within(block).getByTestId('ai-summary-text')
    expect(before(header, sources) && before(sources, text)).toBe(true)
    expect(sources).toHaveTextContent('From HCDP:')
    const links = within(sources).getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual([MESONET, LIVE])
    expect(links[0]).toHaveTextContent('¹ Hawaiʻi Mesonet ↗')
    expect(links[1]).toHaveTextContent('² Hawaiʻi Mesonet Live Data Access ↗')
    links.forEach((a) => { expect(a).toHaveAttribute('target', '_blank'); expect(a.getAttribute('rel')).toMatch(/noopener/) })
    // the block sits above the page's heading
    expect(before(block, screen.getByRole('heading', { level: 1 }))).toBe(true)
    // the sentences: one chunk each, the reveal class, staggered 350 ms, the cites as superscript links after the text
    const chunks = within(block).getAllByTestId('ai-summary-chunk')
    expect(chunks).toHaveLength(3)
    chunks.forEach((c, i) => {
      expect(c.className).toContain('hcdp-ai-chunk')
      expect(c.style.animationDelay).toBe(`${i * CHUNK_STAGGER_MS}ms`)
      expect(c.textContent.startsWith(CHUNKS[i])).toBe(true)
      expect(c.textContent).not.toContain('[')
    })
    expect(within(chunks[0]).getAllByTestId('ai-summary-cite').map((a) => [a.textContent.trim().slice(0, 1), a.getAttribute('href')])).toEqual([['¹', MESONET]])
    expect(within(chunks[1]).getAllByTestId('ai-summary-cite').map((a) => a.getAttribute('href'))).toEqual([MESONET, LIVE])
    expect(within(chunks[1]).getAllByTestId('ai-summary-cite')[1]).toHaveTextContent('²')
    expect(within(chunks[2]).queryAllByTestId('ai-summary-cite')).toHaveLength(0)
    within(chunks[0]).getAllByTestId('ai-summary-cite').forEach((a) => { expect(a).toHaveAttribute('target', '_blank'); expect(a.className).toMatch(/text-\[10px\]/) })
    // the overview is the explanation: no reply strip
    expect(screen.queryByTestId('reply-strip')).toBeNull()
    await tick(6000)
    expect(screen.queryByTestId('reply-strip')).toBeNull()
    // collapsed: the Show more button, nothing unfolded yet
    expect(within(block).getByTestId('ai-summary-toggle')).toHaveTextContent('Show more')
    expect(within(block).getByTestId('ai-summary-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(within(block).queryByTestId('ai-summary-more')).toBeNull()
    // ✕ dismisses, and no strip takes its place
    fireEvent.click(within(block).getByTestId('ai-summary-dismiss'))
    expect(screen.queryByTestId('ai-summary')).toBeNull()
    await tick(100)
    expect(screen.queryByTestId('reply-strip')).toBeNull()
  })

  it('Show more unfolds the further sentences, "Also:" and the follow-up rows with the same fade, and reads Show less; a row sends that ask', async () => {
    replies = [navigateReply('/mesonet')]; summaries = [summaryA()]
    renderApp('/data')
    await ask('mesonet')
    const block = screen.getByTestId('ai-summary')
    fireEvent.click(within(block).getByTestId('ai-summary-toggle'))
    const more = within(block).getByTestId('ai-summary-more')
    const moreChunks = within(more).getAllByTestId('ai-summary-more-chunk')
    expect(moreChunks.map((c) => c.textContent.startsWith(MORE[0]) || c.textContent.startsWith(MORE[1]))).toEqual([true, true])
    moreChunks.forEach((c, i) => { expect(c.className).toContain('hcdp-ai-chunk'); expect(c.style.animationDelay).toBe(`${i * CHUNK_STAGGER_MS}ms`) })
    expect(within(moreChunks[0]).getAllByTestId('ai-summary-cite').map((a) => a.getAttribute('href'))).toEqual([MESONET])
    expect(within(moreChunks[1]).getAllByTestId('ai-summary-cite').map((a) => a.getAttribute('href'))).toEqual([LIVE])
    const also = within(more).getByTestId('ai-summary-also')
    expect(also).toHaveTextContent('Also:')
    expect(within(also).getByRole('link', { name: 'Access Data' })).toHaveAttribute('href', '/data')
    expect(within(also).getByRole('link', { name: /Mesonet app/ })).toHaveAttribute('target', '_blank')
    expect(also.style.animationDelay).toBe(`${MORE.length * CHUNK_STAGGER_MS}ms`)
    const rows = within(within(more).getByTestId('ai-summary-followups')).getAllByTestId('ai-summary-followup')
    expect(rows.map((r) => r.textContent.replace('↵', '').trim())).toEqual(FOLLOWUPS_A)
    expect(within(block).getByTestId('ai-summary-toggle')).toHaveTextContent('Show less')
    expect(within(block).getByTestId('ai-summary-toggle')).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(within(block).getByTestId('ai-summary-toggle'))
    expect(within(block).queryByTestId('ai-summary-more')).toBeNull()
    expect(within(block).getByTestId('ai-summary-toggle')).toHaveTextContent('Show more')
    // a follow-up row is a question: it is sent like typing it, and the same destination gets a fresh overview, collapsed again
    fireEvent.click(within(block).getByTestId('ai-summary-toggle'))
    replies = [navigateReply('/mesonet')]; summaries = [summaryB()]
    await act(async () => { fireEvent.click(within(block).getAllByTestId('ai-summary-followup')[1]); await vi.advanceTimersByTimeAsync(30) })
    expect(calls.filter((c) => c.url === '/api/navigate').at(-1).body.message).toBe(FOLLOWUPS_A[1])
    const fresh = screen.getByTestId('ai-summary')
    expect(fresh).not.toBe(block)
    expect(within(fresh).getAllByTestId('ai-summary-chunk').map((c) => c.textContent)).toEqual(['You asked for the Hurricane Lowell report.¹ source 1: Hurricane Lowell report (opens in a new tab)', 'This section tells the story of the storm.'])
    expect(within(fresh).queryByTestId('ai-summary-more')).toBeNull()
    expect(within(fresh).getByTestId('ai-summary-toggle')).toHaveTextContent('Show more')   // no `more`, but the Also links and follow-ups still unfold
  })

  it('a new navigation replaces the overview, and the docked ghost cycles the new follow-ups each time (two navigations: the second set)', async () => {
    replies = [navigateReply('/mesonet'), navigateReply('/extreme-events/lowell')]; summaries = [summaryA(), summaryB()]
    renderApp('/data')
    const bar = screen.getByTestId('assistant-bar')
    await ask('mesonet')
    expect(screen.getByTestId('probe').textContent).toBe('/mesonet')
    expect(within(screen.getByTestId('ai-summary')).getAllByTestId('ai-summary-chunk')[0]).toHaveTextContent(CHUNKS[0])
    // the field is empty (sending cleared it): the ghost starts cycling the follow-ups with no user action
    const input = within(bar).getByTestId('assistant-input')
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder', '')
    await tick(600)
    const ghost = within(bar).getByTestId('composer-ghost')
    expect(ghost).toHaveAttribute('data-pool', 'followups')
    const typedA = within(bar).getByTestId('composer-ghost-text').textContent
    expect(typedA.length).toBeGreaterThan(5)
    expect(FOLLOWUPS_A.some((f) => f.startsWith(typedA))).toBe(true)
    // Tab drops the follow-up into the field; the ghost goes while there is text
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(FOLLOWUPS_A).toContain(input.value)
    expect(within(bar).queryByTestId('composer-ghost')).toBeNull()
    fireEvent.change(input, { target: { value: '' } })
    await tick(400)
    // a tap on the ghost's text inserts it too
    fireEvent.click(within(bar).getByTestId('composer-ghost-text'))
    expect(FOLLOWUPS_A).toContain(input.value)
    fireEvent.change(input, { target: { value: '' } })
    // the second navigation: the overview is replaced, and the ghost now types the second set
    await ask('lowell report')
    expect(screen.getByTestId('probe').textContent).toBe('/extreme-events/lowell')
    const block = screen.getByTestId('ai-summary')
    expect(within(block).getAllByTestId('ai-summary-chunk').map((c) => c.textContent.split('¹')[0])).toEqual(['You asked for the Hurricane Lowell report.', 'This section tells the story of the storm.'])
    expect(within(block).getByTestId('ai-summary-sources')).toHaveTextContent('¹ Hurricane Lowell report ↗')
    expect(screen.queryByTestId('reply-strip')).toBeNull()
    await tick(700)
    const typedB = within(bar).getByTestId('composer-ghost-text').textContent
    expect(typedB.length).toBeGreaterThan(5)
    expect(FOLLOWUPS_B.some((f) => f.startsWith(typedB))).toBe(true)
    expect(FOLLOWUPS_A.some((f) => f.startsWith(typedB))).toBe(false)
  })

  it('a visitor who is typing is not interrupted: the new set takes over once the field is empty and unfocused', async () => {
    replies = [navigateReply('/mesonet')]; summaries = [summaryA()]
    renderApp('/data')
    const input = within(screen.getByTestId('assistant-bar')).getByTestId('assistant-input')
    await ask('mesonet')
    fireEvent.change(input, { target: { value: 'Which' } })
    await tick(1500)
    expect(screen.queryByTestId('composer-ghost')).toBeNull()
    expect(input).toHaveValue('Which')
    fireEvent.change(input, { target: { value: '' } })
    await tick(400)
    expect(screen.getByTestId('composer-ghost')).toHaveAttribute('data-pool', 'followups')
  })

  it('is absent on a direct load, and a route change the assistant did not cause takes it away (the docked bar then behaves as before)', async () => {
    replies = [navigateReply('/mesonet')]; summaries = [summaryA()]
    renderApp('/mesonet')
    expect(screen.queryByTestId('ai-summary')).toBeNull()
    expect(summaryCalls()).toHaveLength(0)
    await ask('mesonet')
    expect(screen.getByTestId('ai-summary')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('go-elsewhere'))
    expect(screen.getByTestId('probe').textContent).toBe('/elsewhere')
    expect(screen.queryByTestId('ai-summary')).toBeNull()
    await tick(500)
    expect(screen.queryByTestId('composer-ghost')).toBeNull()
    expect(within(screen.getByTestId('assistant-bar')).getByTestId('assistant-input')).toHaveAttribute('placeholder', 'Ask for another page or map…')
  })

  it('shows the reply strip as before when the overview comes back empty or the call fails', async () => {
    replies = [navigateReply('/mesonet'), navigateReply('/data')]; summaries = [emptySummary(), new Error('down')]
    renderApp('/mesonet')
    await ask('mesonet')
    expect(screen.queryByTestId('ai-summary')).toBeNull()
    expect(screen.getByTestId('reply-strip')).toHaveTextContent('Taking you to /mesonet.')
    await ask('data')
    expect(screen.getByTestId('probe').textContent).toBe('/data')
    expect(screen.queryByTestId('ai-summary')).toBeNull()
    expect(screen.getByTestId('reply-strip')).toHaveTextContent('Taking you to /data.')
    // and the same from the landing page, after the travel
    replies = [navigateReply('/mesonet')]; summaries = [emptySummary()]
    const { unmount } = render(<div />); unmount()
  })

  it('from the landing with a failed overview the strip shows after the arrival; a summary without follow-ups leaves the docked bar as today', async () => {
    replies = [navigateReply('/mesonet')]; summaries = [{ ...summaryA(), followups: [] }]
    renderApp('/')
    await ask('mesonet')
    await tick(HOLD_MS + TRAVEL_MS + 50)
    expect(screen.getByTestId('ai-summary')).toBeInTheDocument()
    expect(screen.queryByTestId('reply-strip')).toBeNull()
    await tick(600)
    expect(screen.queryByTestId('composer-ghost')).toBeNull()
    expect(screen.getByTestId('assistant-input')).toHaveAttribute('placeholder', 'Ask for another page or map…')
  })

  it('while the overview is being written the block shows its header and a comet ring — no strip; it fills in when the sentences arrive', async () => {
    let resolve
    replies = [navigateReply('/mesonet')]; summaries = [new Promise((r) => { resolve = r })]
    renderApp('/data')
    await ask('mesonet')
    const block = screen.getByTestId('ai-summary')
    expect(block).toHaveAttribute('data-status', 'pending')
    expect(within(block).getByTestId('ai-overview-title')).toHaveTextContent('AI Overview')
    expect(within(block).getByTestId('ai-summary-pending').querySelector('.hcdp-comet-ring')).not.toBeNull()
    expect(screen.queryByTestId('reply-strip')).toBeNull()
    await act(async () => { resolve(json(summaryA())); await vi.advanceTimersByTimeAsync(10) })
    expect(screen.getByTestId('ai-summary')).toHaveAttribute('data-status', 'ready')
    expect(screen.getAllByTestId('ai-summary-chunk')).toHaveLength(3)
    expect(screen.queryByTestId('reply-strip')).toBeNull()
  })

  it('a pending overview that fails after the arrival gives way to the strip', async () => {
    let reject
    replies = [navigateReply('/mesonet')]; summaries = [new Promise((_, r) => { reject = r })]
    renderApp('/data')
    await ask('mesonet')
    expect(screen.getByTestId('ai-summary')).toHaveAttribute('data-status', 'pending')
    await act(async () => { reject(new Error('timeout')); await vi.advanceTimersByTimeAsync(10) })
    expect(screen.queryByTestId('ai-summary')).toBeNull()
    expect(screen.getByTestId('reply-strip')).toHaveTextContent('Taking you to /mesonet.')
  })

  it('reduced motion: the sentences come all at once', async () => {
    window.matchMedia = (q) => ({ matches: /reduce/.test(q), addEventListener() {}, removeEventListener() {} })
    replies = [navigateReply('/mesonet')]; summaries = [summaryA()]
    renderApp('/data')
    await ask('mesonet')
    screen.getAllByTestId('ai-summary-chunk').forEach((c) => expect(c.style.animationDelay).toBe(''))
  })
})

describe('the docked bar while the AI works', () => {
  it('shows the comet ring with "Working on that…" under the bar, then the narration line, then nothing', async () => {
    let resolve
    replies = [new Promise((r) => { resolve = r })]
    renderApp('/data')
    await ask('where is the API')
    const line = screen.getByTestId('docked-working')
    expect(line.querySelector('.hcdp-comet-ring')).not.toBeNull()
    expect(within(line).getByTestId('docked-status')).toHaveTextContent('Working on that…')
    expect(line.className).not.toMatch(/bg-|border/)
    expect(screen.queryByTestId('reply-strip')).toBeNull()
    await act(async () => { resolve(json({ intent: 'info', reply: 'The API page explains it.', actions: [], alternatives: [] })); await vi.advanceTimersByTimeAsync(10) })
    expect(screen.queryByTestId('docked-working')).toBeNull()
  })

  it('replaces the fallback with gpt-6-luna\'s line when it arrives first', async () => {
    let resolve
    narrate = 'Pulling up the API access info'
    replies = [new Promise((r) => { resolve = r })]
    renderApp('/data')
    await ask('where is the API')
    expect(screen.getByTestId('docked-status')).toHaveTextContent('Pulling up the API access info')
    await act(async () => { resolve(json({ intent: 'info', reply: 'ok', actions: [], alternatives: [] })); await vi.advanceTimersByTimeAsync(10) })
    expect(screen.queryByTestId('docked-working')).toBeNull()
  })
})

describe('placement helpers', () => {
  it('PageShell can leave the block to the page, which then scrolls it into view on arrival (the data page)', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    replies = [navigateReply('/custom')]; summaries = [summaryA()]
    function Custom() { return <PageShell title="Custom" summary={false}><div data-testid="export-form-stand-in"><AISummary scrollIntoView className="mb-5" /><p>form</p></div></PageShell> }
    render(
      <ThemeProvider><TooltipProvider><MemoryRouter initialEntries={['/data']}><AssistantProvider>
        <Routes><Route element={<Shell />}><Route path="custom" element={<Custom />} /><Route path="*" element={<Page />} /></Route></Routes>
      </AssistantProvider></MemoryRouter></TooltipProvider></ThemeProvider>,
    )
    await ask('custom')
    const block = screen.getByTestId('ai-summary')
    expect(screen.getAllByTestId('ai-summary')).toHaveLength(1)                    // not above the heading as well
    expect(before(screen.getByRole('heading', { level: 1 }), block)).toBe(true)   // below the heading, above the form
    expect(scroll).not.toHaveBeenCalled()
    await tick(100)
    expect(scroll).toHaveBeenCalledTimes(1)
  })

  it('superscripts', () => {
    expect(superscript(1)).toBe('¹'); expect(superscript(12)).toBe('¹²')
  })
})

describe('placement on pages that scroll to a target on load', () => {
  // These pages land the visitor on a storm's section, a tool's tile, the live viewers or the dashboard, so the overview
  // must be where they land, not above a heading they never see.
  const renderPages = (entry) => render(
    <ThemeProvider><TooltipProvider><MemoryRouter initialEntries={[entry]}><AssistantProvider>
      <Routes><Route element={<Shell />}>
        <Route path="extreme-events" element={<ExtremeEvents />} /><Route path="extreme-events/:slug" element={<ExtremeEvents />} />
        <Route path="tools/:slug" element={<ClimateTools />} /><Route path="mesonet" element={<Mesonet />} /><Route path="climate-summary" element={<ClimateSummary />} />
        <Route path="*" element={<Page />} />
      </Route></Routes>
    </AssistantProvider></MemoryRouter></TooltipProvider></ThemeProvider>,
  )
  const arriveAt = async (path, summary = summaryB()) => { replies = [navigateReply(path)]; summaries = [summary]; renderPages('/data'); await ask('go'); await tick(150) }
  afterEach(() => { Element.prototype.scrollIntoView = () => {} })

  it('a storm page: inside the storm section the page scrolls to, below the page heading', async () => {
    await arriveAt('/extreme-events/lowell')
    const blocks = screen.getAllByTestId('ai-summary')
    expect(blocks).toHaveLength(1)
    expect(document.getElementById('lowell').contains(blocks[0])).toBe(true)
    expect(before(screen.getByRole('heading', { level: 1 }), blocks[0])).toBe(true)
    expect(before(within(document.getElementById('lowell')).getByRole('heading', { level: 2 }), blocks[0])).toBe(true)
  })

  it('a storm named by hash (/extreme-events#lala): the same, in that section; the index without a storm: above the heading', async () => {
    await arriveAt('/extreme-events#lala')
    expect(document.getElementById('lala').contains(screen.getByTestId('ai-summary'))).toBe(true)
  })

  it('the events index: above the heading', async () => {
    await arriveAt('/extreme-events')
    const block = screen.getByTestId('ai-summary')
    expect(before(block, screen.getByRole('heading', { level: 1 }))).toBe(true)
    expect([...document.querySelectorAll('section[id]')].some((sec) => sec.contains(block))).toBe(false)
  })

  it('a tool page: above the heading, and the page lands on the overview instead of centring the tile, which is still ringed', async () => {
    const calls = []
    Element.prototype.scrollIntoView = vi.fn(function (opts) { calls.push([this, opts]) })
    await arriveAt('/tools/h-rip')
    const block = screen.getByTestId('ai-summary')
    expect(before(block, screen.getByRole('heading', { level: 1 }))).toBe(true)
    const last = calls[calls.length - 1]
    expect(last[0]).toBe(block)
    expect(last[1]).toEqual({ block: 'start' })
    expect(document.getElementById('tool-h-rip').className).toContain('ring-4')
  })

  it('a Mesonet station link: inside the live viewers section', async () => {
    await arriveAt('/mesonet?viewer=live&station=0115&view=dashboard')
    expect(screen.getAllByTestId('ai-summary')).toHaveLength(1)
    expect(document.getElementById('viewers').contains(screen.getByTestId('ai-summary'))).toBe(true)
  })

  it('a summary month link: inside the dashboard section', async () => {
    await arriveAt('/climate-summary?year=2026&month=8')
    expect(screen.getAllByTestId('ai-summary')).toHaveLength(1)
    expect(document.getElementById('dashboard').contains(screen.getByTestId('ai-summary'))).toBe(true)
  })
})
