import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AssistantProvider, useAssistant } from '../assistant/AssistantProvider'
import { VisualizeData } from '../pages/content/DataPortal'
import { defaultMapPath } from './visualize'
import { originalFor } from './original'

// 18 Oct: Access Data's first tile, Visualize Data, is the map viewer; /data/visualize is its door. An answer (or a typeahead
// row) that opens the door goes straight to the default map, so the overview is asked for under the map's own address.
let assistant = null
function Grab() { assistant = useAssistant(); return null }
function Probe() { const { pathname } = useLocation(); return <output data-testid="loc">{pathname}</output> }
const json = (body) => ({ ok: true, status: 200, json: async () => body })
let posted = []

beforeEach(() => {
  posted = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    posted.push({ url, body: init?.body ? JSON.parse(init.body) : null })
    if (url === '/api/navigate') return json({ intent: 'navigate', reply: 'Taking you to Visualize Data.', actions: [{ type: 'navigate', path: '/data/visualize' }], alternatives: [], destination: { title: 'Visualize Data', path: '/data/visualize' } })
    if (url === '/api/summary') return json({ summary: '', chunks: [], cites: [], more: [], more_cites: [], sources: [], followups: [] })
    return json({})
  }))
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
})
afterEach(() => { vi.unstubAllGlobals() })

const mount = () => render(
  <MemoryRouter initialEntries={['/data']}>
    <AssistantProvider>
      <Grab />
      <Routes>
        <Route path="/data/visualize" element={<VisualizeData />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </AssistantProvider>
  </MemoryRouter>,
)

describe('the Visualize Data door', () => {
  it('an answer that opens /data/visualize lands on the default map, and its overview is asked for there', async () => {
    mount()
    await act(async () => { await assistant.send('visualize data', { docked: true }) })
    const map = defaultMapPath(new Date())
    expect(screen.getByTestId('loc')).toHaveTextContent(map)
    expect(posted.find((p) => p.url === '/api/summary').body.path).toBe(map)
  })

  it('a typeahead row for Visualize Data does the same (no AI call)', async () => {
    vi.useFakeTimers()
    mount()
    act(() => { assistant.choose({ title: 'Visualize Data (the data portal’s interactive maps)', path: '/data/visualize' }, { ask: 'visua', echoAsk: true, docked: true }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByTestId('loc')).toHaveTextContent(defaultMapPath(new Date()))
    expect(posted.some((p) => p.url === '/api/navigate')).toBe(false)
    vi.useRealTimers()
  })

  it('its "Original HCDP version" is the data portal on the default map’s dataset; Export Data’s is the data portal page', () => {
    expect(originalFor('/data/visualize').url).toBe('https://rainfall.ikewai.org/?datatype=rainfall&period=month')
    expect(originalFor('/data/export').url).toBe('https://www.hawaii.edu/climate-data-portal/data-portal/')
    expect(originalFor('/data').url).toBe('https://www.hawaii.edu/climate-data-portal/data-portal/')
  })
})
