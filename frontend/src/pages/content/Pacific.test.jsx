import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Pacific from './Pacific'

const HCDP = 'https://www.hawaii.edu/climate-data-portal'

describe('Pacific', () => {
  it('covers the American Samoa and Guam portals and the Pacific Portal hub', () => {
    const { container } = render(<MemoryRouter initialEntries={['/pacific']}><Pacific /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Pacific Portal' })).toBeInTheDocument()
    expect(screen.getByTestId('portal-source')).toHaveAttribute('href', `${HCDP}/pacific-portal/`)
    for (const id of ['american-samoa', 'guam', 'pacific-portal']) expect(container.querySelector(`section#${id}`)).not.toBeNull()

    const as = screen.getByRole('region', { name: 'American Samoa Climate Data Portal' })
    const asLinks = within(as).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(asLinks).toEqual(expect.arrayContaining([
      `${HCDP}/americansamoaportal/`,
      'https://maps-asgis.opendata.arcgis.com/',
      'https://americansamoa-data.sprep.org/',
      `${HCDP}/as-live-climate-data/`,
      'https://hcdp.github.io/ascdp/',
    ]))
    expect(within(as).getByText(/weather data at 5 sites and streamflow data at 4 sites/)).toBeInTheDocument()

    const guam = screen.getByRole('region', { name: 'Guam Data Viewer' })
    expect(within(guam).getByRole('link', { name: /Open the Guam Data Viewer/ })).toHaveAttribute('href', `${HCDP}/guam-data-viewer/`)
    expect(within(guam).getByText('1980–2024')).toBeInTheDocument()

    const hub = screen.getByRole('region', { name: 'Pacific Portal' })
    expect(within(hub).getByRole('link', { name: /Pacific Marine National Monuments Weather Stations/ })).toHaveAttribute('href', `${HCDP}/pacific-marine-national-monuments-weather-stations/`)
    expect(within(hub).getByRole('link', { name: /Federated States of Micronesia/ })).toHaveAttribute('href', `${HCDP}/federated-states-of-micronesia/`)
    expect(within(hub).getByRole('link', { name: /^SPREP/ })).toHaveAttribute('href', 'https://www.sprep.org/')

    expect(screen.getByRole('link', { name: 'HCDP / Hawaiʻi Mesonet API' })).toHaveAttribute('href', '/data/api')
  })
})
