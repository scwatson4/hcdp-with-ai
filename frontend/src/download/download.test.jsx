import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import OfferCard, { OFFER_BUTTON } from './OfferCard'
import DownloadChecklist, { VERIFY_STAGGER_MS } from './DownloadChecklist'
import DownloadPanel from './DownloadPanel'
import DownloadPage from './DownloadPage'
import AccessDataLine, { ACCESS_PLACEHOLDER } from './AccessDataLine'
import { clearDownload, noteDownload } from './downloadStore'
import { estimateFor, formatBytes, packagePath, parsePicks, pickedIds, prefillFromPlan, prepareBody } from './planApi'
import { ExportData } from '../pages/content/DataPortal'
import { AssistantProvider } from '../assistant/AssistantProvider'
import AssistantBar from '../assistant/AssistantBar'
import { clearDateRanges } from '../viewer/map/dateRanges'
import { clearStationCache } from '../viewer/map/stationData'

// What POST /api/download/plan answers for the Lowell ask (backend/download_plan.py), cut to what the tests need.
const ASK = 'I need rainfall data from Hurricane Lowell'
const API_URL = 'https://www.hawaii.edu/climate-data-portal/hcdp-hawaii-mesonet-api/'
const READING = 'You asked for Hurricane Lowell rainfall data. I read this as the storm of 6 to 8 September 2026, which hit Kauaʻi hardest; I ticked the daily rainfall maps for Kauaʻi and the partial-filled station totals, and left the standard-error maps and the unfilled station data unticked as context.'
const GRID = { id: 'grid-rainfall-day-aaa111', group: 'grid', product: 'rainfall', label: 'Daily rainfall maps, 6–8 Sep 2026, Kauaʻi', period: 'day', start: '2026-09-06', end: '2026-09-08', extents: ['kauai'], files: ['data_map', 'metadata'], station_fills: [], ticked: true, why: "the storm's three days", note: null, status: 'ok', count: 6, bytes: 384000, units: 'mm' }
const STATION = { id: 'station-rainfall-day-bbb222', group: 'station', product: 'rainfall', label: 'Daily rainfall station data (partial-filled), 6–8 Sep 2026', period: 'day', start: '2026-09-06', end: '2026-09-08', extents: [], files: [], station_fills: ['partial'], ticked: true, why: 'the gauge totals behind the maps', note: null, status: 'ok', count: 1, bytes: 110000, units: 'mm' }
const SE = { ...GRID, id: 'grid-rainfall-day-ccc333', label: 'Daily rainfall standard error maps, 6–8 Sep 2026, Kauaʻi', files: ['se', 'metadata'], ticked: false, why: 'how sure the map is', note: 'no daily rainfall map for 9 Sep 2026 yet — the last day published is 8 Sep 2026', status: 'ok' }
const REPORT = { id: 'report-lowell', group: 'report', label: 'Hurricane Lowell report', url: 'https://www.hawaii.edu/climate-data-portal/hurricane-lowell/', why: "the storm's story, key figures and HCDP's official downloads, linked in the README", ticked: true, status: 'ok', count: 0, bytes: 0, note: null }
const PLAN = {
  ask: ASK, reading: READING, event: 'Hurricane Lowell', event_id: 'lowell', event_url: REPORT.url, place: 'Kauaʻi', period: 'day', start: '2026-09-06', end: '2026-09-08', extents: ['kauai'],
  items: [GRID, STATION, SE, REPORT],
  dropped: [{ id: 'rainfall-day-2026-09-09', group: 'grid', label: 'Daily rainfall, 9 Sep 2026', why: 'no daily rainfall for 9 Sep 2026 yet — the last day published is 8 Sep 2026', alternative: null }],
  groups: [{ id: 'grid', label: 'Gridded maps' }, { id: 'station', label: 'Station data' }, { id: 'report', label: 'From the storm report' }],
  primary_view: '/viewer/rainfall/day/2026-09-07/kauai', primary_view_label: 'Rainfall, September 7, 2026, Kauaʻi', instant_max_files: 150,
  package_path: `/download?ask=${encodeURIComponent(ASK)}&picks=grid-rainfall-day-aaa111,station-rainfall-day-bbb222,report-lowell`,
  package_url: `https://hcdp-with-ai.example.org/download?ask=${encodeURIComponent(ASK)}&picks=grid-rainfall-day-aaa111,station-rainfall-day-bbb222,report-lowell`,
  analyze_url: 'https://ai.example.org/?ask=I%20need%20rainfall%20data%20(HCDP%20data%20package%3A%20x)&ctx=viewer%3A%2Fviewer%2Frainfall%2Fday%2F2026-09-07%2Fkauai&from=website',
  api_url: API_URL, estimate: { files: 7, bytes: 494000, over_instant: false },
}
const BIG = { ...PLAN, ask: 'every daily rainfall map of 2026', items: [{ ...GRID, id: 'grid-rainfall-day-big999', label: 'Daily rainfall maps, 1 Jan – 11 Oct 2026, Statewide', extents: ['statewide'], count: 568, bytes: 525000000 }], groups: [PLAN.groups[0]], dropped: [], estimate: { files: 568, bytes: 525000000, over_instant: true } }
const OPTIONS = {
  datasets: [{ id: 'rainfall', label: 'Rainfall', periods: ['month', 'day'], units: 'mm', extents: ['statewide', 'hawaii', 'maui', 'oahu', 'kauai'],
    grid_files: [{ id: 'data_map', tag: 'data_map', label: 'Rainfall map', description: 'The gridded map.', type: 'tif', requires: ['metadata'] }, { id: 'se', tag: 'se', label: 'Standard error map', description: 'SE.', type: 'tif', requires: ['metadata'] }, { id: 'metadata', tag: 'metadata', label: 'Metadata and error metrics', description: 'Metadata.', type: 'txt', requires: [] }],
    station_fills: { month: [{ id: 'partial', label: 'Partial-filled station data', description: 'QC.', type: 'csv' }], day: [{ id: 'partial', label: 'Partial-filled station data', description: 'QC.', type: 'csv' }, { id: 'raw', label: 'Unfilled station data', description: 'Raw.', type: 'csv' }] } }],
  file_types: { tif: { label: 'GeoTIFF', ext: '.tif', description: 'A raster.' }, txt: { label: 'Text', ext: '.txt', description: 'Text.' }, csv: { label: 'CSV', ext: '.csv', description: 'A table.' } },
  instant_max_files: 150, email_max_files: 50000,
}

