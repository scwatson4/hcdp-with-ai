import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Landing from './Landing'
import { AssistantProvider } from '../assistant/AssistantProvider'
import { SIDEBAR } from '../site/nav'

// 17 Oct: the "What HCDP offers" cards under the hero are gone; each sidebar button carries its one-line description
// as a quiet tooltip instead. Radix tooltips need a portal and pointer events, so the tooltip module is stubbed to
// render the trigger and its content inline, as the portal tests do.
vi.mock('../components/ui/tooltip', () => ({
  TooltipProvider: ({ children }) => <>{children}</>,
  Tooltip: ({ children }) => <>{children}</>,
  TooltipTrigger: ({ children }) => <>{children}</>,
  TooltipContent: ({ children, ...p }) => <span data-testid={p['data-testid'] || 'tooltip'}>{children}</span>,
}))

const renderLanding = () => render(<MemoryRouter initialEntries={['/']}><AssistantProvider><Landing /></AssistantProvider></MemoryRouter>)

describe('the landing page without the "What HCDP offers" cards (17 Oct)', () => {
  it('shows no offers section and no tool cards', () => {
    renderLanding()
    expect(screen.queryByText('What HCDP offers')).toBeNull()
    expect(screen.queryByText('All climate tools')).toBeNull()
    expect(document.querySelector('[data-testid^="tool-"]')).toBeNull()
  })

  it('gives every sidebar button its one-line description as a tooltip', () => {
    renderLanding()
    const list = screen.getByTestId('sidebar-buttons')
    const tips = within(list).getAllByTestId('sidebar-tip').map((t) => t.textContent)
    expect(tips).toEqual(SIDEBAR.buttons.map((b) => b.tip))
    for (const b of SIDEBAR.buttons) {
      expect(b.tip.split(/\s+/).length).toBeLessThanOrEqual(20)           // one short sentence each
      expect(b.tip).not.toMatch(/—|→/)
    }
    expect(within(list).getByText('Access Data')).toBeInTheDocument()
  })
})
