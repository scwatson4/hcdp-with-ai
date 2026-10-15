import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom'
import { AssistantProvider, HOLD_MS, TRAVEL_MS } from '../assistant/AssistantProvider'
import AssistantBar from '../assistant/AssistantBar'
import { renderTerms, PAGE_REVEAL } from '../assistant/AISummary'
import { ThemeProvider } from '../components/ThemeProvider'
import { TooltipProvider } from '../components/ui/tooltip'
import MirroredPage, { Mirror, pageMarkup, pageOverview, copiedDate, hashTarget } from './MirroredPage'
import { ApiRoute, ClimateSummaryEmbed, ExtremeEventsRoute, MesonetRoute, PacificRoute, StormRoute, ToolsRoute, findTile, RING_MS } from './routes'
import { SUMMARY_APP, mesonetSearchFromHash, mesonetSrc, summarySearchFromHash, summarySrc } from './AppEmbed'
import { LibraryList, groupByYear, matches } from './Library'
import { HOST_CSS, THEME_URL, resetTheme } from './portalTheme'
import { forgetPortalPages } from './usePortalPage'
import { originalFor } from '../site/original'
import { NAV } from '../site/nav'

// 15 Oct: a cached page overview plays a short "Writing…" beat before its sentences; these tests read the sentences at once.
beforeEach(() => { PAGE_REVEAL.ms = 0 })

const HCDP = 'https://www.hawaii.edu/climate-data-portal'
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body), text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) })

const TEAM = {
  slug: 'team', path: '/about/team', url: `${HCDP}/team/`, title: 'Team', band: null, kind: 'page', has_h1: false, source: 'cache',
  body_class: ['wp-singular', 'page-template', 'page', 'hiding-page-title'], article_class: ['page', 'type-page', 'hentry'],
  html: '<div class="hcdp-mirror-article"><div class="entry-content"><h2 id="ryan">Ryan Longman</h2><p>HCDP Director</p>'
    + '<a data-mirror="internal" href="/about/history">HCDP History</a> <a data-mirror="external" href="https://example.org/" target="_blank" rel="noopener noreferrer">Elsewhere</a>'
    + '<a href="#ryan" id="jump">jump</a></div></div>',
  css: '.wp-container-x{display:flex}', sha256: 'a'.repeat(64), fetched_at: '2026-10-14T00:00:00+00:00',
}
const HISTORY = { ...TEAM, slug: '2339-2', path: '/about/history', url: `${HCDP}/2339-2/`, title: 'HCDP History', band: 'HCDP History', body_class: ['page'], html: '<div class="entry-content"><p>The Climate of Hawaiʻi</p></div>' }
const OVERVIEW = {
  chunks: ['This is HCDP’s **Team** page. [1]', 'It lists the **HCDP** staff and *contributors*.'], cites: [[1], []], more: ['Each card shows a role.'], more_cites: [[1]],
  sources: [{ title: 'Team', url: `${HCDP}/team/` }], followups: ['Who leads the Hawaiʻi Mesonet?', 'Take me to the HCDP History page', 'How do I cite HCDP data?'], generated_at: '2026-10-14T01:00:00+00:00',
}

let pages
let calls
let replies
let summaries
const fetchMock = (url, init) => {
  calls.push({ url, body: init?.body ? JSON.parse(init.body) : null })
  if (url === THEME_URL) return Promise.resolve(json('.container{max-width:1140px}'))
  if (url.startsWith('/api/portal/page?path=')) {
    const path = decodeURIComponent(url.split('path=')[1])
    const p = pages[path]
    if (!p) return Promise.resolve(json({ detail: 'not mirrored', hcdp_url: null }, 404))
    if (p.status) return Promise.resolve(json(p.body, p.status))
    return Promise.resolve(json(p))
  }
  if (url === '/api/navigate') return Promise.resolve(json(replies.shift()))
  if (url === '/api/summary') return Promise.resolve(json(summaries.shift()))
  if (url === '/api/portal/library') return Promise.resolve(json(pages.__library || { items: [] }))
  return Promise.resolve(json({ items: [] }))
}