let planReply = () => PLAN
let prepareMode = 'zip'   // 'zip' | 'email' | 401
const posted = (path) => global.fetch.mock.calls.filter(([u]) => String(u) === path).map(([, init]) => JSON.parse(init.body))
function installFetch() {
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(String(url), 'http://localhost')
    if (u.pathname === '/api/download/plan') { const p = planReply(JSON.parse(init.body)); return p instanceof Error ? { ok: false, status: 503, json: async () => ({ detail: p.message }) } : { ok: true, status: 200, json: async () => p } }
    if (u.pathname === '/api/download/prepare') {
      if (prepareMode === 401) return { ok: false, status: 401, json: async () => ({ detail: 'HCDP did not accept that API key (it answered 401). Check the key, or request one on HCDP’s API page.' }) }
      if (prepareMode === 'email') return { ok: true, status: 202, json: async () => ({ ok: true, email: JSON.parse(init.body).email, files: 568, readme: '# HCDP data package — prepared with AI\n', package_url: BIG.package_url, analyze_url: BIG.analyze_url, message: 'HCDP is packaging about 568 files and will email a download link to ikaika@hawaii.edu (the link stays good for three days). The README is here to save beside it.' }) }
      return { ok: true, status: 200, headers: new Headers({ 'content-disposition': 'attachment; filename="hcdp_hurricane-lowell_2026-09-06_2026-09-08.zip"', 'content-type': 'application/zip', 'x-hcdp-files': '7', 'x-package-path': PLAN.package_path }), blob: async () => new Blob(['PK-zip'], { type: 'application/zip' }) }
    }
    if (u.pathname === '/api/export/options') return { ok: true, status: 200, json: async () => OPTIONS }
    if (u.pathname === '/api/dates') return { ok: true, status: 200, json: async () => (u.searchParams.get('period') === 'month' ? ['1990-01-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z'] : ['1990-01-01T10:00:00.000Z', '2026-10-11T10:00:00.000Z']) }
    if (u.pathname === '/api/summary') return { ok: true, status: 200, json: async () => ({ summary: '', chunks: [], cites: [], more: [], more_cites: [], sources: [], followups: [] }) }
    if (u.pathname === '/api/narrate') return { ok: true, status: 200, json: async () => ({ line: null }) }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}
