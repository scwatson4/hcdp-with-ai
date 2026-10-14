import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AssistantProvider, useAssistant } from '../assistant/AssistantProvider'
import App from '../App'

// The review-period feedback inside the phone's Ask AI sheet (M2 A, 14 Oct): the sheet shows the latest reply through
// <Conversation>, so its 👍 / 👎 are there; the composer a 👎 opens sits ABOVE the sheet (z 1300 over its 71), and an Esc
// inside the composer closes the composer only.
let assistant = null
function Grab() { assistant = useAssistant(); return null }
const mount = (path = '/data') => render(
  <MemoryRouter initialEntries={[path]}>
    <AssistantProvider>
      <Grab />
      <Routes>
        <Route element={<App />}>
          <Route path="data" element={<p>Access data page</p>} />
        </Route>
      </Routes>
    </AssistantProvider>
  </MemoryRouter>,
)
let posts
beforeEach(() => {
  posts = []
  window.matchMedia = (q) => ({ matches: /max-width:\s*(767|639)px/.test(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } })
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url) === '/api/navigate') return { ok: true, status: 200, json: async () => ({ intent: 'info', reply: 'The API page explains tokens.', actions: [], alternatives: [{ title: 'API', url: '/data/api', why: 'tokens' }] }) }
    if (String(url) === '/api/feedback') { posts.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: 'e'.repeat(32) }) } }
    return { ok: true, status: 200, json: async () => ({}) }
  }))
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  window.scrollTo = () => {}
  Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true, writable: true })
  window.localStorage.clear()
})
afterEach(() => { vi.unstubAllGlobals(); document.documentElement.classList.remove('hcdp-scroll-lock') })

describe('feedback in the phone’s Ask AI sheet', () => {
  it('👍 / 👎 sit under the reply in the sheet; 👎 opens the composer above it; Esc there leaves the sheet open', async () => {
    mount('/data')
    await act(async () => { await assistant.send('where is the API', { docked: true }) })
    const sheet = await screen.findByTestId('ask-sheet')
    const bubble = within(sheet).getByTestId('assistant-bubble')
    await act(async () => { fireEvent.click(within(bubble).getByTestId('thumbs-up')) })
    expect(posts[0]).toMatchObject({ kind: 'thumbs', rating: 'up', feature: 'answer', ask: 'where is the API', reply: 'The API page explains tokens.', page: { path: '/data' } })
    fireEvent.click(within(bubble).getByTestId('thumbs-down'))
    expect(within(bubble).getByTestId('thumbs-chooser-row')).toHaveTextContent('API · tokens')
    fireEvent.click(within(bubble).getByTestId('thumbs-chooser-row'))
    const panel = screen.getByTestId('feedback-panel')
    expect(panel).toHaveAttribute('data-variant', 'sheet')
    expect(panel.className).toContain('z-[1300]')                                   // above the Ask AI sheet (z-[71])
    expect(within(panel).getByTestId('composer-wanted')).toHaveTextContent('/data/api')
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(screen.queryByTestId('feedback-panel')).toBeNull()
    expect(screen.getByTestId('ask-sheet')).toBeInTheDocument()                     // the Esc stayed in the composer
  })
})
