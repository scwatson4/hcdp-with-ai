import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { AssistantProvider } from '../assistant/AssistantProvider'
import App from '../App'
import { useClaimShell } from './shellMode'

// 14 Oct: a page can hold the shell in another mode — the phone viewer ('phone-map', M1 C) keeps the header but not
// the docked bar, the footer or Back to top, and the page never scrolls; the full-screen map ('map-full', QB-T3 B)
// hides the header too. Leaving the page gives the shell back.
function Claim({ mode }) { useClaimShell(mode); return <p>{mode} page</p> }
let go = () => {}
function Nav() { const n = useNavigate(); go = n; return null }
const mount = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <AssistantProvider>
      <Nav />
      <Routes>
        <Route element={<App />}>
          <Route path="data" element={<p>Data page</p>} />
          <Route path="phone" element={<Claim mode="phone-map" />} />
          <Route path="full" element={<Claim mode="map-full" />} />
        </Route>
      </Routes>
    </AssistantProvider>
  </MemoryRouter>,
)
beforeEach(() => {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  window.scrollTo = () => {}
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('the shell’s modes', () => {
  it('“phone-map” keeps the header, drops the docked bar, the footer and Back to top, and holds the page still', () => {
    mount('/phone')
    expect(screen.getByTestId('sticky-header')).not.toHaveClass('hidden')
    expect(screen.getByRole('link', { name: 'Hawaiʻi Climate Data Portal home' })).toBeInTheDocument()
    expect(screen.queryByTestId('assistant-bar')).toBeNull()
    expect(screen.queryByTestId('site-footer')).toBeNull()
    expect(screen.queryByTestId('back-to-top')).toBeNull()
    expect(screen.queryByTestId('share-view')).toBeNull()       // they live in the viewer's sheet and floating bar
    expect(screen.queryByTestId('original-link')).toBeNull()
    expect(document.documentElement.classList.contains('hcdp-scroll-lock')).toBe(true)
    act(() => go('/data'))
    expect(screen.getByTestId('assistant-bar')).toBeInTheDocument()
    expect(screen.getByTestId('site-footer')).toBeInTheDocument()
    expect(screen.getByTestId('share-view')).toBeInTheDocument()
    expect(document.documentElement.classList.contains('hcdp-scroll-lock')).toBe(false)
  })

  it('“map-full” hides the header and the docked bar as well', () => {
    mount('/full')
    expect(screen.getByTestId('sticky-header')).toHaveClass('hidden')
    expect(screen.queryByTestId('assistant-bar')).toBeNull()
    expect(screen.queryByTestId('site-footer')).toBeNull()
    expect(document.documentElement.classList.contains('hcdp-scroll-lock')).toBe(true)
    act(() => go('/data'))
    expect(screen.getByTestId('sticky-header')).not.toHaveClass('hidden')
    expect(document.documentElement.classList.contains('hcdp-scroll-lock')).toBe(false)
  })

  it('renders the goo filter once', () => {
    mount('/data')
    expect(document.querySelectorAll('filter#hcdp-goo')).toHaveLength(1)
  })
})
