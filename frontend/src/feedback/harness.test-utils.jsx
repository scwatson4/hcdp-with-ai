// Shared test harness for the review-period feedback (not a test file itself): the assistant, the docked bar, a page with
// an AI overview, the landing panel and the feedback layer, with fetch answered from memory.
import React from 'react'
import { vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom'
import { AssistantProvider } from '../assistant/AssistantProvider'
import AssistantBar from '../assistant/AssistantBar'
import AssistantPanel from '../assistant/AssistantPanel'
import AISummary from '../assistant/AISummary'
import { TooltipProvider } from '../components/ui/tooltip'
import { FeedbackProvider } from './FeedbackProvider'
import FeedbackLayer from './FeedbackLayer'

export const ALTS = [{ title: 'Access Data', url: '/data', why: 'downloads' }, { title: 'Mesonet app', url: 'https://hawaiimesonet.app/', why: 'the app' }]
export const navigateReply = (path) => ({ intent: 'navigate', reply: `Taking you to ${path}.`, actions: [{ type: 'navigate', path }], alternatives: ALTS, minimize: true, destination: { title: 'A page', path } })
export const INFO = { intent: 'info', reply: 'HCDP is the Hawaiʻi Climate Data Portal.', actions: [], alternatives: ALTS }
export const summary = () => ({ summary: 'x', chunks: ['You asked for the Mesonet.', 'This page embeds the live viewer.'], cites: [[], []], more: [], more_cites: [], sources: [], followups: [], request_id: 'f'.repeat(32) })
export const json = (body, status = 200) => ({ ok: status < 300, status, json: () => Promise.resolve(body), blob: () => Promise.resolve(new Blob([JSON.stringify(body)])) })

export const state = { calls: [], replies: [], mine: [], others: [], feedback: null }
export function fetchMock(url, init) {
  const body = init?.body ? JSON.parse(init.body) : null
  state.calls.push({ url, method: init?.method || 'GET', body })
  if (url === '/api/navigate') return Promise.resolve(json(state.replies.shift() || navigateReply('/mesonet')))
  if (url === '/api/summary') return Promise.resolve(json(summary()))
  if (url === '/api/feedback') return Promise.resolve(state.feedback ? state.feedback(body) : json({ id: 'e'.repeat(32) }))
  if (url.startsWith('/api/feedback/mine')) return Promise.resolve(json({ rows: state.mine }))
  if (url.startsWith('/api/feedback/others')) return Promise.resolve(json({ rows: state.others }))
  if (url === '/api/feedback/rename') return Promise.resolve(json({ ok: true, changed: 2 }))
  if (url === '/api/feedback/wrong-page') return Promise.resolve(json({ id: 'a'.repeat(32) }))
  return Promise.resolve(json({}))
}
export const posts = () => state.calls.filter((c) => c.url === '/api/feedback' && c.method === 'POST')

function Probe() { const { pathname } = useLocation(); return <div data-testid="probe">{pathname}</div> }
function Page() {
  const { pathname } = useLocation()
  return (
    <article>
      <h1>Page {pathname}</h1>
      <AISummary />
      <p data-testid="body-text">The HCDP was founded in 2019 to bring the data together.</p>
    </article>
  )
}
function Landing() { return <div data-testid="landing-assistant"><AssistantPanel /></div> }
function Shell() {
  return (
    <FeedbackProvider>
      <div data-testid="sticky-header"><AssistantBar /></div>
      <Probe />
      <main id="main"><Outlet /></main>
      <FeedbackLayer />
    </FeedbackProvider>
  )
}
export const renderApp = (entry = '/data') => render(
  <TooltipProvider><MemoryRouter initialEntries={[entry]}><AssistantProvider>
    <Routes><Route element={<Shell />}><Route index element={<Landing />} /><Route path="*" element={<Page />} /></Route></Routes>
  </AssistantProvider></MemoryRouter></TooltipProvider>,
)

export const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
export const ask = async (q) => {
  const input = screen.getAllByTestId('assistant-input')[0]
  fireEvent.change(input, { target: { value: q } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await tick(30)
}
export const click = async (el) => { await act(async () => { fireEvent.click(el) }); await tick(5) }
export const checkedFeature = (root) => [...root.querySelectorAll('[data-testid="composer-feature"]')].find((r) => r.checked)?.value
export const radio = (root, id) => [...root.querySelectorAll('[data-testid="composer-feature"]')].find((r) => r.value === id)

export function setup({ phone = false } = {}) {
  vi.useFakeTimers()
  state.calls = []; state.replies = []; state.mine = []; state.others = []; state.feedback = null
  vi.stubGlobal('fetch', vi.fn(fetchMock))
  vi.spyOn(window, 'open').mockImplementation(() => ({ opener: 'x' }))
  window.matchMedia = (q) => ({ matches: phone && q === '(max-width: 639px)', addEventListener() {}, removeEventListener() {} })
  window.localStorage.clear()
}
export function teardown() { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() }
