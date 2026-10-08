import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ClimateTools from './ClimateTools'
import { AI_INTERFACE } from '../../site/handoff'

const HCDP = 'https://www.hawaii.edu/climate-data-portal'

// The portal's tiles, in its order: name, link, caption.
const PORTAL_TILES = [
  ['Rainfall Atlas of Hawaiʻi', 'https://rainfall.geography.hawaii.edu/', 'Visualize rainfall across the state.'],
  ['CCVD Portfolios', 'https://ccvd.manoa.hawaii.edu/', 'Generate a climate portfolio for anywhere in Hawaiʻi.'],
  ['Hawaiʻi Rangeland Information Portal (H-RIP)', 'http://hrip.manoa.hawaii.edu/', 'View drought and rainfall conditions for ranches in Hawaiʻi.'],
  ['Hawaiʻi Groundwater Recharge Tool', 'https://recharge.ikewai.org/#/workspace', 'Explore how changes in land cover and climate can affect groundwater recharge.'],
  ['Hawaiʻi Monthly Climate Summary', `${HCDP}/climate-summary/#/`, 'Receive monthly climate summaries for areas across the state.'],
  ['State of Hawaiʻi Sea Level Rise Viewer', 'https://www.pacioos.hawaii.edu/shoreline/slr-hawaii/', 'Visualize potential sea level rise impacts in Hawaiʻi.'],
  ['American Samoa Data Viewer and Download', 'https://hcdp.github.io/ascdp/', 'Visualize and download climate data for American Samoa.'],
  ['SOEST Coastal Viewer', 'https://www.soest.hawaii.edu/crc/slr-viewer/', 'View coastal data for Hawaiʻi.'],
  ['Climate of Hawaiʻi', `${HCDP}/climate-atlas/`, 'Download mean annual climate maps for Hawaiʻi.'],
]
const SOON = 'Avian Malaria-Risk & Warning'
// Ours (T1 D): the door to the AI data analysis tool, between the portal's nine live tiles and its coming-soon one.
const AI_TILE = ['AI Data Analysis Tool', `${AI_INTERFACE}/?from=website`, 'ask questions of the data']
const ALL_LIVE = [...PORTAL_TILES, AI_TILE]

const renderPage = () => render(<MemoryRouter initialEntries={['/tools']}><ClimateTools /></MemoryRouter>)

describe('ClimateTools', () => {
  it('keeps the page frame: title, portal source link, image credit and related links', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Climate Tools' })).toBeInTheDocument()
    expect(screen.getByTestId('image-credit')).toHaveTextContent('Images: Hawaiʻi Climate Data Portal')
    const related = screen.getByRole('navigation', { name: 'Related' })
    expect(within(related).getByRole('link', { name: /Climate Summary/ })).toHaveAttribute('href', '/climate-summary')
  })

  it('shows the portal’s ten picture tiles in the portal’s order, plus our AI door before the coming-soon one', () => {
    renderPage()
    const grid = screen.getByRole('list', { name: 'Climate tools' })
    const tiles = within(grid).getAllByTestId('tool')
    expect(tiles).toHaveLength(11)
    const names = tiles.map((t) => within(t).getByRole('heading', { level: 2 }).textContent)
    expect(names).toEqual([...ALL_LIVE.map(([name]) => name), `${SOON} (Coming soon)`])
  })

  it('gives the AI Data Analysis Tool tile its own picture, caption, rainbow outline and an external link', () => {
    renderPage()
    const tile = screen.getAllByTestId('tool').find((t) => t.getAttribute('data-ai') === 'true')
    expect(tile).toBeTruthy()
    expect(within(tile).getByRole('heading', { level: 2 })).toHaveTextContent('AI Data Analysis Tool')
    expect(tile).toHaveTextContent('ask questions of the data')
    expect(within(tile).getByRole('img')).toHaveAttribute('src', '/tiles/ai-data-analysis.jpg')
    expect(within(tile).getByRole('img')).toHaveAttribute('alt', 'AI Data Analysis Tool')
    expect(tile.className).toContain('hcdp-rainbow-border')
    expect(tile).toHaveAttribute('href', `${AI_INTERFACE}/?from=website`)
    expect(tile).toHaveAttribute('target', '_blank')
    expect(tile.closest('li')).toHaveAttribute('id', 'tool-ai-data-analysis')
  })

  it('gives every tile a picture with alt text, reserved size and lazy loading', () => {
    renderPage()
    const tiles = screen.getAllByTestId('tool')
    tiles.forEach((tile, i) => {
      const img = within(tile).getByRole('img')
      const name = i < ALL_LIVE.length ? ALL_LIVE[i][0] : SOON
      expect(img).toHaveAttribute('alt', name)
      expect(img.getAttribute('src')).toMatch(/^\/(tools|tiles)\/[a-z-]+\.(png|jpg)$/)
      expect(img).toHaveAttribute('loading', 'lazy')
      expect(Number(img.getAttribute('width'))).toBeGreaterThan(0)
      expect(Number(img.getAttribute('height'))).toBeGreaterThan(0)
    })
  })

  it('makes each live tile one link to the portal’s target, opening in a new tab', () => {
    renderPage()
    const grid = screen.getByRole('list', { name: 'Climate tools' })
    const links = within(grid).getAllByRole('link')
    expect(links).toHaveLength(ALL_LIVE.length)
    ALL_LIVE.forEach(([name, href, caption], i) => {
      const link = links[i]
      expect(link).toHaveAttribute('href', href)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link.getAttribute('rel')).toMatch(/noopener/)
      expect(link).toHaveAccessibleName(`${name} (opens in a new tab)`)
      expect(link).toHaveAccessibleDescription(caption)
      expect(within(link).getByText(caption)).toBeInTheDocument()
      expect(link).toHaveAttribute('data-testid', 'tool')
    })
    expect(screen.getByRole('link', { name: /CCVD Portfolios/ })).toHaveAttribute('href', 'https://ccvd.manoa.hawaii.edu/')
  })

  it('shows the coming-soon tile without a link', () => {
    renderPage()
    const soon = screen.getByRole('heading', { name: `${SOON} (Coming soon)` }).closest('[data-testid="tool"]')
    expect(soon.tagName).toBe('DIV')
    expect(within(soon).queryByRole('link')).toBeNull()
  })

})