function Probe() { const { pathname, search, hash } = useLocation(); return <div data-testid="probe">{pathname + search + hash}</div> }
function Shell() { return <><div data-testid="sticky-header"><AssistantBar /></div><Probe /><Outlet /></> }
const ROUTES = (
  <Route element={<Shell />}>
    <Route path="about/:page" element={<Mirror />} />
    <Route path="data/api" element={<ApiRoute />} />
    <Route path="mesonet" element={<MesonetRoute />} />
    <Route path="climate-summary" element={<ClimateSummaryEmbed />} />
    <Route path="pacific" element={<PacificRoute />} />
    <Route path="pacific/:slug" element={<Mirror />} />
    <Route path="extreme-events" element={<ExtremeEventsRoute />} />
    <Route path="extreme-events/:slug" element={<StormRoute />} />
    <Route path="tools" element={<ToolsRoute />} />
    <Route path="tools/:slug" element={<ToolsRoute />} />
    <Route path="*" element={<div data-testid="elsewhere" />} />
  </Route>
)
const renderAt = (entry) => render(
  <ThemeProvider><TooltipProvider><MemoryRouter initialEntries={[entry]}><AssistantProvider>
    <Routes>{ROUTES}</Routes>
  </AssistantProvider></MemoryRouter></TooltipProvider></ThemeProvider>,
)
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const shadow = () => screen.getByTestId('mirror-host').shadowRoot
const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

beforeEach(() => {
  vi.useFakeTimers()
  pages = { '/about/team': TEAM, '/about/history': HISTORY }
  calls = []; replies = []; summaries = []
  vi.stubGlobal('fetch', vi.fn(fetchMock))
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  resetTheme(); forgetPortalPages()
  document.title = 'Hawaiʻi Climate Data Portal'
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); document.head.querySelectorAll('link[rel=canonical]').forEach((l) => l.remove()) })

