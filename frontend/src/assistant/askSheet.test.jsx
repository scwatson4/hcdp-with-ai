import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { AssistantProvider, WELCOME_TEXT, useAssistant } from './AssistantProvider'
import { CHIPS } from './AssistantPanel'
import { GOO_MS } from './AskSheet'
import App from '../App'

// M2 A (14 Oct): below 768 px the assistant opens as a full-width bottom sheet, two-thirds high, with the welcome line,
// the template chips (or the address's follow-ups), the latest reply, and the question box above the keyboard; a scrim
// holds the page; the scrim, the ✕, the handle or Back closes it with the goo; it owns one history entry.
function screenWidth(phone) {
  window.matchMedia = (q) => ({ matches: phone && /max-width:\s*767px/.test(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } })
}
let probe = {}
function Probe() {
  const loc = useLocation()
  const navigate = useNavigate()
  probe = { loc, back: () => navigate(-1) }
  return <output data-testid="loc">{loc.pathname + loc.search}</output>
}
let assistant = null
function Grab() { assistant = useAssistant(); return null }
const mount = (path = '/data') => render(
  <MemoryRouter initialEntries={[path]}>
    <AssistantProvider>
      <Grab />
      <Routes>
        <Route element={<App />}>
          <Route path="/" element={<p>Landing</p>} />
          <Route path="data" element={<p>Access data page</p>} />
          <Route path="mesonet" element={<p>Mesonet page</p>} />
        </Route>
      </Routes>
      <Probe />
    </AssistantProvider>
  </MemoryRouter>,
)
const dockedField = () => within(screen.getByTestId('assistant-bar')).getByTestId('assistant-input')
const openSheet = () => { fireEvent.click(within(screen.getByTestId('assistant-bar')).getByTestId('ask-field')) }
let navigateReply = null
beforeEach(() => {
  screenWidth(true)
  navigateReply = { intent: 'info', reply: 'The API page explains tokens.', actions: [], alternatives: [] }
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url) === '/api/navigate') return { ok: true, status: 200, json: async () => navigateReply }
    return { ok: true, status: 200, json: async () => ({}) }
  }))
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  window.scrollTo = () => {}
  Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true, writable: true })
})
afterEach(() => { vi.unstubAllGlobals(); delete window.visualViewport; document.documentElement.classList.remove('hcdp-scroll-lock') })