const reduceMotion = (on) => { window.matchMedia = (q) => ({ matches: on && /reduce/.test(q), addEventListener() {}, removeEventListener() {} }) }
const at = (ui, path = '/data/api') => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)

beforeEach(() => { planReply = () => PLAN; prepareMode = 'zip'; clearDownload(); clearDateRanges(); clearStationCache(); installFetch(); reduceMotion(true) })
afterEach(() => { vi.useRealTimers(); clearDownload() })

describe('planApi', () => {
  it('builds the package address, reads picks, estimates and derives the Export prefill', () => {
    expect(packagePath('I need rain', ['a-1', 'b-2', 'bad id!'])).toBe('/download?ask=I%20need%20rain&picks=a-1,b-2')
    expect(packagePath('x')).toBe('/download?ask=x')
    expect(parsePicks('?ask=x&picks=a-1,b-2,nope!')).toEqual(['a-1', 'b-2']) ; expect(parsePicks('?ask=x')).toBeNull()
    expect([...pickedIds(PLAN)]).toEqual([GRID.id, STATION.id, REPORT.id])                          // the AI's ticks
    expect([...pickedIds(PLAN, [SE.id, 'unknown'])]).toEqual([SE.id])                               // the address's picks win when any match
    expect([...pickedIds(PLAN, ['unknown'])]).toEqual([GRID.id, STATION.id, REPORT.id])             // none match: back to the AI's
    expect(estimateFor(PLAN.items, new Set([GRID.id, STATION.id, REPORT.id]))).toEqual({ files: 7, bytes: 494000, overInstant: false })
    expect(estimateFor(BIG.items, new Set([BIG.items[0].id])).overInstant).toBe(true)
    expect(formatBytes(494000)).toBe('482 KB'); expect(formatBytes(384000 * 6)).toBe('2.2 MB'); expect(formatBytes(525000000)).toBe('501 MB'); expect(formatBytes(12)).toBe('12 B')
    expect(prefillFromPlan(PLAN)).toEqual({ dataset: 'rainfall', period: 'day', start: '2026-09-06', end: '2026-09-08', extents: ['kauai'], files: ['data_map', 'metadata'], stationFiles: ['partial'] })
    expect(prefillFromPlan(PLAN, new Set([STATION.id]))).toEqual({ dataset: 'rainfall', period: 'day', start: '2026-09-06', end: '2026-09-08', extents: [], files: [], stationFiles: ['partial'] })
    expect(prefillFromPlan({ items: [REPORT] })).toBeNull()
    const body = prepareBody(PLAN, new Set([GRID.id]), 'k'.repeat(12), ' a@b.co ')
    expect(body).toEqual({ ask: ASK, reading: READING, items: [GRID], api_key: 'k'.repeat(12), event: 'Hurricane Lowell', place: 'Kauaʻi', primary_view: PLAN.primary_view, email: 'a@b.co' })
    expect(prepareBody(PLAN, new Set(), 'k', '')).not.toHaveProperty('email')
  })
})

