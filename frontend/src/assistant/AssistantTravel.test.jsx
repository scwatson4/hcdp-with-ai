import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom'
import { AssistantProvider, HOLD_MS, TRAVEL_MS, STRIP_MS } from './AssistantProvider'
import AssistantBar from './AssistantBar'
import Landing from '../pages/Landing'

// R1 picks A + D (2026-10-08): answer first, then the bar rides up and docks under the header.
const VIEW = '/viewer/rainfall/day/2026-09-07/kauai'
const REPLY = 'Here is the Kauaʻi rainfall map for 7 September 2026.'
const navigateReply = (path = VIEW) => ({ ok: true, status: 200, json: () => Promise.resolve({ intent: 'navigate', reply: REPLY, actions: [{ type: 'navigate', path }], alternatives: [{ title: 'Access Data', url: '/data', why: 'downloads' }, { title: 'Lowell report', url: 'https://www.hawaii.edu/climate-data-portal/hurricane-lowell/', why: 'the report' }, { title: 'A third one', url: '/mesonet' }], minimize: true }) })
const infoReply = () => ({ ok: true, status: 200, json: () => Promise.resolve({ intent: 'info', reply: 'HCDP is the Hawaiʻi Climate Data Portal.', actions: [], alternatives: [] }) })
const backdrops = () => ({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }) })

