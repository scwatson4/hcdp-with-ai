import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SiteHeader from './SiteHeader'
import { ThemeProvider } from './ThemeProvider'
import { TooltipProvider } from './ui/tooltip'
import { AI_INTERFACE } from '../site/handoff'

import { AssistantProvider } from '../assistant/AssistantProvider'

const renderHeader = (entry = '/') => render(<ThemeProvider><TooltipProvider><MemoryRouter initialEntries={[entry]}><AssistantProvider><SiteHeader /></AssistantProvider></MemoryRouter></TooltipProvider></ThemeProvider>)

describe('SiteHeader', () => {
  it('shows the portal’s menu row without an AI Data Analysis Tool entry (item 12)', () => {
    renderHeader()
    const nav = screen.getByRole('navigation', { name: 'Site' })
    const labels = [...nav.children].map((el) => el.textContent.trim())
    expect(labels).toEqual(['Home', 'About', 'Data Portal', 'Cultural Resources', 'Library', 'Research', 'Climate Tools'])
    expect(screen.queryByTestId('nav-ai-tool')).toBeNull()
    expect(within(nav).queryByText(/AI Data Analysis Tool|AI Analysis Tool/)).toBeNull()
    expect(within(nav).queryByRole('link', { name: new RegExp(AI_INTERFACE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeNull()
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

  it('keeps the phone menu to the portal’s entries too', () => {
    renderHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const mobile = screen.getByTestId('mobile-nav')
    expect(within(mobile).queryByTestId('mobile-nav-ai-tool')).toBeNull()
    expect(within(mobile).queryByText(/AI Data Analysis Tool/)).toBeNull()
    expect(within(mobile).getByText('Climate Tools')).toBeInTheDocument()
  })
})
