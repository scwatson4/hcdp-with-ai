import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ExtremeEvents from './ExtremeEvents'

const HCDP = 'https://www.hawaii.edu/climate-data-portal'
const renderAt = (path = '/extreme-events') => render(<MemoryRouter initialEntries={[path]}><ExtremeEvents /></MemoryRouter>)

describe('ExtremeEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-25T12:00:00-10:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('has one section per event, newest first, with the anchors the landing page uses', () => {
    const { container } = renderAt()
    expect(screen.getByRole('heading', { level: 1, name: 'Extreme Events' })).toBeInTheDocument()
    const ids = [...container.querySelectorAll('section[id]')].map((s) => s.id)
    expect(ids).toEqual(['nolo', 'lowell', 'lala', 'kona-lows'])
    const jump = screen.getByRole('navigation', { name: 'Events' })
    expect(within(jump).getByRole('link', { name: 'Hurricane Lala' })).toHaveAttribute('href', '/extreme-events#lala')
  })

  it('gives every official report, tracker and viewer link', () => {
    renderAt()
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(expect.arrayContaining([
      `${HCDP}/nolo-mesonet-viewer/`,
      `${HCDP}/hurricane-lowell/`,
      `${HCDP}/hurricane-lowell-viewer/`,
      `${HCDP}/hurricane-lala/`,
      `${HCDP}/2026-kona-low-1/`,
      `${HCDP}/2026-kona-low-2/`,
      'https://www.hawaii.edu/news/2026/09/11/hurricane-lowell/',
      'https://www.hawaii.edu/news/2026/08/20/hurricane-lala/',
      'https://www.hawaii.edu/news/2026/03/31/hawaii-mesonet-flooding-data/',
      'https://www.nhc.noaa.gov/archive/2026/LALA.shtml',
    ]))
    const lowell = screen.getByRole('region', { name: 'Hurricane Lowell' })
    expect(within(lowell).getByText('6–8 September 2026')).toBeInTheDocument()
    for (const a of within(lowell).getAllByRole('link').filter((l) => l.getAttribute('href').startsWith('http'))) {
      expect(a).toHaveAttribute('target', '_blank')
      expect(a).toHaveAttribute('rel', 'noopener noreferrer')
    }
  })

  it('opens each event in the climate viewer on its peak day and island', () => {
    renderAt()
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(expect.arrayContaining([
      '/viewer/rainfall/day/2026-09-07/kauai',
      '/viewer/rainfall/day/2026-08-15/hawaii',
      '/viewer/rainfall/day/2026-03-14/maui',
      '/viewer/rainfall/day/2026-03-20/oahu',
      '/viewer/rainfall/month/2026-03/statewide',
    ]))
    // Nolo: every full day since the tracker opened, up to yesterday (24 Sept)
    const nolo = screen.getByRole('region', { name: 'Tropical Storm Nolo' })
    const noloLinks = within(nolo).getAllByRole('link').map((a) => a.getAttribute('href')).filter((h) => h.startsWith('/viewer/'))
    expect(noloLinks).toEqual([
      '/viewer/rainfall/day/2026-09-23/hawaii', '/viewer/rainfall/day/2026-09-24/hawaii',
      '/viewer/rainfall/day/2026-09-23/statewide', '/viewer/rainfall/day/2026-09-24/statewide',
    ])
  })

  it('scrolls to the event named in the address on load', async () => {
    const seen = []
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function () { seen.push(this.id) })
    renderAt('/extreme-events#kona-lows')
    await waitFor(() => expect(seen).toContain('kona-lows'))
  })
})
