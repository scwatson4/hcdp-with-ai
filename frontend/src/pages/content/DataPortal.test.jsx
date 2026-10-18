import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { AccessData, ExportData, VisualizeData } from './DataPortal'
import { lastCompleteMonth, yesterday, dayRange, hawaiiToday } from './contentUtils'
import { defaultMapPath, resolveDoor } from '../../site/visualize'
import { forgetPortalPages } from '../../portal/usePortalPage'
import { clearDownload, noteDownload } from '../../download/downloadStore'

const HCDP = 'https://www.hawaii.edu/climate-data-portal'
const renderAt = (ui, path = '/') => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)
const hrefs = () => screen.getAllByRole('link').map((a) => a.getAttribute('href'))

describe('date helpers (Hawaiʻi time)', () => {
  it('computes the last complete month, including across a year boundary', () => {
    expect(lastCompleteMonth(new Date('2026-09-25T12:00:00-10:00'))).toBe('2026-08')
    expect(lastCompleteMonth(new Date('2026-01-15T12:00:00-10:00'))).toBe('2025-12')
  })

  it('uses the Hawaiʻi calendar day for yesterday', () => {
    expect(yesterday(new Date('2026-09-25T12:00:00-10:00'))).toBe('2026-09-24')
    // 08:00 UTC on 25 Sept is still 24 Sept (22:00) in Honolulu
    expect(hawaiiToday(new Date('2026-09-25T08:00:00Z'))).toEqual({ y: 2026, m: 9, d: 24 })
    expect(yesterday(new Date('2026-09-25T08:00:00Z'))).toBe('2026-09-23')
    expect(yesterday(new Date('2026-03-01T12:00:00-10:00'))).toBe('2026-02-28')
  })

  it('lists days in a range, capped', () => {
    expect(dayRange('2026-09-23', '2026-09-24')).toEqual(['2026-09-23', '2026-09-24'])
    expect(dayRange('2026-09-23', '2026-09-22')).toEqual([])
    expect(dayRange('2026-09-01', '2026-09-30', 3)).toHaveLength(3)
  })
})