describe('a mirrored page', () => {
  it('renders HCDP’s copy inside an open shadow root, in HCDP’s own page structure, with the theme, host and page styles', async () => {
    renderAt('/about/team')
    await flush(10)
    const sr = shadow()
    expect(sr).toBeTruthy()
    expect(sr.mode).toBe('open')
    expect(sr.querySelector('.hcdp-body.hiding-page-title #content.site-content #content-inside.container.no-sidebar #primary .site-main article.page .entry-content')).not.toBeNull()
    expect(sr.querySelector('.entry-content h2').textContent).toBe('Ryan Longman')
    // jsdom has no constructable stylesheets: the three sheets come as <style> elements, theme → host → page
    const styles = [...sr.querySelectorAll('style')].map((s) => s.textContent)
    expect(styles).toEqual(['.container{max-width:1140px}', HOST_CSS, TEAM.css])
    expect(calls.filter((c) => c.url === THEME_URL)).toHaveLength(1)
    // nothing of HCDP's leaks into the document
    expect(document.querySelector('.entry-content')).toBeNull()
  })

  it('adopts one shared stylesheet per sheet where the browser has constructable stylesheets', async () => {
    class Sheet { replaceSync(t) { this.text = t } }
    vi.stubGlobal('CSSStyleSheet', Sheet)
    const desc = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, 'adoptedStyleSheets')
    Object.defineProperty(ShadowRoot.prototype, 'adoptedStyleSheets', { configurable: true, get() { return this._adopted || [] }, set(v) { this._adopted = v } })
    try {
      renderAt('/about/team')
      await flush(10)
      const sr = shadow()
      expect(sr.adoptedStyleSheets.map((s) => s.text)).toEqual(['.container{max-width:1140px}', HOST_CSS, TEAM.css])
      expect(sr.querySelectorAll('style')).toHaveLength(0)
    } finally {
      if (desc) Object.defineProperty(ShadowRoot.prototype, 'adoptedStyleSheets', desc); else delete ShadowRoot.prototype.adoptedStyleSheets
    }
  })

  it('the host CSS is HCDP’s body: 14px/1.7 system stack, #777 on white, clipped sideways', () => {
    expect(HOST_CSS).toContain(':host{display:block;font:400 14px/1.7 -apple-system,system-ui,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#777;background:#fff;overflow-x:clip}')
  })

  it('follows a link to a page this site has in place, and leaves an external one to the browser (new tab)', async () => {
    renderAt('/about/team')
    await flush(10)
    const sr = shadow()
    let prevented = null
    document.addEventListener('click', (e) => { prevented = e.defaultPrevented; e.preventDefault() }, { once: true })
    act(() => { sr.querySelector('a[data-mirror="external"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })) })
    expect(prevented).toBe(false)
    expect(screen.getByTestId('probe').textContent).toBe('/about/team')
    // a modified click (a new tab of ours) is the browser's too
    document.addEventListener('click', (e) => { prevented = e.defaultPrevented; e.preventDefault() }, { once: true })
    act(() => { sr.querySelector('a[data-mirror="internal"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, metaKey: true })) })
    expect(prevented).toBe(false)
    act(() => { sr.querySelector('a[data-mirror="internal"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })) })
    await flush(10)
    expect(screen.getByTestId('probe').textContent).toBe('/about/history')
    expect(screen.getByTestId('mirror-band')).toHaveTextContent('HCDP History')
  })

  it('scrolls a #hash target inside the shadow root to just below the sticky header, and follows in-page #links', async () => {
    document.documentElement.style.setProperty('--hcdp-sticky-h', '100px')
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () { return { top: this.id === 'ryan' ? 500 : 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } })
    const scroll = vi.fn()
    window.scrollTo = scroll
    renderAt('/about/team#ryan')
    await flush(10)
    await flush(100)
    expect(scroll).toHaveBeenCalledWith({ top: 388, behavior: 'auto' })   // 500 − 100 (header + bar) − 12
    scroll.mockClear()
    act(() => { shadow().querySelector('#jump').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })) })
    await flush(10)
    await flush(100)
    expect(screen.getByTestId('probe').textContent).toBe('/about/team#ryan')
    expect(scroll).toHaveBeenCalledWith({ top: 388, behavior: 'auto' })
    rect.mockRestore()
    document.documentElement.style.removeProperty('--hcdp-sticky-h')
  })

  it('draws HCDP’s grey band outside the shadow root only when HCDP has one, with one h1 per page', async () => {
    renderAt('/about/history')
    await flush(10)
    const band = screen.getByTestId('mirror-band')
    expect(band.className).toBe('hcdp-band')
    expect(within(band).getByRole('heading', { level: 1 })).toHaveTextContent('HCDP History')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    cleanup()
    renderAt('/about/team')   // hiding-page-title: no band; the page's name is a hidden h1
    await flush(10)
    expect(screen.queryByTestId('mirror-band')).toBeNull()
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('Team')
    expect(h1.className).toContain('sr-only')
  })

  it('names the document "<title> – Hawaiʻi Climate Data Portal" with the canonical link to HCDP’s page, and lets go after', async () => {
    const { unmount } = renderAt('/about/team')
    await flush(10)
    expect(document.title).toBe('Team – Hawaiʻi Climate Data Portal')
    expect(document.head.querySelector('link[rel="canonical"]').getAttribute('href')).toBe(`${HCDP}/team/`)
    unmount()
    expect(document.title).toBe('Hawaiʻi Climate Data Portal')
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull()
  })

  it('says "Copied from HCDP on …" only for a copy not known to be current', async () => {
    pages['/about/history'] = { ...HISTORY, source: 'seed', copied_at: '2026-10-13T20:00:00+00:00' }
    renderAt('/about/history')
    await flush(10)
    expect(screen.getByTestId('mirror-copied')).toHaveTextContent('Copied from HCDP on 13 Oct 2026')
    cleanup()
    renderAt('/about/team')
    await flush(10)
    expect(screen.queryByTestId('mirror-copied')).toBeNull()
    expect(copiedDate('2026-10-14T05:00:00Z')).toBe('13 Oct 2026')   // a Hawaiʻi date
  })

  it('a page the mirror has no copy of: "This page is on HCDP ↗"; an address that mirrors nothing: not found', async () => {
    pages['/pacific/fiji'] = { status: 404, body: { detail: 'no copy yet', hcdp_url: `${HCDP}/fiji/` } }
    renderAt('/pacific/fiji')
    await flush(10)
    expect(screen.getByTestId('mirror-missing')).toHaveTextContent('This page is on HCDP')
    expect(within(screen.getByTestId('mirror-missing')).getByRole('link')).toHaveAttribute('href', `${HCDP}/fiji/`)
    cleanup()
    renderAt('/pacific/nowhere')
    await flush(10)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('That page is not here.')
  })

  it('wraps HCDP’s classes safely', () => {
    expect(pageMarkup({ body_class: ['page', 'x"onload="y', 'single-post'], article_class: [], html: '<p>a</p>' })).toContain('class="hcdp-body page single-post"')
    expect(hashTarget(null, '#x')).toBeNull()
  })
})

describe('the AI overview on a mirrored page', () => {
  it('a direct load shows the page’s cached overview (QB-O1 B) collapsed at the top, above the band; opened: sources, sentences with bold key terms, no "Wrong page?"', async () => {
    pages['/about/history'] = { ...HISTORY, overview: OVERVIEW }
    renderAt('/about/history')
    await flush(10)
    const block = screen.getByTestId('ai-summary')
    expect(block).toHaveAttribute('data-kind', 'page')
    expect(before(block, screen.getByTestId('mirror-band'))).toBe(true)
    expect(before(block, screen.getByTestId('mirror-host'))).toBe(true)
    // 15 Oct: it arrives collapsed ("Show AI Overview"); a tap opens it
    expect(block).toHaveAttribute('data-status', 'collapsed')
    expect(within(block).getByTestId('ai-overview-title')).toHaveTextContent('Show AI Overview')
    fireEvent.click(within(block).getByTestId('ai-overview-open'))
    await flush(10)
    expect(within(block).getByTestId('ai-summary-sources')).toHaveTextContent('Team')
    const terms = within(block).getAllByTestId('ai-summary-term').map((t) => t.textContent)
    expect(terms).toEqual(['Team', 'HCDP'])
    expect(within(block).getByTestId('ai-summary-text').textContent).not.toContain('*')   // the stray *contributors* lost its asterisks
    expect(within(block).queryByTestId('wrong-page')).toBeNull()
    // ✕ hides it for this visit to the page
    fireEvent.click(within(block).getByTestId('ai-summary-dismiss'))
    expect(screen.queryByTestId('ai-summary')).toBeNull()
  })

  it('hands the page’s follow-ups to the docked bar’s ghost', async () => {
    pages['/about/history'] = { ...HISTORY, overview: OVERVIEW }
    renderAt('/about/history')
    await flush(10)
    await flush(4200)   // the quiet ghost adopts a new set at the end of its 3.5 s hold (N3 B)
    expect(screen.getByTestId('composer-ghost').dataset.pool).toBe('followups')
  })

  it('a navigation’s per-question overview replaces the cached one, above the band', async () => {
    pages['/about/history'] = { ...HISTORY, overview: OVERVIEW }
    replies = [{ intent: 'navigate', reply: 'Taking you to HCDP History.', actions: [{ type: 'navigate', path: '/about/history' }], alternatives: [], minimize: true }]
    summaries = [{ summary: 'x', chunks: ['You asked how HCDP began.', 'This is **HCDP History**.'], cites: [[], []], more: [], more_cites: [], sources: [{ title: 'HCDP History', url: `${HCDP}/2339-2/` }], followups: [] }]
    renderAt('/about/team')
    await flush(10)
    const input = screen.getByTestId('assistant-input')
    fireEvent.change(input, { target: { value: 'how did HCDP start' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await flush(HOLD_MS + TRAVEL_MS + 100)
    expect(screen.getByTestId('probe').textContent).toBe('/about/history')
    const blocks = screen.getAllByTestId('ai-summary')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toHaveAttribute('data-kind', 'answer')
    expect(within(blocks[0]).getByTestId('ai-summary-term')).toHaveTextContent('HCDP History')
    expect(before(blocks[0], screen.getByTestId('mirror-band'))).toBe(true)
  })

  it('renderTerms: **x** in bold, stray asterisks dropped', () => {
    const { container } = render(<p>{renderTerms('A **daily rainfall map** for *Kauaʻi* ** and more')}</p>)
    expect(container.querySelector('strong').textContent).toBe('daily rainfall map')
    expect(container.textContent).toBe('A daily rainfall map for Kauaʻi  and more')
  })

  it('pageOverview keeps only valid sources and cites', () => {
    const ov = pageOverview({ overview: { ...OVERVIEW, sources: [{ title: 'Team', url: `${HCDP}/team/` }, { title: 'bad', url: 'javascript:alert(1)' }], cites: [[1, 2], [9]] } }, '/about/team')
    expect(ov.sources).toHaveLength(1)
    expect(ov.cites).toEqual([[1], []])
    expect(ov.page).toBe(true)
    expect(pageOverview({}, '/x')).toBeNull()
  })
})

describe('Climate Tools (/tools/<slug>)', () => {
  const TOOLS = {
    ...TEAM, slug: 'climate-tools', path: '/tools', url: `${HCDP}/climate-tools/`, title: 'Climate Tools',
    html: '<div class="entry-content"><div class="wp-block-column"><div style="position: relative; border-radius: 10px;"><a data-mirror="external" href="http://hrip.manoa.hawaii.edu/" target="_blank"><h2>H-RIP</h2></a></div></div>'
      + '<div class="wp-block-column"><div style="position: relative; border-radius: 10px;"><a data-mirror="external" href="http://weather.hawaii.edu/vmap/new/" target="_blank"><h2>VMAP Vog Forecast Dashboard</h2></a></div></div>'
      + '<div class="wp-block-column"><div style="position: relative; border-radius: 10px;"><a href=""><h2>Avian Malaria-Risk &amp; Warning<br>(Coming soon)</h2></a></div></div></div>',
  }
  it('rings the tile whose link is the tool’s for 2.2 s, centred when no answer’s overview tops the page', async () => {
    pages['/tools'] = TOOLS
    const into = vi.fn()
    Element.prototype.scrollIntoView = into
    renderAt('/tools/vmap-vog-forecast')
    await flush(10)
    await flush(100)
    const tile = findTile(shadow(), 'vmap-vog-forecast')
    expect(tile.textContent).toBe('VMAP Vog Forecast Dashboard')
    expect(tile.classList.contains('hcdp-mirror-ring')).toBe(true)
    expect(into).toHaveBeenCalledWith({ block: 'center' })
    await flush(RING_MS)
    expect(tile.classList.contains('hcdp-mirror-ring')).toBe(false)
    expect(findTile(shadow(), 'avian-malaria').textContent).toContain('Avian Malaria')
    expect(findTile(shadow(), 'h-rip').textContent).toBe('H-RIP')
    expect(findTile(shadow(), 'nope')).toBeNull()
  })
})

describe('app shells as native embeds', () => {
  it('a storm report: the cherryleh route full height under the header, a strip with the title (the page’s h1) and "Open full screen ↗"', async () => {
    renderAt('/extreme-events/lowell')
    await flush(10)
    const frame = screen.getByTestId('embed-frame')
    expect(frame.getAttribute('src')).toBe(`${SUMMARY_APP}#/hurricane-lowell`)
    expect(frame.getAttribute('title')).toBe('Hurricane Lowell')
    expect(within(screen.getByTestId('embed-strip')).getByRole('heading', { level: 1 })).toHaveTextContent('Hurricane Lowell')
    expect(screen.getByTestId('embed-fullscreen')).toHaveAttribute('target', '_blank')
    expect(document.title).toBe('Hurricane Lowell – Hawaiʻi Climate Data Portal')
    expect(document.head.querySelector('link[rel="canonical"]').getAttribute('href')).toBe(`${HCDP}/hurricane-lowell/`)
    expect(screen.queryByTestId('embed-cover')).toBeNull()   // a mouse: no cover
  })

  it('each storm opens its own route; kona-lows (both lows) and the old #sections land on the pages that replaced them', async () => {
    for (const [slug, route] of [['nolo', 'hurricane-nolo'], ['lala', 'hurricane-lala'], ['kona-low-1', 'storm-viewer'], ['kona-low-2', 'storm-viewer-march2026-2']]) {
      renderAt(`/extreme-events/${slug}`)
      await flush(10)
      expect(screen.getByTestId('embed-frame').getAttribute('src')).toBe(`${SUMMARY_APP}#/${route}`)
      cleanup()
    }
    pages['/extreme-events'] = { ...HISTORY, slug: 'extreme-events', title: 'Extreme Events', band: 'Extreme Events' }
    renderAt('/extreme-events/kona-lows')
    await flush(10)
    expect(screen.getByTestId('probe').textContent).toBe('/extreme-events')
    cleanup()
    renderAt('/extreme-events#lala')
    await flush(10)
    expect(screen.getByTestId('probe').textContent).toBe('/extreme-events/lala')
    cleanup()
    renderAt('/pacific#american-samoa')
    await flush(10)
    expect(screen.getByTestId('probe').textContent).toBe('/pacific/american-samoa')
  })

  it('on a touch screen the app waits for a tap', async () => {
    window.matchMedia = (q) => ({ matches: q === '(pointer: coarse)', addEventListener() {}, removeEventListener() {} })
    renderAt('/extreme-events/nolo')
    await flush(10)
    fireEvent.click(screen.getByTestId('embed-cover'))
    expect(screen.queryByTestId('embed-cover')).toBeNull()
  })

  it('the Monthly Climate Summary follows the app’s route (origin-checked) without reloading it', async () => {
    renderAt('/climate-summary?year=2026&month=8')
    await flush(10)
    const frame = screen.getByTestId('embed-frame')
    expect(frame.getAttribute('src')).toBe(`${SUMMARY_APP}#/?year=2026&month=8`)
    act(() => { window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', data: { type: 'routeChange', hash: '#/?year=1999&month=1' } })) })
    expect(screen.getByTestId('probe').textContent).toBe('/climate-summary?year=2026&month=8')
    act(() => { window.dispatchEvent(new MessageEvent('message', { origin: 'https://cherryleh.github.io', data: { type: 'routeChange', hash: '#/?year=2025&month=3' } })) })
    await flush(10)
    expect(screen.getByTestId('probe').textContent).toBe('/climate-summary?year=2025&month=3')
    expect(screen.getByTestId('embed-frame').getAttribute('src')).toBe(`${SUMMARY_APP}#/?year=2026&month=8`)   // not reloaded
    expect(summarySrc('?year=2026&month=13')).toBe(`${SUMMARY_APP}#/`)
    expect(summarySearchFromHash('#/tutorial')).toBe('')
  })

  it('the Mesonet live viewer: the station and view in our address, the app’s posted hash back into it; /mesonet alone is HCDP’s page', async () => {
    renderAt('/mesonet?viewer=live&station=0115&view=dashboard')
    await flush(10)
    expect(screen.getByTestId('embed-frame').getAttribute('src')).toBe('https://cherryleh.github.io/mesonet/?source=iframe#/dashboard?id=0115')
    act(() => { window.dispatchEvent(new MessageEvent('message', { origin: 'https://cherryleh.github.io', data: '#/station-map' })) })
    await flush(10)
    expect(screen.getByTestId('probe').textContent).toBe('/mesonet?viewer=live&view=station-map')
    expect(mesonetSearchFromHash('#/graphing?id=0602')).toBe('?viewer=live&station=0602&view=graphing')
    expect(mesonetSrc('?viewer=app&station=0115')).toBe('https://hawaiimesonet.app/station/0115')
    expect(mesonetSrc('?viewer=nolo')).toBe(`${SUMMARY_APP}#/nolo-viewer`)
    cleanup()
    pages['/mesonet'] = { ...TEAM, slug: 'hawaii-mesonet', title: 'Hawai‘i Mesonet', url: `${HCDP}/hawaii-mesonet/` }
    renderAt('/mesonet')
    await flush(10)
    expect(screen.getByTestId('mirrored-page')).toHaveAttribute('data-slug', 'hawaii-mesonet')
  })

  it('/data/api is HCDP’s page with the AI-prepared download offer’s slot on top', async () => {
    pages['/data/api'] = { ...HISTORY, slug: 'hcdp-hawaii-mesonet-api', title: 'HCDP / Hawaiʻi Mesonet API', band: 'HCDP / Hawaiʻi Mesonet API' }
    renderAt('/data/api')
    await flush(10)
    expect(screen.getByTestId('mirror-band')).toHaveTextContent('HCDP / Hawaiʻi Mesonet API')
    expect(screen.queryByTestId('download-offer')).toBeNull()   // no offer without a data ask
  })
})

describe('the Library', () => {
  const ITEMS = [
    { key: 'A', year: '2026', title: 'April 2026 Monthly Precipitation Summary', authors: 'NOAA/NWS', venue: 'NWS', url: '', zotero: 'https://www.zotero.org/groups/2846077/items/A' },
    { key: 'B', year: '2022', title: 'A Century of Drought in Hawaiʻi', authors: 'Frazier, A. G.', venue: 'Earth’s Future', url: 'https://doi.org/10.1029/x' },
    { key: 'C', year: '', title: 'Undated note', authors: '', venue: '', url: '' },
  ]
  it('groups the Zotero items by year, newest first, undated last; the filter folds the ʻokina and diacritics', () => {
    expect(groupByYear(ITEMS).map(([y, l]) => [y, l.length])).toEqual([['2026', 1], ['2022', 1], ['Undated', 1]])
    expect(matches(ITEMS[1], ['hawaii', 'drought'])).toBe(true)
    expect(matches(ITEMS[1], ['maui'])).toBe(false)
  })
  it('lists them with their links and filters as you type', async () => {
    pages.__library = { items: ITEMS, fetched_at: '2026-10-14T00:00:00Z' }
    render(<MemoryRouter><LibraryList /></MemoryRouter>)
    await flush(10)
    expect(screen.getAllByTestId('library-item')).toHaveLength(3)
    expect(screen.getByRole('heading', { name: '2026' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /A Century of Drought/ })).toHaveAttribute('href', 'https://doi.org/10.1029/x')
    expect(screen.getByRole('link', { name: /April 2026/ })).toHaveAttribute('href', 'https://www.zotero.org/groups/2846077/items/A')
    fireEvent.change(screen.getByTestId('library-filter'), { target: { value: 'drought' } })
    await flush(10)
    expect(screen.getAllByTestId('library-item')).toHaveLength(1)
    expect(screen.getByTestId('library-count')).toHaveTextContent('1 of 3 publications')
  })
})

describe('the site map', () => {
  it('the header menu is HCDP’s, item for item, and every entry stays on this site', () => {
    expect(NAV.map((n) => n.label)).toEqual(['Home', 'About', 'Data Portal', 'Cultural Resources', 'Library', 'Research', 'Climate Tools'])
    expect(NAV[1].items.map((i) => i.label)).toEqual(['Team', 'HCDP History', 'Rainfall Mapping History', 'Climate Monitoring History', 'Acknowledgements', 'How to Cite'])
    expect(NAV[2].items.map((i) => i.label)).toEqual(['Access Data', 'HCDP / Hawaiʻi Mesonet API', 'Tutorials', 'How to Cite'])
    expect(NAV[5].items.map((i) => i.to)).toEqual(['/research/highlights', '/research/external-resources', '/research/presentations'])
    const all = NAV.flatMap((n) => (n.items ? n.items : [n]))
    expect(all.every((i) => i.to && !i.external)).toBe(true)
  })
  it('every mirrored address has its "Original HCDP version"', () => {
    const cases = {
      '/about/rainfall-mapping-history': `${HCDP}/rainfall-mapping-history/`, '/cultural-resources': `${HCDP}/news/`,
      '/cultural-resources/climate-glossary': `${HCDP}/climate-glossary/`, '/library': `${HCDP}/publications-list/`,
      '/research/highlights': `${HCDP}/research-highlights/`, '/research/external-resources': `${HCDP}/contact/`,
      '/research/posts/a-century-of-drought-in-hawaii': `${HCDP}/a-century-of-drought-in-hawaii/`, '/pacific/american-samoa': `${HCDP}/americansamoaportal/`,
      '/pacific/countries-and-territories': `${HCDP}/2826-2/`, '/pacific/guam': `${HCDP}/guam-data-viewer/`, '/pacific/as-about': `${HCDP}/as-about/`,
      '/data/tutorials/export-data-tutorial': `${HCDP}/export-data-tutorial/`, '/conditions-of-use': `${HCDP}/conditions-of-use/`,
      '/extreme-events/nolo': `${HCDP}/hurricane-nolo/`, '/tools/vmap-fire-weather': `${HCDP}/climate-tools/`,
    }
    for (const [path, url] of Object.entries(cases)) expect(originalFor(path).url).toBe(url)
  })
})
