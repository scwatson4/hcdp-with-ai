import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AboutTeam, AboutHistory, AboutAcknowledgements, HowToCite } from './About'

const HCDP = 'https://www.hawaii.edu/climate-data-portal'
const renderAt = (ui, path = '/') => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)
const related = () => screen.getByRole('navigation', { name: 'Related' })

describe('AboutTeam', () => {
  it('lists every team member and contributor with their role and affiliation', () => {
    renderAt(<AboutTeam />, '/about/team')
    expect(screen.getByRole('heading', { level: 1, name: 'Team' })).toBeInTheDocument()
    expect(screen.getByTestId('portal-source')).toHaveAttribute('href', `${HCDP}/team/`)
    expect(screen.getByTestId('portal-source')).toHaveAttribute('target', '_blank')
    expect(screen.getAllByTestId('person')).toHaveLength(24)

    const ryan = screen.getByRole('heading', { name: 'Ryan Longman' }).closest('[data-testid="person"]')
    expect(within(ryan).getByText('HCDP Director')).toBeInTheDocument()
    expect(within(ryan).getByText(/Pacific Islands Climate Adaptation Science Center/)).toBeInTheDocument()
    const han = screen.getByRole('heading', { name: 'Han Tseng' }).closest('[data-testid="person"]')
    expect(within(han).getByText('Deputy Director Hawaiʻi Mesonet – Field Operations')).toBeInTheDocument()

    expect(screen.getByRole('heading', { level: 2, name: 'Contributors' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Noelani Puniwai' })).toBeInTheDocument()
  })

  it('ends with related About pages, not itself', () => {
    renderAt(<AboutTeam />, '/about/team')
    expect(within(related()).getByRole('link', { name: /HCDP History/ })).toHaveAttribute('href', '/about/history')
    expect(within(related()).getByRole('link', { name: /Rainfall Mapping History/ })).toHaveAttribute('href', `${HCDP}/rainfall-mapping-history/`)
    expect(within(related()).queryByRole('link', { name: /^Team/ })).toBeNull()
  })
})

describe('AboutHistory', () => {
  it('has the three history sections, the 2018 start and the Hurricane Lane map', () => {
    renderAt(<AboutHistory />, '/about/history')
    expect(screen.getByRole('heading', { level: 1, name: 'HCDP History' })).toBeInTheDocument()
    expect(screen.getByTestId('portal-source')).toHaveAttribute('href', `${HCDP}/2339-2/`)
    for (const h of ['The climate of Hawaiʻi', 'Climate data in Hawaiʻi', 'Evolution of the HCDP']) {
      expect(screen.getByRole('heading', { level: 2, name: h })).toBeInTheDocument()
    }
    expect(screen.getByText('2018')).toBeInTheDocument()
    expect(screen.getByText(/ʻIke Wai project/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /August 2018 rainfall on Hawaiʻi Island/ })).toHaveAttribute('href', '/viewer/rainfall/month/2018-08/hawaii')
  })
})

describe('AboutAcknowledgements', () => {
  it('quotes the funding statement and grant number exactly and lists contributors by institution', () => {
    renderAt(<AboutAcknowledgements />, '/about/acknowledgements')
    expect(screen.getByRole('heading', { level: 1, name: 'Acknowledgements' })).toBeInTheDocument()
    expect(screen.getByTestId('funding-statement')).toHaveTextContent('This work is supported by the National Science Foundation OIA #2149133 and Hawaii EPSCoR- RII Track-1: Change Hawaii: Harnessing the Data Revolution for Island Resilience')
    expect(screen.getByRole('link', { name: /NSF award 2149133/ })).toHaveAttribute('href', 'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2149133')
    expect(screen.getByText(/More than \$1\.5M for the purchase of equipment/)).toBeInTheDocument()
    expect(screen.getAllByTestId('ack-institution')).toHaveLength(27)
    const halenet = screen.getByRole('heading', { name: 'HaleNet Climate Network' }).closest('[data-testid="ack-institution"]')
    expect(within(halenet).getByText('Windward Aviation')).toBeInTheDocument()
    expect(within(halenet).getByText('Don Shearer')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'hcdp@hawaii.edu' })).toHaveAttribute('href', 'mailto:hcdp@hawaii.edu')
  })
})

describe('HowToCite', () => {
  afterEach(() => { delete navigator.clipboard })

  it('shows every product group and all 30 citations with their journal links', () => {
    renderAt(<HowToCite />, '/about/how-to-cite')
    expect(screen.getByRole('heading', { level: 1, name: 'How to Cite' })).toBeInTheDocument()
    expect(screen.getByTestId('portal-source')).toHaveAttribute('href', `${HCDP}/how-to-cite-3/`)
    for (const h of ['Hawaiʻi Climate Data Portal', 'HCDP Monthly Rainfall Maps', 'HCDP Rainfall Data', 'HCDP Daily and Monthly Temperature Maps', 'HCDP Daily and Monthly Temperature Data', 'Future Climate Projections', 'Standardized Precipitation Index', 'Trade Wind Inversion Data', 'Relevant Methods and Data Not Available on HCDP', 'Daily Rainfall and Temperature (Earlier Effort)']) {
      expect(screen.getByRole('heading', { level: 2, name: h })).toBeInTheDocument()
    }
    expect(screen.getAllByTestId('citation')).toHaveLength(30)
    expect(screen.getAllByRole('button', { name: /^Copy citation/ })).toHaveLength(30)
    expect(screen.getAllByRole('link', { name: /Journal/ }).some((a) => a.getAttribute('href') === 'https://www.mdpi.com/2306-5729/5/4/109')).toBe(true)
    expect(document.body.textContent).not.toMatch(/Soceity/)
  })

  it('copies a citation to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderAt(<HowToCite />, '/about/how-to-cite')
    const button = screen.getByRole('button', { name: 'Copy citation: HCDP Overview and Attributes' })
    fireEvent.click(button)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toMatch(/^Ryan J\. Longman, Mathew P\. Lucas.*2024\. “Hawaiʻi Climate Data Portal \(HCDP\)\.” Bulletin of the American Meteorological Society\.$/)
    await waitFor(() => expect(button).toHaveTextContent('Copied'))
  })
})