describe('the offer card on /data/api (D1 A)', () => {
  it('shows the sentence, the button and the API-key line with the catalog link, only on the page the offer is for', () => {
    noteDownload(7, { ask: ASK, offer: 'I can prepare the daily rainfall maps and station totals for Hurricane Lowell (6–8 September 2026, Kauaʻi) as one zip.', hints: { event: 'Lowell' }, api_url: API_URL }, '/data/api')
    const { unmount } = at(<OfferCard />, '/data')
    expect(screen.queryByTestId('download-offer')).toBeNull()
    unmount()
    at(<OfferCard />, '/data/api')
    const card = screen.getByTestId('download-offer')
    expect(within(card).getByTestId('offer-sentence')).toHaveTextContent('I can prepare the daily rainfall maps and station totals for Hurricane Lowell (6–8 September 2026, Kauaʻi) as one zip.')
    expect(within(card).getByTestId('offer-button')).toHaveTextContent(OFFER_BUTTON)
    expect(OFFER_BUTTON).toBe('Use AI to download the data I need')
    expect(within(card).getByTestId('offer-key-line').textContent.replace(/\s*\(opens in a new tab\)/, '')).toBe('Requires HCDP API key. Request one here')
    const link = within(card).getByTestId('offer-key-link')
    expect(link).toHaveAttribute('href', API_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(card.querySelector('.hcdp-ai-summary-rule')).not.toBeNull()
    fireEvent.click(within(card).getByTestId('offer-dismiss'))
    expect(screen.queryByTestId('download-offer')).toBeNull()
  })

  it('opens the drawer, which plans from the ask and hints and shows the plain-English reading', async () => {
    noteDownload(8, { ask: ASK, offer: 'One zip.', hints: { event: 'Lowell', period: 'day' }, api_url: API_URL }, '/data/api')
    at(<OfferCard />)
    fireEvent.click(screen.getByTestId('offer-button'))
    const drawer = await screen.findByTestId('download-drawer')
    expect(drawer).toHaveAttribute('role', 'dialog')
    const loading = within(drawer).queryByTestId('download-loading')   // the fake plan may already be here
    if (loading) expect(loading).toHaveTextContent('Reading your ask and checking what HCDP has…')
    expect(await within(drawer).findByTestId('download-reading')).toHaveTextContent(READING)
    expect(posted('/api/download/plan')).toEqual([{ ask: ASK, hints: { event: 'Lowell', period: 'day' }, context: { path: '/data/api' }, extra: '', previous: [] }])
    expect(within(drawer).getByTestId('download-key-link')).toHaveAttribute('href', API_URL)
  })
})

describe('the checklist (D2 A + D4 A)', () => {
  const Harness = ({ picked = new Set([GRID.id, STATION.id, REPORT.id]), onToggle = () => {}, onSomethingElse = () => {}, plan = PLAN, replanning = false }) => (
    <MemoryRouter><DownloadChecklist plan={plan} picked={picked} onToggle={onToggle} onSomethingElse={onSomethingElse} replanning={replanning} /></MemoryRouter>
  )

  it('groups the items by kind with the AI ticks, a why per item, the counts, the notes and what is not offered', () => {
    const toggles = []
    render(<Harness onToggle={(id) => toggles.push(id)} />)
    expect(screen.getByTestId('download-reading')).toHaveTextContent(READING)
    const groups = [...document.querySelectorAll('[data-testid^="download-group-"]')]
    expect(groups.map((g) => g.querySelector('legend').textContent)).toEqual(['Gridded maps', 'Station data', 'From the storm report'])
    const rows = screen.getAllByTestId('download-item')
    expect(rows.map((r) => r.dataset.itemId)).toEqual([GRID.id, SE.id, STATION.id, REPORT.id])
    expect(screen.getByTestId(`download-tick-${GRID.id}`)).toBeChecked()
    expect(screen.getByTestId(`download-tick-${SE.id}`)).not.toBeChecked()
    expect(screen.getByTestId(`download-tick-${REPORT.id}`)).toBeChecked()
    expect(within(rows[0]).getByTestId('download-item-why')).toHaveTextContent("The storm's three days")
    expect(within(rows[0]).getByTestId('download-item-count')).toHaveTextContent('6 files')
    expect(within(rows[0]).getByTestId('download-item-count')).toHaveTextContent('375 KB')
    expect(within(rows[1]).getByTestId('download-item-note')).toHaveTextContent('no daily rainfall map for 9 Sep 2026 yet — the last day published is 8 Sep 2026')
    expect(within(rows[2]).getByTestId('download-item-count')).toHaveTextContent('1 file')
    expect(within(rows[3]).queryByTestId('download-item-count')).toBeNull()
    expect(within(rows[3]).getByTestId('download-item-link')).toHaveAttribute('href', REPORT.url)
    expect(screen.getByTestId('download-dropped-item')).toHaveTextContent('Not offered: Daily rainfall, 9 Sep 2026 — no daily rainfall for 9 Sep 2026 yet — the last day published is 8 Sep 2026')
    fireEvent.click(screen.getByTestId(`download-tick-${SE.id}`))
    expect(toggles).toEqual([SE.id])
    // reduced motion: every row confirmed at once
    expect(rows.every((r) => r.dataset.verify === 'ok')).toBe(true)
    expect(document.querySelectorAll('.hcdp-verify-ok')).toHaveLength(4)
  })

  it('reveals the verify marks one row at a time, 120 ms apart, from a ring to a check', () => {
    reduceMotion(false)
    vi.useFakeTimers()
    render(<Harness />)
    const rows = screen.getAllByTestId('download-item')
    expect(rows.map((r) => r.dataset.verify)).toEqual(['pending', 'pending', 'pending', 'pending'])
    expect(rows[0].querySelector('.hcdp-comet-ring')).not.toBeNull()
    expect(screen.getByTestId(`download-tick-${GRID.id}`)).toBeDisabled()          // nothing to tick until its row is confirmed
    act(() => { vi.advanceTimersByTime(VERIFY_STAGGER_MS) })
    expect(rows.map((r) => r.dataset.verify)).toEqual(['ok', 'pending', 'pending', 'pending'])
    expect(rows[0].querySelector('.hcdp-verify-ok')).not.toBeNull()
    expect(rows[0].querySelector('.hcdp-comet-ring')).toBeNull()
    expect(screen.getByTestId(`download-tick-${GRID.id}`)).toBeEnabled()
    act(() => { vi.advanceTimersByTime(VERIFY_STAGGER_MS) })
    expect(rows.map((r) => r.dataset.verify)).toEqual(['ok', 'ok', 'pending', 'pending'])
    act(() => { vi.advanceTimersByTime(VERIFY_STAGGER_MS * 2) })
    expect(rows.map((r) => r.dataset.verify)).toEqual(['ok', 'ok', 'ok', 'ok'])
    expect(VERIFY_STAGGER_MS).toBe(120)
  })

  it('shows partial and unverified marks, and the "Something else…" row re-plans with the wish', () => {
    const wishes = []
    const plan = { ...PLAN, items: [{ ...GRID, status: 'partial', note: '4 of 5 days have maps; 1 is not published' }, { ...STATION, status: 'unverified', note: "HCDP's file listing did not answer; the file count is an estimate" }], groups: PLAN.groups.slice(0, 2), dropped: [] }
    render(<Harness plan={plan} onSomethingElse={(t) => wishes.push(t)} />)
    const rows = screen.getAllByTestId('download-item')
    expect(rows.map((r) => r.dataset.verify)).toEqual(['partial', 'unverified'])
    expect(rows[0].querySelector('[data-verify="partial"]')).not.toBeNull()
    expect(screen.queryByTestId('download-dropped')).toBeNull()
    fireEvent.click(screen.getByTestId('download-something-else'))
    const input = screen.getByTestId('download-extra')
    expect(input).toHaveAttribute('placeholder', 'What else should the package include?')
    expect(screen.getByTestId('download-extra-add')).toBeDisabled()
    fireEvent.change(input, { target: { value: 'also the maximum temperature' } })
    fireEvent.click(screen.getByTestId('download-extra-add'))
    expect(wishes).toEqual(['also the maximum temperature'])
    expect(screen.getByTestId('download-something-else')).toBeInTheDocument()   // folded back
  })
})

describe('the panel: counts, address, key, Download now / Email me (D3 A + D5 A)', () => {
  it('needs the key, posts the picked items with it, saves the zip and offers Analyze with AI', async () => {
    const urls = []
    URL.createObjectURL = vi.fn((blob) => { urls.push(blob); return 'blob:zip' })
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { urls.push(this.download) })
    at(<DownloadPanel ask={ASK} hints={{ event: 'Lowell' }} context={{ path: '/data/api' }} />)
    await screen.findByTestId('download-reading')
    expect(screen.getByTestId('download-totals')).toHaveTextContent('7 files · about 482 KB.')
    expect(screen.getByTestId('download-totals')).toHaveTextContent('Up to 150 files download at once')
    expect(screen.getByTestId('download-view')).toHaveAttribute('href', '/viewer/rainfall/day/2026-09-07/kauai')
    expect(screen.getByTestId('download-address').textContent).toBe(`${window.location.origin}${PLAN.package_path}`)
    expect(screen.getByTestId('download-now')).toBeDisabled()
    expect(screen.getByTestId('download-problem')).toHaveTextContent('Paste your HCDP API key first.')
    expect(screen.queryByTestId('download-email-me')).toBeNull()
    const key = screen.getByTestId('download-key')
    expect(key).toHaveAttribute('type', 'password')
    expect(key).toHaveAttribute('autocomplete', 'off')
    fireEvent.change(key, { target: { value: 'visitor-key-7f3a9c' } })
    expect(screen.getByTestId('download-now')).toBeEnabled()
    // unticking the station file changes the count and the address
    fireEvent.click(screen.getByTestId(`download-tick-${STATION.id}`))
    expect(screen.getByTestId('download-totals')).toHaveTextContent('6 files · about 375 KB.')
    expect(screen.getByTestId('download-address').textContent).toContain(`picks=${GRID.id},${REPORT.id}`)
    fireEvent.click(screen.getByTestId('download-now'))
    await waitFor(() => expect(screen.getByTestId('download-result')).toHaveTextContent('Downloading'))
    const body = posted('/api/download/prepare')[0]
    expect(body.api_key).toBe('visitor-key-7f3a9c')
    expect(body.items.map((i) => i.id)).toEqual([GRID.id, REPORT.id])
    expect(body.ask).toBe(ASK) && expect(body.reading).toBe(READING)
    expect(body).not.toHaveProperty('email')
    expect(urls[0]).toBeInstanceOf(Blob)
    expect(urls[1]).toBe('hcdp_hurricane-lowell_2026-09-06_2026-09-08.zip')
    expect(screen.getByTestId('download-result')).toHaveTextContent('Your download has started: hcdp_hurricane-lowell_2026-09-06_2026-09-08.zip')
    expect(screen.getByTestId('download-result')).toHaveTextContent('with README.md inside')
    expect(screen.getByTestId('download-result-analyze')).toHaveAttribute('href', PLAN.analyze_url)
    expect(screen.getByTestId('download-analyze')).toHaveAttribute('target', '_blank')
    // the key is in its field and nowhere else on the page
    expect(document.body.textContent).not.toContain('visitor-key-7f3a9c')
    expect(screen.getByTestId('download-address').textContent).not.toContain('visitor-key')
    click.mockRestore()
  })

  it('over 150 files the button becomes Email me, needs an address, and the 202 brings the README back', async () => {
    planReply = () => BIG
    prepareMode = 'email'
    at(<DownloadPanel ask={BIG.ask} />)
    await screen.findByTestId('download-reading')
    expect(screen.getByTestId('download-totals')).toHaveTextContent('568 files · about 501 MB. More than the 150 HCDP zips for a direct download — HCDP will email the package.')
    expect(screen.queryByTestId('download-now')).toBeNull()
    const button = screen.getByTestId('download-email-me')
    expect(button).toHaveTextContent('Email me')
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByTestId('download-key'), { target: { value: 'visitor-key-7f3a9c' } })
    expect(button).toBeDisabled()
    expect(screen.getByTestId('download-problem')).toHaveTextContent('Add the email address HCDP should send the package to.')
    fireEvent.change(screen.getByTestId('download-email'), { target: { value: 'ikaika@hawaii.edu' } })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByTestId('download-result')).toHaveTextContent('Request sent'))
    expect(screen.getByTestId('download-result')).toHaveTextContent('will email a download link to ikaika@hawaii.edu')
    expect(screen.getByTestId('download-save-readme')).toHaveTextContent('Save the README')
    const body = posted('/api/download/prepare')[0]
    expect(body.email).toBe('ikaika@hawaii.edu') && expect(body.api_key).toBe('visitor-key-7f3a9c')
    expect(Object.keys(localStorage)).toEqual([])
  })

  it('says in plain words when HCDP refuses the key, and when the planner fails', async () => {
    prepareMode = 401
    at(<DownloadPanel ask={ASK} />)
    await screen.findByTestId('download-reading')
    fireEvent.change(screen.getByTestId('download-key'), { target: { value: 'wrong-key-12345' } })
    fireEvent.click(screen.getByTestId('download-now'))
    await waitFor(() => expect(screen.getByTestId('download-result')).toHaveTextContent('That did not work'))
    expect(screen.getByTestId('download-result')).toHaveTextContent('HCDP did not accept that API key (it answered 401).')
    planReply = () => new Error('The AI planner did not answer in time. Try again in a moment, or tick the Export form yourself.')
    at(<DownloadPanel ask="rain" />)
    expect(await screen.findByTestId('download-error')).toHaveTextContent('The AI planner did not answer in time.')
  })

  it('"Something else…" re-plans with the wish and the items so far, keeping the ticks', async () => {
    const TMAX = { ...GRID, id: 'grid-temperature-max-day-ddd444', product: 'temperature-max', label: 'Daily maximum temperature maps, 6–8 Sep 2026, Kauaʻi', why: 'the extra wish', ticked: true }
    planReply = (body) => (body.extra ? { ...PLAN, items: [TMAX, ...PLAN.items] } : PLAN)
    at(<DownloadPanel ask={ASK} />)
    await screen.findByTestId('download-reading')
    fireEvent.click(screen.getByTestId(`download-tick-${SE.id}`))      // a manual tick survives the re-plan
    fireEvent.click(screen.getByTestId('download-something-else'))
    fireEvent.change(screen.getByTestId('download-extra'), { target: { value: 'also the max temperature' } })
    fireEvent.click(screen.getByTestId('download-extra-add'))
    expect(screen.getByTestId('download-replanning')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByTestId('download-item')).toHaveLength(5))
    const second = posted('/api/download/plan')[1]
    expect(second.extra).toBe('also the max temperature')
    expect(second.previous.map((i) => i.id)).toEqual([GRID.id, STATION.id, SE.id])     // the data items, not the report link
    expect(screen.getByTestId(`download-tick-${TMAX.id}`)).toBeChecked()
    expect(screen.getByTestId(`download-tick-${SE.id}`)).toBeChecked()
    expect(screen.getByTestId('download-totals')).toHaveTextContent('19 files')
  })
})

