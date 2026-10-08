import { describe, it, expect } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SiteHeader from './SiteHeader'
import { ThemeProvider } from './ThemeProvider'
import { TooltipProvider } from './ui/tooltip'
import { AI_INTERFACE } from '../site/handoff'

const renderHeader = () => render(<ThemeProvider defaultTheme="light"><TooltipProvider><MemoryRouter><SiteHeader /></MemoryRouter></TooltipProvider></ThemeProvider>)

describe('SiteHeader', () => {
  it('ends the menu row with the AI Data Analysis Tool pill: external, rainbow-outlined, says it opens a new tab', () => {
    renderHeader()
    const nav = screen.getByRole('navigation', { name: 'Site' })
    const items = within(nav).getAllByRole('link').concat(within(nav).getAllByRole('button'))
    const pill = screen.getByTestId('nav-ai-tool')
    expect(pill).toHaveTextContent('AI Data Analysis Tool')
    expect(pill).toHaveAttribute('href', `${AI_INTERFACE}/?from=website`)
    expect(pill).toHaveAttribute('target', '_blank')
    expect(pill).toHaveAttribute('rel', 'noopener noreferrer')
    expect(pill.className).toContain('hcdp-rainbow-border')
    expect(pill.className).toContain('rounded-full')
    expect(pill.className).toContain('font-nav')
    expect(pill).toHaveAccessibleName(/AI Data Analysis Tool.*opens in a new tab/)
    // last in DOM order among the row's items
    expect(nav.lastElementChild).toBe(pill)
    expect(items.length).toBeGreaterThan(5)
  })

  it('offers the same door in the phone menu', () => {
    renderHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const mobile = screen.getByTestId('mobile-nav')
    const pill = within(mobile).getByTestId('mobile-nav-ai-tool')
    expect(pill).toHaveTextContent('AI Data Analysis Tool')
    expect(pill).toHaveAttribute('href', `${AI_INTERFACE}/?from=website`)
    expect(pill).toHaveAttribute('target', '_blank')
    expect(pill.className).toContain('hcdp-rainbow-border')
  })
})
