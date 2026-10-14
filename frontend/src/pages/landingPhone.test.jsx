import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Landing from './Landing'
import SiteHeader from '../components/SiteHeader'
import { AssistantProvider } from '../assistant/AssistantProvider'
import { AskBar, CHIPS, EXAMPLES } from '../assistant/AssistantPanel'

// M3 C (14 Oct): on phones the portal's buttons stay under the hero at 44 px and the resources, social media, How to
// cite and contact fold into one "More from HCDP" row; the landing page shows neither "Share this view" nor "Original
// HCDP version" at any width (inner pages keep them); the hero bar keeps its typewriter and chips, the docked bar its
// quiet follow-up ghost, on phones too.
function screenWidth(phone) {
  window.matchMedia = (q) => ({ matches: phone && /max-width:\s*767px/.test(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } })
}
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
beforeEach(() => {
  screenWidth(true)
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) })))
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const renderLanding = () => render(<MemoryRouter initialEntries={['/']}><AssistantProvider><Landing /></AssistantProvider></MemoryRouter>)

describe('the landing page on a phone (M3 C)', () => {
  it('keeps the portal’s buttons under the hero as 44 px rows and folds the rest into a closed "More from HCDP" row', () => {
    renderLanding()
    const hero = screen.getByTestId('landing-hero')
    const sidebar = screen.getByTestId('landing-sidebar')
    expect(hero.compareDocumentPosition(sidebar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()   // right under the hero
    const links = within(screen.getByTestId('sidebar-buttons')).getAllByRole('link')
    expect(links).toHaveLength(6)
    for (const a of links) expect(a.className).toMatch(/max-lg:min-h-11/)       // 44 px rows where it stacks (every phone)
    expect(links.every((a) => /\[@media\(pointer:coarse\)\]:min-h-11/.test(a.className))).toBe(true)   // and on touch at any width
    const toggle = screen.getByTestId('landing-more-toggle')
    expect(toggle).toHaveTextContent('More from HCDP')
    expect(toggle.className).toContain('h-12')                                 // the 48 px row
    expect(toggle.className).toContain('lg:hidden')                           // wide screens keep the open sidebar
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const more = screen.getByTestId('landing-more')
    expect(more.className).toMatch(/(^|\s)hidden(\s|$)/)
    expect(more.className).toContain('lg:block')
    expect(within(more).getByText('Climate Resources')).toBeInTheDocument()
    expect(within(more).getByText('Social Media')).toBeInTheDocument()
    expect(within(more).getByText('How To Cite')).toBeInTheDocument()
    expect(within(more).getByText('Contact Us')).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(more.className).not.toMatch(/(^|\s)hidden(\s|$)/)
    for (const a of within(more).getAllByRole('link')) expect(a.className).toContain('max-lg:min-h-11')   // the rows inside are 44 px too
    // no type under 12 px in the sidebar's labels
    expect(sidebar.innerHTML).not.toMatch(/text-\[(10|11)(\.5)?px\]/)
  })

  it('keeps the hero bar’s typewriter examples and its four chips at 390 px', async () => {
    vi.useFakeTimers()
    renderLanding()
    await tick(400)
    const ghost = screen.getByTestId('composer-ghost')
    expect(ghost).toHaveAttribute('data-variant', 'typewriter')
    const partial = screen.getByTestId('composer-ghost-text').textContent
    expect(EXAMPLES.some((e) => e.startsWith(partial))).toBe(true)
    await tick(600)
    expect(screen.getByTestId('composer-ghost-text').textContent.length).toBeGreaterThan(partial.length)   // still typing
    expect(screen.getAllByTestId('ask-chip').map((b) => b.textContent)).toEqual(CHIPS.map((c) => c.label))
    expect(screen.getByTestId('assistant-input')).not.toHaveAttribute('readonly')   // the hero bar is a real field on phones
  })

  it('keeps the docked bar’s quiet follow-up ghost on a phone', async () => {
    vi.useFakeTimers()
    render(<MemoryRouter initialEntries={['/data']}><AssistantProvider><AskBar docked /></AssistantProvider></MemoryRouter>)
    await tick(10)
    expect(screen.getByTestId('composer-ghost')).toHaveAttribute('data-variant', 'quiet')
    expect(screen.getByTestId('docked-ask-bar')).toHaveAttribute('data-opens-sheet', 'true')
  })
})

describe('"Share this view" and "Original HCDP version" (M3 C)', () => {
  const renderHeader = (entry) => render(<MemoryRouter initialEntries={[entry]}><AssistantProvider><SiteHeader /></AssistantProvider></MemoryRouter>)
  for (const phone of [true, false]) {
    it(`are not on the landing page ${phone ? 'on a phone' : 'on a wide screen'}; every inner page keeps them`, () => {
      screenWidth(phone)
      const { unmount } = renderHeader('/')
      expect(screen.queryByTestId('share-view')).toBeNull()
      expect(screen.queryByTestId('original-link')).toBeNull()
      expect(screen.getByRole('link', { name: 'Hawaiʻi Climate Data Portal home' })).toBeInTheDocument()
      expect(screen.getByTestId('logo-row').children).toHaveLength(3)     // the logo stays centred
      unmount()
      renderHeader('/mesonet')
      expect(screen.getByTestId('share-view')).toBeInTheDocument()
      expect(screen.getByTestId('original-link')).toBeInTheDocument()
    })
  }
})
