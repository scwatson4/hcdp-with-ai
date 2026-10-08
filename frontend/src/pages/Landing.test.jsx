import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Landing from './Landing'
import { AssistantProvider } from '../assistant/AssistantProvider'
import { AI_INTERFACE } from '../site/handoff'

const renderLanding = () => render(<MemoryRouter initialEntries={['/']}><AssistantProvider><Landing /></AssistantProvider></MemoryRouter>)

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) }))) })
afterEach(() => { vi.unstubAllGlobals() })

describe('Landing hero', () => {
  it('has no heading text over the map, only an sr-only h1 with the portal’s name, and keeps the bar', () => {
    renderLanding()
    expect(screen.queryByText(/What are you/)).toBeNull()
    expect(screen.queryByRole('heading', { name: /looking/ })).toBeNull()
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('Hawaiʻi Climate Data Portal')
    expect(h1.className).toContain('sr-only')
    expect(screen.getByTestId('landing-assistant')).toBeInTheDocument()
    expect(screen.getByTestId('assistant-input')).toHaveAttribute('aria-label', 'Ask AI')
    // the bar's row is the middle track of the 45/55 grid
    const hero = screen.getByTestId('landing-hero')
    expect(hero.className).toContain('grid-rows-[45fr_auto_55fr]')
    expect(screen.getByTestId('landing-assistant').parentElement.className).toContain('row-start-2')
  })
})

describe('Landing sidebar', () => {
  it('has the portal’s five coloured buttons and a sixth, white, rainbow-outlined door to the AI data analysis tool', () => {
    renderLanding()
    const list = screen.getByTestId('sidebar-buttons')
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(6)
    expect(items.map((li) => li.textContent.replace(/\s*\(opens in a new tab\)\s*$/, ''))).toEqual(['Access Data', 'Hawaiʻi Mesonet', 'Climate Summary', 'Pacific Portal', 'Extreme Events', 'AI Data Analysis Tool'])
    const ai = screen.getByTestId('sidebar-ai-tool')
    expect(ai).toHaveAttribute('href', `${AI_INTERFACE}/?from=website`)
    expect(ai).toHaveAttribute('target', '_blank')
    expect(ai).toHaveAttribute('rel', 'noopener noreferrer')
    expect(ai).toHaveAccessibleName('AI Data Analysis Tool (opens in a new tab)')
    expect(ai.className).toContain('hcdp-rainbow-border')
    expect(ai.className).toContain('text-foreground')
    expect(ai.className).not.toContain('text-white')
    expect(ai.style.backgroundColor).toBe('')
  })
})
