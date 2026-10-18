import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import SiteHeader from './SiteHeader'
import { phoneMenu } from './MobileMenu'
import { AssistantProvider } from '../assistant/AssistantProvider'
import EmbedFrame from '../pages/content/EmbedFrame'
import { ExportData } from '../pages/content/DataPortal'
import { ToolTile } from '../pages/content/ToolTiles'
import { ClimateSummaryEmbed, StormEmbed } from '../portal/AppEmbed'
import { Tabs, TabsList, TabsTrigger } from './ui/tabs'
import { Button } from './ui/button'
import { NAV } from '../site/nav'

// M6 A, the website half (14 Oct): the seven findings of the 8 Oct phone audit, and the phone checklist in CONTRACT.md.
function screenWidth(phone) {
  window.matchMedia = (q) => ({ matches: phone && /max-width:\s*767px/.test(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } })
}
let probe = {}
function Probe() { const loc = useLocation(); const navigate = useNavigate(); probe = { loc, back: () => navigate(-1) }; return <output data-testid="loc">{loc.pathname}</output> }
beforeEach(() => {
  screenWidth(true)
  window.scrollTo = () => {}
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ stations: [] }) })))
})
afterEach(() => { vi.unstubAllGlobals(); document.documentElement.classList.remove('hcdp-scroll-lock') })