describe('the Access Data AI line (D1 D; on Export Data since 18 Oct)', () => {
  it('plans from the sentence, pre-ticks the Export form, and offers Visualize and the full package', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-13T12:00:00-10:00'))
    at(<ExportData />, '/data/export')
    const input = screen.getByTestId('access-ai-input')
    expect(input).toHaveAttribute('placeholder', ACCESS_PLACEHOLDER)
    expect(ACCESS_PLACEHOLDER).toBe('Tell me what the data is for and I will tick it')
    // the line sits at the very top of the page, before the heading
    const line = screen.getByTestId('access-ai-line')
    const h1 = screen.getByRole('heading', { level: 1, name: 'Export Data' })
    expect(line.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('export-start')).toHaveValue('2025-10'))      // the form's own default first
    expect(screen.getByTestId('access-ai-prepare')).toBeDisabled()
    fireEvent.change(input, { target: { value: ASK } })
    fireEvent.click(screen.getByTestId('access-ai-prepare'))
    expect(await screen.findByTestId('access-ai-reading')).toHaveTextContent(READING)
    expect(posted('/api/download/plan')[0]).toEqual({ ask: ASK, hints: {}, context: { path: '/data/export' }, extra: '', previous: [] })
    expect(screen.getByTestId('access-ai-ticked')).toHaveTextContent('The Export form below is ticked to match')
    expect(screen.getByTestId('access-ai-visualize')).toHaveAttribute('href', '/viewer/rainfall/day/2026-09-07/kauai')
    // the Export form now says what the plan says
    await waitFor(() => expect(screen.getByTestId('export-start')).toHaveValue('2026-09-06'))
    expect(screen.getByTestId('export-end')).toHaveValue('2026-09-08')
    expect(screen.getByTestId('export-dataset')).toHaveValue('rainfall')
    expect(within(screen.getByTestId('export-period')).getByLabelText('Daily')).toBeChecked()
    expect(screen.getByTestId('export-extent-kauai')).toBeChecked()
    expect(screen.getByTestId('export-extent-statewide')).not.toBeChecked()
    expect(screen.getByTestId('export-file-data_map')).toBeChecked()
    expect(screen.getByTestId('export-file-metadata')).toBeChecked()
    expect(screen.getByTestId('export-file-se')).not.toBeChecked()
    expect(screen.getByTestId('export-station-partial')).toBeChecked()
    expect(screen.getByTestId('export-estimate')).toHaveTextContent('About 9 files.')      // 3 days × (1 extent × 2 files + 1 station file), hcdp_v2's formula
    // the full package opens the drawer on the same plan — no second planner call
    fireEvent.click(screen.getByTestId('access-ai-package'))
    const drawer = await screen.findByTestId('download-drawer')
    expect(within(drawer).getByTestId('download-reading')).toHaveTextContent(READING)
    expect(posted('/api/download/plan')).toHaveLength(1)
  })

  it('tells the visitor when the plan fails, and the form stays usable', async () => {
    planReply = () => new Error('The AI planner did not answer in time. Try again in a moment, or tick the Export form yourself.')
    at(<AccessDataLine onPrefill={() => {}} />, '/data/export')
    fireEvent.change(screen.getByTestId('access-ai-input'), { target: { value: 'rain' } })
    fireEvent.submit(screen.getByTestId('access-ai-input').closest('form'))
    expect(await screen.findByTestId('access-ai-error')).toHaveTextContent('The AI planner did not answer in time.')
  })
})

