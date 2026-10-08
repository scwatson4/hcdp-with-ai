import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import ExportForm, { defaultWindow, estimateFiles, isEmail, periodsBetween, requestBody, withRequired } from './ExportForm'
import { clearDateRanges } from '../../viewer/map/dateRanges'
import { clearStationCache } from '../../viewer/map/stationData'

// What GET /api/export/options answers (backend/export.py options()), cut to what the tests need.
const GRID = (what) => [
  { id: 'data_map', tag: 'data_map', label: `${what} map`, description: 'The gridded map.', type: 'tif', requires: ['metadata'] },
  { id: 'se', tag: 'se', label: 'Standard error map', description: 'The standard error.', type: 'tif', requires: ['metadata'] },
  { id: 'metadata', tag: 'metadata', label: 'Metadata and error metrics', description: 'Metadata.', type: 'txt', requires: [] },
]
const OPTIONS = {
  datasets: [
    { id: 'rainfall', label: 'Rainfall', periods: ['month', 'day'], units: 'mm', extents: ['statewide', 'hawaii', 'maui', 'oahu', 'kauai'], grid_files: [...GRID('Rainfall'), { id: 'anom', tag: 'anom', label: 'Anomaly map', description: 'Anomalies.', type: 'tif', requires: ['metadata'] }],
      station_fills: { month: [{ id: 'partial', label: 'Partial-filled station data', description: 'QC.', type: 'csv' }], day: [{ id: 'partial', label: 'Partial-filled station data', description: 'QC.', type: 'csv' }, { id: 'raw', label: 'Unfilled station data', description: 'Raw.', type: 'csv' }] } },
    { id: 'rainfall-legacy', label: 'Rainfall (legacy, 1920–2012)', periods: ['month'], units: 'mm', extents: ['statewide'], grid_files: [{ id: 'data_map', tag: 'data_map', label: 'Rainfall map', description: 'The gridded map.', type: 'tif', requires: [] }], station_fills: { month: [] } },
    { id: 'temperature-max', label: 'Maximum temperature', periods: ['month', 'day'], units: 'c', extents: ['statewide', 'hawaii', 'maui', 'oahu', 'kauai'], grid_files: GRID('Temperature'), station_fills: { month: [{ id: 'partial', label: 'Partial-filled station data', description: 'QC.', type: 'csv' }], day: [{ id: 'partial', label: 'Partial-filled station data', description: 'QC.', type: 'csv' }] } },
  ],
  file_types: { tif: { label: 'GeoTIFF', ext: '.tif', description: 'A raster.' }, txt: { label: 'Text', ext: '.txt', description: 'Text.' }, csv: { label: 'CSV', ext: '.csv', description: 'A table.' } },
  instant_max_files: 150, email_max_files: 50000,
}
const DAY_RANGE = ['1990-01-01T10:00:00.000Z', '2026-09-23T10:00:00.000Z']
const MONTH_RANGE = ['1990-01-01T10:00:00.000Z', '2026-08-01T10:00:00.000Z']