// 18 Oct (the user): "'ACCESS DATA' should open to two options only: Visualize Data and Export Data (like in the screenshot of
// the original HCDP website)".
describe('Access Data: two tiles, as on HCDP’s data portal', () => {
  let overview = null
  beforeEach(() => {
    overview = null
    forgetPortalPages()
    global.fetch = vi.fn(async (url) => {
      const u = new URL(url, 'http://localhost')
      if (u.pathname === '/api/portal/overview') return overview ? { ok: true, status: 200, json: async () => ({ path: '/data', overview }) } : { ok: false, status: 404, json: async () => ({ detail: 'not written yet' }) }
      return { ok: false, status: 404, json: async () => ({}) }
    })
  })

  it('is the two tiles and nothing else: Visualize Data and Export Data, the portal’s captions and pictures', () => {
    renderAt(<AccessData />, '/data')
    expect(screen.getByRole('heading', { level: 1, name: 'Access Data' })).toHaveClass('sr-only')
    const tiles = within(screen.getByRole('navigation', { name: 'Access Data' })).getAllByRole('link')
    expect(tiles.map((a) => [a.getAttribute('href'), a.textContent])).toEqual([
      ['/data/visualize', 'Visualize DataVisualize available climate data in the portal.'],
      ['/data/export', 'Export DataGenerate customized packages of data to export from the portal.'],
    ])
    expect(tiles[0]).toHaveAccessibleName('Visualize Data')
    expect(tiles[0]).toHaveAccessibleDescription('Visualize available climate data in the portal.')
    expect(within(tiles[1]).getByRole('heading', { level: 2 })).toHaveTextContent('Export Data')
    // the pictures the portal app uses (its vis_tile_background.png and export_tile_background.jpg, here as WebP)
    const pictures = screen.getAllByTestId('data-tile-picture')
    expect(pictures.map((p) => p.style.backgroundImage.replace(/"/g, ''))).toEqual(['url(/tiles/visualize-data.webp)', 'url(/tiles/export-data.webp)'])
    pictures.forEach((p) => { expect(p).toHaveAttribute('aria-hidden', 'true'); expect(p.className).toContain('hcdp-data-tile-picture') })
    tiles.forEach((a) => expect(a.className).toContain('hcdp-data-tile'))
    // nothing else on the page: no table, no form, no AI line, no frame
    expect(screen.queryByTestId('datasets-table')).toBeNull()
    expect(screen.queryByTestId('export-form')).toBeNull()
    expect(screen.queryByTestId('access-ai-line')).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
    expect(document.title).toBe('Access Data – Hawaiʻi Climate Data Portal')
  })

  it('the AI overview line sits above the tiles, closed on a direct load', async () => {
    overview = { chunks: ['Access Data opens on **Visualize Data** and **Export Data**. [1]'], cites: [[1]], more: [], more_cites: [], sources: [{ title: 'Access Data (interactive data portal)', url: `${HCDP}/data-portal/` }], followups: [], generated_at: '2026-10-18T00:00:00+00:00' }
    renderAt(<AccessData />, '/data')
    const block = await screen.findByTestId('ai-summary')
    expect(global.fetch).toHaveBeenCalledWith('/api/portal/overview?path=%2Fdata', expect.anything())
    expect(block).toHaveAttribute('data-status', 'collapsed')
    expect(within(block).getByTestId('ai-overview-chevron')).toHaveAttribute('data-direction', 'right')
    expect(block.compareDocumentPosition(screen.getByTestId('data-tiles')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('/data/visualize lands on the default map (the last complete month, statewide) and replaces itself', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-25T12:00:00-10:00'))
    let seen = null
    function Probe() { const loc = useLocation(); const type = useNavigationType(); seen = { path: loc.pathname, type }; return null }
    render(<MemoryRouter initialEntries={['/data/visualize']}><Routes><Route path="/data/visualize" element={<VisualizeData />} /><Route path="*" element={<Probe />} /></Routes></MemoryRouter>)
    await waitFor(() => expect(seen?.path).toBe('/viewer/rainfall/month/2026-08/statewide'))
    expect(seen.type).toBe('REPLACE')
    expect(defaultMapPath(new Date('2026-01-15T12:00:00-10:00'))).toBe('/viewer/rainfall/month/2025-12/statewide')
    expect(resolveDoor('/data/visualize', new Date('2026-09-25T12:00:00-10:00'))).toBe('/viewer/rainfall/month/2026-08/statewide')
    expect(resolveDoor('/data/export')).toBe('/data/export')
    vi.useRealTimers()
  })
})

describe('Export Data (/data/export): the form, the datasets and the AI-prepared downloads, as they were on /data', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-25T12:00:00-10:00'))
    clearDownload()
    // The export form asks for its options and the published dates; the page needs neither to render.
    global.fetch = vi.fn(async (url) => {
      const u = new URL(url, 'http://localhost')
      if (u.pathname === '/api/export/options') return { ok: true, status: 200, json: async () => ({ datasets: [{ id: 'rainfall', label: 'Rainfall', periods: ['month', 'day'], units: 'mm', extents: ['statewide'], grid_files: [], station_fills: { month: [], day: [] } }], file_types: {}, instant_max_files: 150 }) }
      if (u.pathname === '/api/dates') return { ok: true, status: 200, json: async () => ['1990-01-01T10:00:00.000Z', '2026-08-01T10:00:00.000Z'] }
      return { ok: false, status: 404, json: async () => ({}) }
    })
  })
  afterEach(() => { vi.useRealTimers(); clearDownload() })

  it('has the AI line on top, the native export form, the datasets table and the link to the original app', () => {
    renderAt(<ExportData />, '/data/export')
    const h1 = screen.getByRole('heading', { level: 1, name: 'Export Data' })
    expect(document.title).toBe('Export Data – Hawaiʻi Climate Data Portal')
    // the AI line ("Tell me what the data is for and I will tick it") sits at the very top, before the heading
    const line = screen.getByTestId('access-ai-line')
    expect(line.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('access-ai-input')).toHaveAttribute('placeholder', 'Tell me what the data is for and I will tick it')
    expect(screen.getByTestId('export-form')).toBeInTheDocument()
    expect(screen.getByTestId('export-download')).toHaveTextContent('Download now')
    expect(screen.getByTestId('export-email-send')).toHaveTextContent('Email me the package')
    expect(document.getElementById('export')).toContainElement(screen.getByTestId('export-form'))   // the line scrolls the form into view
    const table = screen.getByTestId('datasets-table')
    expect(within(table).getAllByRole('row')).toHaveLength(12) // header + 11 datasets
    const names = within(table).getAllByRole('rowheader').map((th) => th.firstChild.textContent)
    expect(names).toEqual(['Rainfall', 'Legacy Rainfall', 'Maximum Temperature', 'Minimum Temperature', 'Mean Temperature', 'Relative Humidity', 'Normalized Difference Vegetation Index (NDVI)', 'Ignition Probability', 'Standardized Precipitation Index (SPI)', 'Rainfall and Temperature Projections', 'Mean Rainfall and Air Temperature'])
    expect(within(table).getAllByRole('rowheader')[2]).toHaveTextContent(/^Maximum Temperature \(°C\)/)
    expect(within(table).getByRole('link', { name: 'Map Rainfall, August 2026, Statewide in Visualize Data' })).toHaveAttribute('href', '/viewer/rainfall/month/2026-08/statewide')
    expect(document.querySelector('iframe')).toBeNull()
    const original = within(screen.getByTestId('export-original-link')).getByRole('link')
    expect(original).toHaveAttribute('href', 'https://rainfall.ikewai.org/?datatype=spi&period=month')
    expect(original).toHaveAttribute('target', '_blank')
    const nav = screen.getByRole('navigation', { name: 'Related' })
    expect(within(nav).getByRole('link', { name: /^Access Data/ })).toHaveAttribute('href', '/data')
    expect(within(nav).getByRole('link', { name: /HCDP \/ Hawaiʻi Mesonet API/ })).toHaveAttribute('href', '/data/api')
  })

  it('shows the AI-prepared download’s offer, with the API-key line, when a data ask brought the visitor here', () => {
    noteDownload(7, { ask: 'rainfall for Lowell', offer: 'I can prepare the daily rainfall maps for Kauaʻi, 6–8 September 2026.', api_url: `${HCDP}/hcdp-hawaii-mesonet-api/` }, '/data/export')
    renderAt(<ExportData />, '/data/export')
    const offer = screen.getByTestId('download-offer')
    expect(within(offer).getByTestId('offer-sentence')).toHaveTextContent('daily rainfall maps for Kauaʻi')
    expect(within(offer).getByTestId('offer-button')).toHaveTextContent('Use AI to download the data I need')
    expect(within(offer).getByTestId('offer-key-line')).toHaveTextContent('Requires HCDP API key. Request one here')
    expect(within(offer).getByTestId('offer-key-link')).toHaveAttribute('href', `${HCDP}/hcdp-hawaii-mesonet-api/`)
  })
})

// The API and Tutorials pages are HCDP's own now, mirrored live (src/portal/portal.test.jsx).