function Probe() { const { pathname } = useLocation(); return <div data-testid="probe">{pathname}</div> }
function Shell() { return <><div data-testid="sticky-header"><AssistantBar /></div><Probe /><Outlet /></> }
const renderApp = (entry = '/') => render(
  <MemoryRouter initialEntries={[entry]}>
    <AssistantProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Landing />} />
          <Route path="*" element={<div data-testid="inner-page">inner</div>} />
        </Route>
      </Routes>
    </AssistantProvider>
  </MemoryRouter>,
)
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const ask = async (q) => {
  const input = screen.getAllByTestId('assistant-input')[0]
  fireEvent.change(input, { target: { value: q } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await tick(30)
}
let reply
beforeEach(() => {
  vi.useFakeTimers()
  reply = navigateReply
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(url === '/api/navigate' ? reply() : backdrops())))
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('answer first, then travel (landing page)', () => {
  it('shows the reply under the bar (AI bubble only, the question stays in the bar), holds 700 ms, rides up 450 ms, then navigates', async () => {
    renderApp('/')
    await ask('rain map kauai')
    // the hold: still on the landing page, the answer card shows the reply and no echoed question
    expect(screen.getByTestId('probe').textContent).toBe('/')
    const card = screen.getByTestId('landing-answers')
    expect(within(card).getByTestId('assistant-bubble')).toHaveTextContent(REPLY)
    expect(within(card).queryByTestId('user-bubble')).toBeNull()
    expect(screen.getByTestId('assistant-input')).toHaveValue('rain map kauai')
    expect(screen.getByTestId('landing-hero')).toHaveAttribute('data-travel', 'hold')
    expect(screen.queryByTestId('assistant-bar')).toBeNull()
    await tick(HOLD_MS - 60)
    expect(screen.getByTestId('probe').textContent).toBe('/')
    expect(screen.getByTestId('landing-hero')).toHaveAttribute('data-travel', 'hold')
    await tick(70)
    // the ride-up: the hero lifts, the docked bar is there invisibly to be measured, still on /
    expect(screen.getByTestId('landing-hero')).toHaveAttribute('data-travel', 'travel')
    expect(screen.getByTestId('landing-hero').className).toContain('hcdp-hero-lift')
    expect(screen.getByTestId('assistant-bar')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('probe').textContent).toBe('/')
    await tick(TRAVEL_MS - 60)
    expect(screen.getByTestId('probe').textContent).toBe('/')
    await tick(70)
    // arrived: the docked bar under the header, the hero gone, no pill anywhere
    expect(screen.getByTestId('probe').textContent).toBe(VIEW)
    expect(screen.getByTestId('assistant-bar')).not.toHaveAttribute('aria-hidden')
    expect(screen.getAllByTestId('assistant-input')).toHaveLength(1)
    expect(screen.getByTestId('assistant-input')).toHaveAttribute('placeholder', 'Ask for another page or map…')
    expect(screen.queryByTestId('landing-hero')).toBeNull()
    expect(screen.queryByTestId('assistant-dock')).toBeNull()
    expect(screen.queryByTestId('assistant-dock-panel')).toBeNull()
    // the strip repeats the reply with up to two alternatives, for five seconds
    const strip = screen.getByTestId('reply-strip')
    expect(strip).toHaveTextContent(REPLY)
    expect(within(strip).getByRole('link', { name: 'Access Data' })).toHaveAttribute('href', '/data')
    expect(within(strip).getByRole('link', { name: /Lowell report/ })).toHaveAttribute('target', '_blank')
    expect(within(strip).queryByText('A third one')).toBeNull()
    expect(screen.queryByTestId('assistant-dropdown')).toBeNull()
    await tick(STRIP_MS - 200)
    expect(screen.getByTestId('reply-strip')).toBeInTheDocument()
    await tick(300)
    expect(screen.queryByTestId('reply-strip')).toBeNull()
  })

  it('hover and focus hold the strip; clicking it opens the dropdown', async () => {
    renderApp('/')
    await ask('rain map kauai')
    await tick(HOLD_MS + TRAVEL_MS + 50)
    const strip = screen.getByTestId('reply-strip')
    fireEvent.mouseEnter(strip)
    await tick(STRIP_MS + 2000)
    expect(screen.getByTestId('reply-strip')).toBeInTheDocument()
    fireEvent.mouseLeave(strip)
    await tick(STRIP_MS + 100)
    expect(screen.queryByTestId('reply-strip')).toBeNull()
  })

  it('reduced motion: the hold, then a cut — no ride-up', async () => {
    window.matchMedia = (q) => ({ matches: /reduce/.test(q), addEventListener() {}, removeEventListener() {} })
    renderApp('/')
    await ask('rain map kauai')
    await tick(HOLD_MS - 60)
    expect(screen.getByTestId('probe').textContent).toBe('/')
    await tick(70)
    expect(screen.getByTestId('probe').textContent).toBe(VIEW)
    expect(screen.getByTestId('reply-strip')).toHaveTextContent(REPLY)
  })

  it('an info reply stays in the card (no travel) and still never echoes the question', async () => {
    reply = infoReply
    renderApp('/')
    await ask('what is HCDP')
    await tick(HOLD_MS + TRAVEL_MS + 100)
    expect(screen.getByTestId('probe').textContent).toBe('/')
    const card = screen.getByTestId('landing-answers')
    expect(within(card).getByTestId('assistant-bubble')).toHaveTextContent('HCDP is the Hawaiʻi Climate Data Portal.')
    expect(within(card).queryByTestId('user-bubble')).toBeNull()
    expect(screen.queryByTestId('assistant-bar')).toBeNull()
  })

  it('a click elsewhere during the hold cancels the travel', async () => {
    renderApp('/')
    await ask('rain map kauai')
    fireEvent.click(screen.getByTestId('sidebar-buttons').querySelector('a[href="/data"]'))
    expect(screen.getByTestId('probe').textContent).toBe('/data')
    await tick(HOLD_MS + TRAVEL_MS + 100)
    expect(screen.getByTestId('probe').textContent).toBe('/data')
  })
})

describe('the docked bar (inner pages)', () => {
  it('is there instead of a pill; its dropdown opens with a reply or on focus once a conversation exists, and closes with Esc, a click outside, or a navigation', async () => {
    reply = infoReply
    renderApp('/data')
    expect(screen.queryByTestId('assistant-dock')).toBeNull()
    const bar = screen.getByTestId('assistant-bar')
    const input = within(bar).getByTestId('assistant-input')
    expect(input).toHaveAttribute('placeholder', '')   // no conversation yet: the typewriter ghost is on
    expect(within(bar).getByTestId('composer-ghost')).toBeInTheDocument()
    fireEvent.focus(input)
    expect(screen.queryByTestId('assistant-dropdown')).toBeNull()   // nothing to show yet
    await ask('what is HCDP')
    const dropdown = screen.getByTestId('assistant-dropdown')   // a reply with nowhere to go opens it
    expect(within(dropdown).getByTestId('user-bubble')).toHaveTextContent('what is HCDP')
    expect(within(dropdown).getByTestId('assistant-bubble')).toHaveTextContent('HCDP is the Hawaiʻi Climate Data Portal.')
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder', 'Ask for another page or map…')   // the ghost is off once a conversation exists
    expect(within(bar).queryByTestId('composer-ghost')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('assistant-dropdown')).toBeNull()
    fireEvent.focus(input)
    expect(screen.getByTestId('assistant-dropdown')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('assistant-dropdown')).toBeNull()
    fireEvent.focus(input)
    expect(screen.getByTestId('assistant-dropdown')).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('assistant-dropdown')).getByTestId('assistant-close'))
    expect(screen.queryByTestId('assistant-dropdown')).toBeNull()
    // a navigation from an inner page goes at once, closes the dropdown and shows the strip
    fireEvent.focus(input)
    reply = () => navigateReply('/mesonet')
    await ask('mesonet')
    expect(screen.getByTestId('probe').textContent).toBe('/mesonet')
    expect(screen.queryByTestId('assistant-dropdown')).toBeNull()
    expect(screen.getByTestId('reply-strip')).toHaveTextContent(REPLY)
    fireEvent.click(screen.getByTestId('reply-strip-text'))
    expect(screen.queryByTestId('reply-strip')).toBeNull()
    expect(screen.getByTestId('assistant-dropdown')).toBeInTheDocument()
    expect(screen.getAllByTestId('user-bubble')).toHaveLength(2)
  })

  it('arriving on the landing page brings the conversation back into the hero bar and hides the docked bar', async () => {
    reply = () => navigateReply('/')
    renderApp('/data')
    await ask('home')
    expect(screen.getByTestId('probe').textContent).toBe('/')
    expect(screen.queryByTestId('assistant-bar')).toBeNull()
    expect(screen.getByTestId('landing-hero')).toBeInTheDocument()
    expect(within(screen.getByTestId('landing-answers')).getByTestId('assistant-bubble')).toHaveTextContent(REPLY)
  })
})
