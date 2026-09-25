import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AccessData, ApiAccess, Tutorials } from './DataPortal'
import { lastCompleteMonth, yesterday, dayRange, hawaiiToday } from './contentUtils'

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

describe('AccessData', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-25T12:00:00-10:00'))
  })
  afterEach(() => vi.useRealTimers())

  it('has the portal button, the datasets table and the embedded portal', () => {
    renderAt(<AccessData />, '/data')
    expect(screen.getByRole('heading', { level: 1, name: 'Access Data' })).toBeInTheDocument()
    expect(screen.getByTestId('portal-source')).toHaveAttribute('href', `${HCDP}/data-portal/`)
    const open = screen.getByRole('link', { name: /Open the HCDP data portal/ })
    expect(open).toHaveAttribute('href', `${HCDP}/data-portal/`)
    expect(open).toHaveAttribute('target', '_blank')
    expect(open).toHaveAttribute('rel', 'noopener noreferrer')

    const table = screen.getByTestId('datasets-table')
    expect(within(table).getAllByRole('row')).toHaveLength(12) // header + 11 datasets
    const names = within(table).getAllByRole('rowheader').map((th) => th.firstChild.textContent)
    expect(names).toEqual(['Rainfall', 'Legacy Rainfall', 'Maximum Temperature', 'Minimum Temperature', 'Mean Temperature', 'Relative Humidity', 'Normalized Difference Vegetation Index (NDVI)', 'Ignition Probability', 'Standardized Precipitation Index (SPI)', 'Rainfall and Temperature Projections', 'Mean Rainfall and Air Temperature'])
    expect(within(table).getAllByRole('rowheader')[2]).toHaveTextContent(/^Maximum Temperature \(°C\)/)
    expect(within(table).getByRole('link', { name: 'Map Rainfall, August 2026, Statewide in the viewer' })).toHaveAttribute('href', '/viewer/rainfall/month/2026-08/statewide')

    const frame = screen.getByTitle('HCDP data portal (Visualize and Export Data)')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('src', 'https://rainfall.ikewai.org')
    expect(frame).toHaveAttribute('loading', 'lazy')
  })

  it('builds the quick maps from today\'s date', () => {
    renderAt(<AccessData />, '/data')
    const quick = screen.getByTestId('quick-maps')
    const paths = within(quick).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(paths).toEqual(expect.arrayContaining([
      '/viewer/rainfall/month/2026-08/statewide',
      '/viewer/spi-3/month/2026-08/statewide',
      '/viewer/rainfall/day/2026-09-24/statewide',
      '/viewer/temperature-max/month/2026-08/oahu',
    ]))
    expect(within(quick).getByText('Rainfall, September 24, 2026, Statewide')).toBeInTheDocument()
  })

  it('ends with the Data Portal menu as related links', () => {
    renderAt(<AccessData />, '/data')
    const nav = screen.getByRole('navigation', { name: 'Related' })
    expect(within(nav).getByRole('link', { name: /Tutorials/ })).toHaveAttribute('href', '/data/tutorials')
    expect(within(nav).getByRole('link', { name: /HCDP \/ Hawaiʻi Mesonet API/ })).toHaveAttribute('href', '/data/api')
    expect(within(nav).queryByRole('link', { name: /^Access Data/ })).toBeNull()
  })
})

describe('ApiAccess', () => {
  it('mirrors the API page: token form, docs, base URL, endpoints and examples', () => {
    renderAt(<ApiAccess />, '/data/api')
    expect(screen.getByRole('heading', { level: 1, name: 'HCDP / Hawaiʻi Mesonet API' })).toBeInTheDocument()
    expect(screen.getByTestId('portal-source')).toHaveAttribute('href', `${HCDP}/hcdp-hawaii-mesonet-api/`)
    expect(screen.getByRole('link', { name: /Request an API token/ })).toHaveAttribute('href', expect.stringContaining('docs.google.com/forms/d/e/1FAIpQLSezcHP7aGTKsJldx0HSOBrw4hTgT9R3M-aR72BDZDbsrOJGkQ'))
    expect(screen.getByRole('link', { name: /HCDP & Hawaiʻi Mesonet API Documentation/ })).toHaveAttribute('href', 'https://hcdp.github.io/hcdp_api_docs/')
    for (const h of ['Get a token', 'Endpoints', 'Parameters', 'Documented examples', 'Quick start']) {
      expect(screen.getByRole('heading', { level: 2, name: h })).toBeInTheDocument()
    }
    expect(screen.getAllByText('https://api.hcdp.ikewai.org').length).toBeGreaterThan(0)
    for (const path of ['/raster', '/raster/timeseries', '/genzip/email', '/stations', '/mesonet/db/measurements', '/mesonet/db/stationMonitor']) {
      expect(screen.getByText(path)).toBeInTheDocument()
    }
    const code = [...document.querySelectorAll('pre code')].map((c) => c.textContent)
    expect(code).toHaveLength(2)
    expect(code.every((c) => c.includes('Authorization') && c.includes('Bearer YOUR_TOKEN'))).toBe(true)
    expect(code[1]).toMatch(/^import requests/)
    expect(document.body.textContent).not.toMatch(/API-AUTH-TOKEN/)
  })
})

describe('Tutorials', () => {
  it('lists the three portal tutorials with their links', () => {
    renderAt(<Tutorials />, '/data/tutorials')
    expect(screen.getByRole('heading', { level: 1, name: 'Tutorials' })).toBeInTheDocument()
    expect(screen.getByTestId('portal-source')).toHaveAttribute('href', `${HCDP}/tutorials/`)
    for (const t of ['Visualize Data Tutorial – Make A Map', 'Visualize Data Tutorial – Explore Station Data', 'Export Data Tutorial']) {
      expect(screen.getByRole('heading', { level: 3, name: t })).toBeInTheDocument()
    }
    expect(hrefs()).toEqual(expect.arrayContaining([
      `${HCDP}/visualize-data-tutorial/`,
      `${HCDP}/visualize-data-tutorial-explore-station-data/`,
      `${HCDP}/export-data-tutorial/`,
      'mailto:HCDP@hawaii.edu',
    ]))
  })
})
