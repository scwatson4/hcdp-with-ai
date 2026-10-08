import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SiteHeader from './SiteHeader'
import { ThemeProvider } from './ThemeProvider'
import { TooltipProvider } from './ui/tooltip'
import { AI_INTERFACE } from '../site/handoff'

const renderHeader = (entry = '/') => render(<ThemeProvider><TooltipProvider><MemoryRouter initialEntries={[entry]}><SiteHeader /></MemoryRouter></TooltipProvider></ThemeProvider>)

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

  it('carries "Share this view" at the far left of the logo row and "Original HCDP version" at the far right', () => {
    renderHeader('/extreme-events/lowell')
    const row = screen.getByTestId('logo-row')
    expect(row.firstElementChild).toContainElement(screen.getByTestId('share-view'))
    expect(row.lastElementChild).toContainElement(screen.getByTestId('original-link'))
    expect(row.children[1]).toContainElement(screen.getByRole('link', { name: 'Hawaiʻi Climate Data Portal home' }))
    const share = screen.getByTestId('share-view')
    expect(share).toHaveTextContent('Share this view')
    const original = screen.getByTestId('original-link')
    expect(original).toHaveTextContent('Original HCDP version')
    expect(original.getAttribute('href')).toContain('hurricane-lowell')
    expect(original).toHaveAttribute('target', '_blank')
    expect(original.className).toContain('font-nav')
    expect(screen.queryByTestId('original-bar')).toBeNull()
  })

  it('"Share this view" opens a small panel with the link, copies it, and closes with Escape', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.resolve()) } })
    renderHeader('/mesonet?viewer=live&station=0115')
    fireEvent.click(screen.getByTestId('share-view'))
    const panel = await screen.findByTestId('share-panel')
    expect(within(panel).getByLabelText('Link to this view').value).toBe(`${window.location.origin}/mesonet?viewer=live&station=0115`)
    expect(within(panel).getByTestId('share-copy')).toBeInTheDocument()
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/mesonet?viewer=live&station=0115`))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('share-panel')).toBeNull()
  })

  it('has no theme toggle: the site is always light', () => {
    localStorage.setItem('hcdp-theme', 'dark')
    renderHeader()
    expect(screen.queryByRole('button', { name: 'Theme' })).toBeNull()
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('hcdp-theme')).toBeNull()
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