describe('the /download page (D2 A: a page of its own)', () => {
  it('plans from ?ask= and ticks the items ?picks= names', async () => {
    at(<Routes><Route path="/download" element={<DownloadPage />} /></Routes>, `/download?ask=${encodeURIComponent(ASK)}&picks=${SE.id},${REPORT.id}`)
    expect(screen.getByRole('heading', { level: 1, name: 'AI-prepared download' })).toBeInTheDocument()
    await screen.findByTestId('download-reading')
    expect(posted('/api/download/plan')[0].ask).toBe(ASK)
    expect(screen.getByTestId(`download-tick-${SE.id}`)).toBeChecked()
    expect(screen.getByTestId(`download-tick-${REPORT.id}`)).toBeChecked()
    expect(screen.getByTestId(`download-tick-${GRID.id}`)).not.toBeChecked()
    expect(screen.getByTestId('download-totals')).toHaveTextContent('6 files')
    expect(screen.getByTestId('download-ask')).toHaveTextContent(ASK)
  })

  it('its ?ask= is the package address, not a question for the assistant (only /?ask= asks on arrival)', async () => {
    const navigates = () => global.fetch.mock.calls.filter(([u]) => String(u) === '/api/navigate').length
    render(<MemoryRouter initialEntries={[`/download?ask=${encodeURIComponent(ASK)}`]}><AssistantProvider><Routes><Route path="/download" element={<DownloadPage />} /></Routes></AssistantProvider></MemoryRouter>)
    await screen.findByTestId('download-reading')
    await new Promise((r) => setTimeout(r, 80))
    expect(navigates()).toBe(0)
    expect(posted('/api/download/plan')).toHaveLength(1)
  })

  it('without an ask it asks for one and goes to its address', () => {
    function Probe() { const { pathname, search } = useLocation(); return <div data-testid="probe">{pathname + search}</div> }
    at(<><Routes><Route path="/download" element={<DownloadPage />} /></Routes><Probe /></>, '/download')
    fireEvent.change(screen.getByTestId('download-page-ask'), { target: { value: 'rainfall for Maui in August' } })
    fireEvent.click(screen.getByTestId('download-page-go'))
    expect(screen.getByTestId('probe')).toHaveTextContent('/download?ask=rainfall%20for%20Maui%20in%20August')
  })
})