let instantMode = 'zip' // 'zip' | 413 | 502 | 'network'
let emailMode = 202
function installFetch() {
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(url, 'http://localhost')
    if (u.pathname === '/api/export/options') return { ok: true, status: 200, json: async () => OPTIONS }
    if (u.pathname === '/api/dates') return { ok: true, status: 200, json: async () => (u.searchParams.get('period') === 'month' ? MONTH_RANGE : DAY_RANGE) }
    if (u.pathname === '/api/export/instant') {
      if (instantMode === 'network') throw new TypeError('Failed to fetch')
      if (instantMode === 413) return { ok: false, status: 413, json: async () => ({ detail: 'about 300 files: have the package emailed instead' }) }
      if (instantMode === 502) return { ok: false, status: 502, json: async () => ({ detail: 'HCDP returned 500 for this package' }) }
      return { ok: true, status: 200, headers: new Headers({ 'content-disposition': 'attachment; filename="hcdp_rainfall_month_2025-09_2026-08.zip"', 'content-type': 'application/zip' }), blob: async () => new Blob(['PK-zip'], { type: 'application/zip' }) }
    }
    if (u.pathname === '/api/export/email') {
      if (emailMode === 429) return { ok: false, status: 429, json: async () => ({ detail: 'That is a lot of email requests from one connection in a short time.' }) }
      return { ok: true, status: 202, json: async () => ({ ok: true, email: JSON.parse(init.body).email, files: 24, message: `HCDP is packaging about 24 files and will email a download link to ${JSON.parse(init.body).email}.` }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}
const posted = (path) => global.fetch.mock.calls.filter(([u]) => String(u) === path).map(([, init]) => JSON.parse(init.body))

beforeEach(() => { instantMode = 'zip'; emailMode = 202; clearDateRanges(); clearStationCache(); installFetch() })
afterEach(async () => { await act(async () => { await new Promise((r) => setTimeout(r, 20)) }) })

describe('the export arithmetic', () => {
  it('counts periods and files like hcdp_v2, ticks required files, and picks the default window', () => {
    expect(periodsBetween('2026-01', '2026-08', 'month')).toBe(8)
    expect(periodsBetween('2026-09-01', '2026-09-07', 'day')).toBe(7)
    expect(periodsBetween('2026-09-07', '2026-09-01', 'day')).toBe(0)
    expect(estimateFiles({ start: '2026-01', end: '2026-08', period: 'month', extents: ['statewide', 'oahu'], files: ['data_map', 'metadata'], stationFiles: ['partial'] })).toBe(40)
    expect(withRequired(['data_map'], GRID('x'))).toEqual(['data_map', 'metadata'])
    expect(withRequired(['metadata', 'se'], GRID('x'))).toEqual(['se', 'metadata'])              // in the catalogue's order
    expect(defaultWindow({ start: '1990-01', end: '2026-08' }, 'month')).toEqual({ start: '2025-09', end: '2026-08' })
    expect(defaultWindow({ start: '1990-01-01', end: '2026-09-23' }, 'day')).toEqual({ start: '2026-08-23', end: '2026-09-23' })
    expect(defaultWindow({ start: '2026-08', end: '2026-08' }, 'month')).toEqual({ start: '2026-08', end: '2026-08' })  // clamped to the record
    expect(isEmail('ikaika@hawaii.edu')).toBe(true)
    expect(isEmail('ikaika@hawaii')).toBe(false)
    expect(requestBody({ dataset: 'rainfall', period: 'month', start: '2026-01', end: '2026-08', extents: ['statewide'], files: ['data_map', 'metadata'], stationFiles: [], email: ' a@b.co ' }))
      .toEqual({ dataset: 'rainfall', period: 'month', start: '2026-01', end: '2026-08', extents: ['statewide'], files: ['data_map', 'metadata'], station_files: [], email: 'a@b.co' })
    // station data alone needs no extent, and no email key travels when the field is blank
    expect(requestBody({ dataset: 'rainfall', period: 'day', start: '2026-09-01', end: '2026-09-07', extents: ['statewide'], files: [], stationFiles: ['raw'], email: '' }))
      .toEqual({ dataset: 'rainfall', period: 'day', start: '2026-09-01', end: '2026-09-07', extents: [], files: [], station_files: ['raw'] })
  })
})

describe('the export form', () => {
  it('offers what /api/export/options says, defaults to a year of monthly rainfall statewide, and counts the files', async () => {
    render(<ExportForm originalHref="https://rainfall.ikewai.org/" />)
    const form = screen.getByTestId('export-form')
    await waitFor(() => expect(within(screen.getByTestId('export-dataset')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Rainfall', 'Rainfall (legacy, 1920–2012)', 'Maximum temperature']))
    expect(screen.getByTestId('export-dataset')).toHaveValue('rainfall')
    expect(within(screen.getByTestId('export-period')).getByLabelText('Monthly')).toBeChecked()
    await waitFor(() => expect(screen.getByTestId('export-start')).toHaveValue('2025-09'))
    expect(screen.getByTestId('export-end')).toHaveValue('2026-08')
    expect(screen.getByTestId('export-range-hint')).toHaveTextContent('from Jan 1990 to Aug 2026')
    // the map and its metadata are ticked; the metadata cannot be unticked while a map wants it
    expect(screen.getByTestId('export-file-data_map')).toBeChecked()
    expect(screen.getByTestId('export-file-metadata')).toBeChecked()
    expect(screen.getByTestId('export-file-metadata')).toBeDisabled()
    expect(screen.getByTestId('export-file-se')).not.toBeChecked()
    expect(screen.getByTestId('export-extent-statewide')).toBeChecked()
    expect(screen.getByTestId('export-station-partial')).not.toBeChecked()
    expect(screen.queryByTestId('export-station-raw')).toBeNull()                       // no raw monthly station data
    expect(screen.getByTestId('export-estimate')).toHaveTextContent('About 24 files.')   // 12 months × 1 extent × 2 files
    // the licence gates both buttons
    expect(screen.getByTestId('export-problems')).toHaveTextContent('Acknowledge the licence.')
    expect(screen.getByTestId('export-download')).toBeDisabled()
    fireEvent.click(screen.getByTestId('export-licence'))
    expect(screen.getByTestId('export-download')).toBeEnabled()
    expect(screen.getByTestId('export-email-send')).toBeDisabled()                     // no address yet
    // more extents and files multiply the count; unticking every map frees the metadata and greys the extents
    fireEvent.click(screen.getByTestId('export-extent-oahu'))
    fireEvent.click(screen.getByTestId('export-file-se'))
    expect(screen.getByTestId('export-estimate')).toHaveTextContent('About 72 files.')   // 12 × 2 × 3
    fireEvent.click(screen.getByTestId('export-file-se'))
    fireEvent.click(screen.getByTestId('export-file-data_map'))
    expect(screen.getByTestId('export-file-metadata')).toBeEnabled()
    fireEvent.click(screen.getByTestId('export-file-metadata'))
    expect(screen.getByTestId('export-extent-statewide')).toBeDisabled()
    expect(screen.getByTestId('export-problems')).toHaveTextContent('Tick at least one file.')
    fireEvent.click(screen.getByTestId('export-station-partial'))
    expect(screen.getByTestId('export-estimate')).toHaveTextContent('About 12 files.')
    expect(form).not.toHaveAttribute('aria-busy', 'true')
  })

  it('downloads: posts the request body, saves the zip under HCDP\'s file name and says so', async () => {
    const urls = []
    URL.createObjectURL = vi.fn((blob) => { urls.push(blob); return 'blob:zip' })
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { urls.push(this.download) })
    render(<ExportForm originalHref="https://rainfall.ikewai.org/" />)
    await waitFor(() => expect(screen.getByTestId('export-start')).toHaveValue('2025-09'))
    fireEvent.click(screen.getByTestId('export-licence'))
    fireEvent.click(screen.getByTestId('export-extent-kauai'))
    fireEvent.change(screen.getByTestId('export-email'), { target: { value: 'ikaika@hawaii.edu' } })
    fireEvent.click(screen.getByTestId('export-download'))
    await waitFor(() => expect(screen.getByTestId('export-result')).toHaveTextContent('Downloading'))
    expect(posted('/api/export/instant')).toEqual([{ dataset: 'rainfall', period: 'month', start: '2025-09', end: '2026-08', extents: ['statewide', 'kauai'], files: ['data_map', 'metadata'], station_files: [], email: 'ikaika@hawaii.edu' }])
    expect(urls[0]).toBeInstanceOf(Blob)
    expect(urls[1]).toBe('hcdp_rainfall_month_2025-09_2026-08.zip')
    expect(screen.getByTestId('export-result')).toHaveTextContent('about 48 files')
    click.mockRestore()
  })

  it('refuses a direct download past 150 files and points to email; relays the server\'s word on failures', async () => {
    render(<ExportForm originalHref="https://rainfall.ikewai.org/" />)
    await waitFor(() => expect(screen.getByTestId('export-start')).toHaveValue('2025-09'))
    fireEvent.click(screen.getByTestId('export-licence'))
    fireEvent.click(within(screen.getByTestId('export-period')).getByLabelText('Daily'))
    await waitFor(() => expect(screen.getByTestId('export-start')).toHaveValue('2026-08-23'))
    expect(screen.getByTestId('export-end')).toHaveValue('2026-09-23')
    expect(screen.getByTestId('export-station-raw')).toBeInTheDocument()                 // daily rainfall has unfilled station data
    expect(screen.getByTestId('export-estimate')).toHaveTextContent('About 64 files.')   // 32 days × 2 files
    fireEvent.change(screen.getByTestId('export-start'), { target: { value: '2026-01-01' } })
    expect(screen.getByTestId('export-estimate')).toHaveTextContent('About 532 files. More than the 150 HCDP zips for a direct download — have the package emailed.')
    expect(screen.getByTestId('export-download')).toBeDisabled()
    expect(screen.getByTestId('export-email-send')).toBeDisabled()
    fireEvent.change(screen.getByTestId('export-email'), { target: { value: 'ikaika@hawaii' } })
    expect(screen.getByTestId('export-email-send')).toBeDisabled()
    fireEvent.change(screen.getByTestId('export-email'), { target: { value: 'ikaika@hawaii.edu' } })
    expect(screen.getByTestId('export-email-send')).toBeEnabled()
    emailMode = 429
    fireEvent.click(screen.getByTestId('export-email-send'))
    await waitFor(() => expect(screen.getByTestId('export-result')).toHaveTextContent('That is a lot of email requests'))
    emailMode = 202
    fireEvent.click(screen.getByTestId('export-email-send'))
    await waitFor(() => expect(screen.getByTestId('export-result')).toHaveTextContent('Request sent'))
    expect(screen.getByTestId('export-result')).toHaveTextContent('will email a download link to ikaika@hawaii.edu')
    const body = posted('/api/export/email').pop()
    expect(body).toEqual({ dataset: 'rainfall', period: 'day', start: '2026-01-01', end: '2026-09-23', extents: ['statewide'], files: ['data_map', 'metadata'], station_files: [], email: 'ikaika@hawaii.edu' })
    // the address is never kept anywhere but the field
    expect(Object.keys(localStorage)).toEqual([])
  })

  it('shows HCDP\'s refusal and a network failure in words, and offers the original app when the options do not load', async () => {
    render(<ExportForm originalHref="https://rainfall.ikewai.org/" />)
    await waitFor(() => expect(screen.getByTestId('export-start')).toHaveValue('2025-09'))
    fireEvent.click(screen.getByTestId('export-licence'))
    instantMode = 502
    fireEvent.click(screen.getByTestId('export-download'))
    await waitFor(() => expect(screen.getByTestId('export-result')).toHaveTextContent('HCDP returned 500 for this package'))
    instantMode = 'network'
    fireEvent.click(screen.getByTestId('export-download'))
    await waitFor(() => expect(screen.getByTestId('export-result')).toHaveTextContent('did not answer'))
    // legacy rainfall: one file, statewide only, no station data
    fireEvent.change(screen.getByTestId('export-dataset'), { target: { value: 'rainfall-legacy' } })
    expect(screen.getAllByTestId(/^export-extent-/)).toHaveLength(1)
    expect(screen.getByTestId('export-no-stations')).toHaveTextContent('no station data')
    expect(screen.queryByTestId('export-file-metadata')).toBeNull()
  })

  it('falls back to the original app when the options cannot be fetched', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }))
    render(<ExportForm originalHref="https://rainfall.ikewai.org/?datatype=rainfall" />)
    const err = await screen.findByTestId('export-form-error')
    expect(within(err).getByRole('link')).toHaveAttribute('href', 'https://rainfall.ikewai.org/?datatype=rainfall')
  })
})