describe('the Ask AI sheet below 768 px (M2 A)', () => {
  it('opens from a tap on the docked bar with a history entry, holds the page still, and Back closes it with the goo', async () => {
    mount('/data')
    expect(dockedField()).toHaveAttribute('readonly')   // the docked bar is the door; the sheet's field takes the keyboard
    expect(screen.queryByTestId('ask-sheet')).toBeNull()
    openSheet()
    const sheet = await screen.findByTestId('ask-sheet')
    expect(probe.loc.state).toEqual({ hcdpOverlay: 'ask' })   // one history entry
    expect(screen.getByTestId('loc')).toHaveTextContent('/data')
    expect(sheet).toHaveAttribute('role', 'dialog')
    expect(sheet.style.height).toBe(`${Math.round(844 * 2 / 3)}px`)   // two-thirds of the screen
    expect(screen.getByTestId('ask-sheet-scrim')).toBeInTheDocument()
    expect(document.documentElement.classList.contains('hcdp-scroll-lock')).toBe(true)
    act(() => probe.back())
    // the goo: the sheet stays a moment, melting, then goes
    await waitFor(() => expect(screen.getByTestId('ask-sheet')).toHaveAttribute('data-closing', 'true'))
    expect(screen.getByTestId('ask-sheet').className).toContain('hcdp-goo-close')
    expect(screen.getByTestId('ask-sheet').parentElement.className).toContain('hcdp-goo-wrap')
    await waitFor(() => expect(screen.queryByTestId('ask-sheet')).toBeNull(), { timeout: GOO_MS + 1000 })
    expect(document.documentElement.classList.contains('hcdp-scroll-lock')).toBe(false)
    expect(screen.getByTestId('loc')).toHaveTextContent('/data')
  })

  it('shows the welcome line, the four template chips, a 44 px send and no keyboard hint; with follow-ups for the address the chips are those', async () => {
    mount('/data')
    openSheet()
    const sheet = await screen.findByTestId('ask-sheet')
    expect(within(sheet).getByTestId('ask-sheet-welcome')).toHaveTextContent(WELCOME_TEXT)
    expect(within(sheet).getAllByTestId('ask-sheet-chip').map((b) => b.textContent)).toEqual(CHIPS.map((c) => c.label))
    expect(within(sheet).getAllByTestId('ask-sheet-chip').every((b) => /\bh-11\b|min-h-11/.test(b.className))).toBe(true)
    const box = within(sheet).getByTestId('ask-sheet-box')
    expect(within(box).getByRole('button', { name: 'Send' }).className).toContain('h-11 w-11')
    expect(within(sheet).getByRole('button', { name: 'Close' }).className).toContain('h-11 w-11')
    expect(within(sheet).queryByTestId('ask-tab-hint')).toBeNull()
    expect(within(sheet).queryByTestId('composer-ghost')).toBeNull()   // the chips carry the suggestions; the field has none
    expect(within(sheet).queryByTestId('conversation')).toBeNull()   // nothing said yet
    act(() => probe.back())
    await waitFor(() => expect(screen.queryByTestId('ask-sheet')).toBeNull(), { timeout: GOO_MS + 1000 })
    act(() => assistant.setFollowups('/data', ['Show the rainfall map for September', 'Where is the station data?']))
    openSheet()
    const again = await screen.findByTestId('ask-sheet')
    expect(within(again).getByTestId('ask-sheet-chips')).toHaveAttribute('data-pool', 'followups')
    expect(within(again).getAllByTestId('ask-sheet-chip').map((b) => b.textContent)).toEqual(['Show the rainfall map for September', 'Where is the station data?'])
    // a follow-up chip asks it
    fireEvent.click(within(again).getAllByTestId('ask-sheet-chip')[1])
    await waitFor(() => expect(global.fetch.mock.calls.some(([u, init]) => u === '/api/navigate' && JSON.parse(init.body).message === 'Where is the station data?')).toBe(true))
    // the reply (info: nowhere to go) shows in the sheet — the latest one only
    expect(await within(again).findByTestId('assistant-bubble')).toHaveTextContent('The API page explains tokens.')
    expect(within(again).queryByTestId('user-bubble')).toBeNull()
  })

  it('a template chip fills the sheet’s field with its first blank selected', async () => {
    mount('/data')
    openSheet()
    const sheet = await screen.findByTestId('ask-sheet')
    fireEvent.click(within(sheet).getAllByTestId('ask-sheet-chip')[0])
    const field = within(within(sheet).getByTestId('ask-sheet-box')).getByTestId('assistant-input')
    await waitFor(() => expect(field).toHaveValue(CHIPS[0].template))
    const at = CHIPS[0].template.indexOf(CHIPS[0].blanks[0])
    expect([field.selectionStart, field.selectionEnd]).toEqual([at, at + CHIPS[0].blanks[0].length])
    expect(document.activeElement).toBe(field)
    // the docked bar under the header did not take the template
    expect(dockedField()).toHaveValue('')
  })

  it('closes from the scrim, the ✕ and a drag on the handle; a short drag springs back', async () => {
    mount('/data')
    for (const how of ['scrim', 'close']) {
      openSheet()
      await screen.findByTestId('ask-sheet')
      fireEvent.click(screen.getByTestId(how === 'scrim' ? 'ask-sheet-scrim' : 'ask-sheet-close'))
      await waitFor(() => expect(screen.queryByTestId('ask-sheet')).toBeNull(), { timeout: GOO_MS + 1000 })
      expect(probe.loc.state).toBeFalsy()
    }
    openSheet()
    const handle = await screen.findByTestId('ask-sheet-handle')
    const press = (type, clientY) => act(() => { const e = new Event(type, { bubbles: true }); Object.assign(e, { pointerId: 1, button: 0, clientY }); handle.dispatchEvent(e) })
    press('pointerdown', 300); press('pointermove', 340); press('pointerup', 340)   // 40 px: stays
    expect(screen.getByTestId('ask-sheet')).not.toHaveAttribute('data-closing')
    press('pointerdown', 300); press('pointermove', 420); press('pointerup', 420)   // 120 px: closes
    await waitFor(() => expect(screen.queryByTestId('ask-sheet')).toBeNull(), { timeout: GOO_MS + 1000 })
  })

  it('pins the question box above the keyboard (visualViewport)', async () => {
    const listeners = {}
    window.visualViewport = { height: 508, offsetTop: 0, addEventListener: (t, f) => { listeners[t] = f }, removeEventListener() {} }
    mount('/data')
    openSheet()
    const sheet = await screen.findByTestId('ask-sheet')
    expect(sheet.parentElement.style.bottom).toBe('336px')            // the keyboard's 336 px
    expect(parseInt(sheet.style.height, 10)).toBeLessThanOrEqual(508 - 24)   // it fits above it
    window.visualViewport.height = 844
    act(() => listeners.resize?.())
    await waitFor(() => expect(sheet.parentElement.style.bottom).toBe('0px'))
  })

  it('an answer that navigates replaces the sheet’s entry: the page changes, the sheet goes, and Back returns to the page before with the sheet closed', async () => {
    navigateReply = { intent: 'navigate', reply: 'Hawaiʻi Mesonet has the live stations.', actions: [{ type: 'navigate', path: '/mesonet' }], alternatives: [], destination: { title: 'Hawaiʻi Mesonet', path: '/mesonet' } }
    mount('/data')
    openSheet()
    const sheet = await screen.findByTestId('ask-sheet')
    const field = within(within(sheet).getByTestId('ask-sheet-box')).getByTestId('assistant-input')
    fireEvent.change(field, { target: { value: 'live stations' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/mesonet'))
    expect(probe.loc.state).toBeFalsy()
    await waitFor(() => expect(screen.queryByTestId('ask-sheet')).toBeNull(), { timeout: GOO_MS + 1000 })
    act(() => probe.back())
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/data'))
    expect(probe.loc.state).toBeFalsy()                       // not the sheet's entry: it was replaced
    expect(screen.queryByTestId('ask-sheet')).toBeNull()
  })

  it('a reply with nowhere to go, asked from somewhere else on the page, opens the sheet instead of the dropdown', async () => {
    mount('/data')
    await act(async () => { await assistant.send('where is the API', { docked: true }) })
    expect(await screen.findByTestId('ask-sheet')).toBeInTheDocument()
    expect(screen.queryByTestId('assistant-dropdown')).toBeNull()
    expect(within(screen.getByTestId('ask-sheet')).getByTestId('assistant-bubble')).toHaveTextContent('The API page explains tokens.')
  })

  it('at 768 px and up there is no sheet: the docked bar is a field with its dropdown', async () => {
    screenWidth(false)
    mount('/data')
    expect(dockedField()).not.toHaveAttribute('readonly')
    fireEvent.click(within(screen.getByTestId('assistant-bar')).getByTestId('ask-field'))
    expect(screen.queryByTestId('ask-sheet')).toBeNull()
    await act(async () => { await assistant.send('where is the API', { docked: true }) })
    expect(await screen.findByTestId('assistant-dropdown')).toBeInTheDocument()
    expect(screen.queryByTestId('ask-sheet')).toBeNull()
  })
})