describe('the provider hook: a download answer carries the offer to the page it opens', () => {
  it('notes the offer on a download reply (the card shows on /data/api) and clears it on the next answer', async () => {
    const downloadReply = { intent: 'download', reply: 'Taking you to the API page, where I can prepare the Lowell files.', actions: [{ type: 'navigate', path: '/data/api' }], alternatives: [], minimize: true,
      download: { ask: ASK, offer: 'I can prepare the Lowell rainfall maps as one zip.', hints: { event: 'Hurricane Lowell' }, api_url: API_URL } }
    const infoReply = { intent: 'info', reply: 'HCDP is the portal.', actions: [], alternatives: [] }
    let reply = downloadReply
    const base = global.fetch
    global.fetch = vi.fn(async (url, init) => (String(url) === '/api/navigate' ? { ok: true, status: 200, json: async () => reply } : base(url, init)))
    function Probe() { const { pathname } = useLocation(); return <div data-testid="probe">{pathname}</div> }
    render(<MemoryRouter initialEntries={['/data']}><AssistantProvider><AssistantBar /><Probe /><OfferCard /></AssistantProvider></MemoryRouter>)
    const input = screen.getByTestId('assistant-input')
    fireEvent.change(input, { target: { value: ASK } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/data/api'))
    expect(await screen.findByTestId('download-offer')).toHaveTextContent('I can prepare the Lowell rainfall maps as one zip.')
    expect(screen.getByTestId('offer-key-link')).toHaveAttribute('href', API_URL)
    // the next, unrelated answer takes the offer away
    reply = infoReply
    fireEvent.change(screen.getByTestId('assistant-input'), { target: { value: 'what is HCDP' } })
    fireEvent.keyDown(screen.getByTestId('assistant-input'), { key: 'Enter' })
    await waitFor(() => expect(screen.queryByTestId('download-offer')).toBeNull())
  })
})
