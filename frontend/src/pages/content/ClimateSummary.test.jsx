import { describe, it, expect } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ClimateSummary from './ClimateSummary'

const HCDP = 'https://www.hawaii.edu/climate-data-portal'
const renderPage = () => render(<MemoryRouter initialEntries={['/climate-summary']}><ClimateSummary /></MemoryRouter>)

describe('ClimateSummary', () => {
  it('explains the monthly summary, its statistics and how ranks work', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Monthly Climate Summary' })).toBeInTheDocument()
    expect(screen.getByTestId('portal-source')).toHaveAttribute('href', `${HCDP}/climate-summary/`)
    expect(screen.getByRole('heading', { level: 2, name: 'How the numbers and ranks work' })).toBeInTheDocument()
    expect(screen.getByText(/2nd Wettest out of 30 years/)).toBeInTheDocument()
    expect(screen.getByText(/Rank 1 is the most extreme/)).toBeInTheDocument()
    expect(screen.getByText('Exceptional Drought')).toBeInTheDocument()
    expect(screen.getByText(/Reports arrive around the 1st of each month/)).toBeInTheDocument()
  })

  it('lists the latest reports and the Lowell, Nolo and Lala trackers', () => {
    renderPage()
    const reports = screen.getByRole('region', { name: 'Latest reports' })
    expect(within(reports).getByRole('heading', { name: '2025 Hawaiʻi Annual Climate Report' })).toBeInTheDocument()
    expect(within(reports).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(expect.arrayContaining([
      `${HCDP}/climate-summary/#/climate-summary-2025`,
      `${HCDP}/hurricane-lowell/`,
      `${HCDP}/hurricane-lala/`,
    ]))
    const trackers = screen.getByRole('region', { name: 'Storm trackers' })
    const links = within(trackers).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toEqual(expect.arrayContaining([
      `${HCDP}/nolo-mesonet-viewer/`, `${HCDP}/hurricane-lowell-viewer/`, `${HCDP}/hurricane-lala/`,
      '/extreme-events#nolo', '/extreme-events#lowell', '/extreme-events#lala',
    ]))
  })

  it('loads the embedded dashboard only when asked', () => {
    renderPage()
    expect(document.querySelector('iframe')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Load it here' }))
    const frame = screen.getByTitle('Hawaiʻi Monthly Climate Summary')
    expect(frame).toHaveAttribute('src', 'https://cherryleh.github.io/climate-summary/#/')
  })
})
