import { describe, it, expect } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Mesonet from './Mesonet'

const HCDP = 'https://www.hawaii.edu/climate-data-portal'
const renderPage = () => render(<MemoryRouter initialEntries={['/mesonet']}><Mesonet /></MemoryRouter>)

describe('Mesonet', () => {
  it('describes the network, its station count and what each station measures', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Hawaiʻi Mesonet' })).toBeInTheDocument()
    expect(screen.getByText(/approximately 100 telemetered stations/)).toBeInTheDocument()
    expect(screen.getByText('stations active (September 2026)')).toBeInTheDocument()
    for (const h of ['What is the Hawaiʻi Mesonet and why is it needed?', 'Do we need so many stations?', 'What does each station measure?', 'Who needs the data?', 'Who pays for it?']) {
      expect(screen.getByRole('heading', { level: 2, name: h })).toBeInTheDocument()
    }
    const measured = screen.getByRole('list', { name: 'Measurements' })
    expect(within(measured).getAllByRole('listitem')).toHaveLength(12)
    expect(within(measured).getByText('Soil moisture at three depths')).toBeInTheDocument()
  })

  it('embeds the live viewers in tabs, one at a time, with portal fallbacks', () => {
    renderPage()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    let frames = document.querySelectorAll('iframe')
    expect(frames).toHaveLength(1)
    expect(frames[0]).toHaveAttribute('title', 'Hawaiʻi Mesonet Live Data Access')
    expect(frames[0]).toHaveAttribute('src', 'https://cherryleh.github.io/mesonet/?source=iframe#/dashboard')

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Tropical Storm Nolo' }))
    frames = document.querySelectorAll('iframe')
    expect(frames).toHaveLength(1)
    expect(frames[0]).toHaveAttribute('src', 'https://cherryleh.github.io/climate-summary/#/nolo-viewer')
    expect(screen.getAllByRole('link', { name: /Open it full screen/ })[0]).toHaveAttribute('href', `${HCDP}/nolo-mesonet-viewer/`)

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'hawaiimesonet.app' }))
    expect(document.querySelector('iframe')).toHaveAttribute('src', 'https://hawaiimesonet.app/')
  })

  it('links to Live Data Access and to the API page', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /^Live Data Access/ })).toHaveAttribute('href', `${HCDP}/hawaii-mesonet-data/#/`)
    expect(screen.getByRole('link', { name: 'Mesonet data by API' })).toHaveAttribute('href', '/data/api')
    const nav = screen.getByRole('navigation', { name: 'Related' })
    expect(within(nav).getByRole('link', { name: /Extreme Events/ })).toHaveAttribute('href', '/extreme-events')
  })
})