describe('1 · the phone menu is a sheet (was: an inline block growing the sticky header to 424 px, 19 px rows, entries twice)', () => {
  const mount = (path = '/mesonet') => render(
    <MemoryRouter initialEntries={[path]}>
      <AssistantProvider>
        <Routes><Route path="*" element={<><SiteHeader /><Probe /></>} /></Routes>
      </AssistantProvider>
    </MemoryRouter>,
  )

  it('lists every destination once', () => {
    const labels = phoneMenu().flatMap((n) => (n.items ? n.items.map((i) => i.label) : [n.label]))
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels.filter((l) => l === 'Cultural Resources')).toHaveLength(1)
    expect(labels.filter((l) => l === 'Library')).toHaveLength(1)
    expect(labels.filter((l) => l === 'How to Cite')).toHaveLength(1)
    // nothing is lost: every NAV destination is still reachable
    const all = new Set(NAV.flatMap((n) => (n.items ? n.items.map((i) => i.label) : [n.label])))
    expect(new Set(labels)).toEqual(all)
  })

  it('opens over a scrim with a history entry, 48 px rows and a 44 px close; the header does not grow; Back closes it', async () => {
    mount()
    const button = screen.getByRole('button', { name: 'Menu' })
    expect(button.className).toContain('h-11 w-11')
    fireEvent.click(button)
    expect(probe.loc.state).toEqual({ hcdpOverlay: 'menu' })
    const sheet = screen.getByTestId('mobile-menu-sheet')
    expect(sheet.closest('header')).toBeNull()                      // drawn outside the sticky header
    expect(sheet.className).toContain('fixed')
    expect(screen.getByTestId('menu-scrim')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Close the menu' }).className).toContain('h-11 w-11')
    const rows = within(sheet).getAllByTestId('menu-row')
    expect(rows.length).toBeGreaterThan(10)
    for (const r of rows) expect(r.className).toContain('min-h-12')
    expect(document.documentElement.classList.contains('hcdp-scroll-lock')).toBe(true)
    // on an inner page "Original HCDP version" is the sheet's last row (the logo row keeps its room for Share and Menu)
    expect(within(sheet).getByTestId('sheet-original-link')).toHaveTextContent('Original HCDP version')
    expect(screen.getByTestId('original-link').className).toContain('max-md:hidden')
    act(() => probe.back())
    await waitFor(() => expect(screen.queryByTestId('mobile-menu-sheet')).toBeNull())
    expect(document.documentElement.classList.contains('hcdp-scroll-lock')).toBe(false)
  })

  it('on the landing page the menu has no "Original HCDP version" row (M3 C: none of the two links there)', () => {
    mount('/')
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(within(screen.getByTestId('mobile-menu-sheet')).queryByTestId('sheet-original-link')).toBeNull()
  })

  it('a link replaces the menu’s entry, so Back from the page does not reopen the menu; the scrim closes it too', async () => {
    mount('/mesonet')
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.click(within(screen.getByTestId('mobile-menu-sheet')).getByRole('link', { name: 'Climate Tools' }))
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/tools'))
    expect(screen.queryByTestId('mobile-menu-sheet')).toBeNull()
    act(() => probe.back())
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/mesonet'))
    expect(screen.queryByTestId('mobile-menu-sheet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    fireEvent.click(screen.getByTestId('menu-scrim'))
    await waitFor(() => expect(screen.queryByTestId('mobile-menu-sheet')).toBeNull())
  })
})

describe('2 · embeds under 768 px (was: desktop apps at 358 px with a clipped Accept; 18 Oct: the app shells framed full width)', () => {
  const props = { src: 'https://cherryleh.github.io/mesonet/?source=iframe#/dashboard', title: 'Hawaiʻi Mesonet Live Data Access', fallbackHref: 'https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/' }
  it('with phoneCard: a card with the title and a 44 px "Open ↗" in a new tab instead of the frame', () => {
    render(<EmbedFrame {...props} phoneCard />)
    expect(document.querySelector('iframe')).toBeNull()
    const card = screen.getByTestId('embed-card')
    expect(card).toHaveTextContent('Hawaiʻi Mesonet Live Data Access')
    const open = within(card).getByTestId('embed-open')
    expect(open).toHaveTextContent('Open ↗')
    expect(open).toHaveAttribute('href', props.fallbackHref)
    expect(open).toHaveAttribute('target', '_blank')
    expect(open.className).toContain('h-11')
  })
  it('is additive: without phoneCard, or on a wide screen, the frame is there', () => {
    const { unmount } = render(<EmbedFrame {...props} />)
    expect(document.querySelector('iframe')).not.toBeNull()
    unmount()
    screenWidth(false)
    render(<EmbedFrame {...props} phoneCard />)
    expect(document.querySelector('iframe')).not.toBeNull()
    expect(screen.queryByTestId('embed-card')).toBeNull()
  })
  it('18 Oct (the user): HCDP’s app shells are framed on phones too — the app itself, full width, no card', () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/climate-summary']}><ClimateSummaryEmbed /></MemoryRouter>)
    expect(screen.queryByTestId('embed-card')).toBeNull()
    expect(document.querySelector('iframe')).toHaveAttribute('src', 'https://cherryleh.github.io/climate-summary/#/')
    unmount()
    render(<MemoryRouter initialEntries={['/extreme-events/lowell']}><StormEmbed slug="lowell" /></MemoryRouter>)
    expect(screen.queryByTestId('embed-card')).toBeNull()
    expect(document.querySelector('iframe')).toHaveAttribute('title', 'Hurricane Lowell')
    expect(screen.getByTestId('embed-fullscreen')).toHaveAttribute('target', '_blank')
  })
})

describe('3 · tables are stacked cards under 640 px (was: 640 / 520 px tables in a 356 px box, no cue)', () => {
  const stacked = (table) => {
    expect(table.className).toContain('hcdp-stack')
    expect(table.parentElement.className).toContain('hcdp-stack-wrap')
    // every value under a visible column header names its column (the action column has a screen-reader-only header)
    const heads = [...table.querySelectorAll('thead th')].map((th) => (th.querySelector('.sr-only') ? null : th.textContent.trim()))
    for (const tr of table.querySelectorAll('tbody tr')) {
      ;[...tr.children].forEach((cell, i) => {
        if (cell.tagName === 'TD' && heads[i] && i > 0) expect(cell.dataset.label?.toUpperCase()).toBe(heads[i].toUpperCase())
      })
    }
  }
  it('Export Data’s datasets table (on /data/export since 18 Oct; the API and Climate Summary pages are HCDP’s own, mirrored)', () => {
    render(<MemoryRouter initialEntries={['/data/export']}><ExportData /></MemoryRouter>)
    stacked(screen.getByTestId('datasets-table'))
  })
  it('the stacking rules are in the stylesheet', () => {
    const css = readFileSync(join(__dirname, '../styles/globals.css'), 'utf8')
    expect(css).toMatch(/@media \(max-width: 639px\)[\s\S]*table\.hcdp-stack thead[\s\S]*td\[data-label\]::before \{ content: attr\(data-label\)/)
  })
})

describe('4 + 5 · 16 px fields and a Copy link that keeps its width (was: 13 px selects and a 44 px jump)', () => {
  it('every text field and select is 16 px on phones and touch screens (the stylesheet’s rule)', () => {
    const css = readFileSync(join(__dirname, '../styles/globals.css'), 'utf8')
    // :is() lifts every member to the specificity of the longest, so no text utility (this site's text-base is 15 px) wins
    expect(css).toMatch(/@media \(max-width: 767px\), \(pointer: coarse\) \{\s*:is\(input:not\(\[type="checkbox"\]\)[^{]*select, textarea:not\(\.hcdp-ask-input\)\) \{ font-size: 16px; \}/)
  })
})

describe('6 · 44 px targets (was: portal buttons 31 px, utility links 17–21 px, day chips 60 × 24, viewer tabs 26 px)', () => {
  it('the Button and TabsTrigger primitives, and the header’s Share / Original links', () => {
    render(<MemoryRouter initialEntries={['/mesonet']}><AssistantProvider><SiteHeader />
      <Tabs defaultValue="a"><TabsList><TabsTrigger value="a">One</TabsTrigger><TabsTrigger value="b">Two</TabsTrigger></TabsList></Tabs>
      <Button>Go</Button><Button size="sm">Small</Button><Button size="icon" aria-label="Icon">+</Button>
    </AssistantProvider></MemoryRouter>)
    for (const t of screen.getAllByRole('tab')) expect(t.className).toMatch(/max-md:min-h-11/)
    for (const name of ['Go', 'Small']) expect(screen.getByRole('button', { name }).className).toMatch(/max-md:min-h-11/)
    expect(screen.getByRole('button', { name: 'Icon' }).className).toMatch(/max-md:min-w-11/)
    expect(screen.getByTestId('share-view').className).toMatch(/max-md:h-11/)
    expect(screen.getByTestId('original-link').className).toMatch(/max-md:h-11/)
  })
})

describe('7 · tile titles over light pictures and the 12 px type floor (was: no scrim; 11 px upper-case labels)', () => {
  it('a tool tile (the did-you-mean tiles use it) has a scrim under its title band and shadowed type', () => {
    render(<ToolTile tool={{ name: 'CCVD Portfolios', caption: 'A climate portfolio for anywhere', href: 'https://ccvd.manoa.hawaii.edu/', image: { src: '/tiles/ccvd.jpg', width: 800, height: 533 } }} />)
    const t = screen.getByTestId('tool')
    expect(within(t).getByTestId('tile-scrim').style.backgroundImage).toContain('rgba(0, 0, 0, 0.5)')
    expect(t.querySelector('h2').parentElement.style.textShadow).toContain('rgba(0, 0, 0, 0.6)')
  })
  it('no interface text under 12 px in the components (the portal’s map furniture and citation superscripts aside)', () => {
    const files = []
    const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (/\.jsx$/.test(f) && !/\.test\.jsx$/.test(f)) files.push(p) } }
    walk(join(__dirname, '..'))
    const offenders = []
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/text-\[(9|10|10\.5|11|11\.5)px\]/.test(line) && !/ai-summary-cite|superscript/.test(line)) offenders.push(`${f.split('/src/')[1]}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
