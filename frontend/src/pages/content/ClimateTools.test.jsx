import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ClimateTools from './ClimateTools'

const HCDP = 'https://www.hawaii.edu/climate-data-portal'

describe('ClimateTools', () => {
  it('lists every tool on the portal page with its description and link', () => {
    render(<MemoryRouter initialEntries={['/tools']}><ClimateTools /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Climate Tools' })).toBeInTheDocument()
    expect(screen.getByTestId('portal-source')).toHaveAttribute('href', `${HCDP}/climate-tools/`)
    const tools = screen.getAllByTestId('tool')
    expect(tools).toHaveLength(10)
    const card = (name) => screen.getByRole('heading', { name }).closest('[data-testid="tool"]')
    expect(within(card('CCVD Portfolios')).getByText('Generate a climate portfolio for anywhere in Hawaiʻi.')).toBeInTheDocument()
    expect(within(card('CCVD Portfolios')).getByRole('link', { name: /Open/ })).toHaveAttribute('href', 'https://ccvd.manoa.hawaii.edu/')
    expect(within(card('Hawaiʻi Groundwater Recharge Tool')).getByRole('link', { name: /Open/ })).toHaveAttribute('href', 'https://recharge.ikewai.org/#/workspace')
    expect(within(card('Hawaiʻi Monthly Climate Summary')).getByRole('link', { name: 'More on this site' })).toHaveAttribute('href', '/climate-summary')
    expect(within(card('Avian Malaria-Risk & Warning')).getByText('Coming soon')).toBeInTheDocument()
    expect(within(card('Avian Malaria-Risk & Warning')).queryByRole('link')).toBeNull()

    const resources = screen.getByRole('region', { name: 'Climate resources' })
    expect(within(resources).getByRole('link', { name: /Solar Radiation of Hawaiʻi/ })).toHaveAttribute('href', `${HCDP}/solar-radiation-atlas/`)
    expect(within(resources).getByRole('link', { name: /Guam Data Viewer/ })).toHaveAttribute('href', `${HCDP}/guam-data-viewer/`)
  })
})
