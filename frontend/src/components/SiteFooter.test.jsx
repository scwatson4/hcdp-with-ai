import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SiteFooter, { SUPPORT_STATEMENT_A, SUPPORT_STATEMENT_B, SUPPORT_STATEMENT_C } from './SiteFooter'

describe('the portal footer', () => {
  it('has the HOW TO CITE band with the three logos, the statement in the portal\'s words, and the copyright', () => {
    render(<MemoryRouter><SiteFooter /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /how to cite/i })).toHaveAttribute('href', '/about/how-to-cite')
    expect(screen.getByAltText('National Science Foundation')).toBeInTheDocument()
    expect(screen.getByAltText('Hawaiʻi EPSCoR')).toBeInTheDocument()
    expect(screen.getByAltText(/Water Resources Research Center/)).toBeInTheDocument()
    expect(screen.getByTestId('support-statement').textContent).toBe(SUPPORT_STATEMENT_A + SUPPORT_STATEMENT_B + SUPPORT_STATEMENT_C)
    expect(screen.getByTestId('support-statement').textContent).toContain('This work is supported by the National Science Foundation OIA #2149133 and Hawaii EPSCoR- RII Track-1: Change Hawaii: Harnessing the Data Revolution for Island Resilience')
    expect(screen.getByTestId('copyright')).toHaveTextContent(`Copyright © ${new Date().getFullYear()} Hawaiʻi Climate Data Portal`)
    expect(screen.queryByText(/↗/)).toBeNull()
    expect(screen.queryByText(/Prototype/)).toBeNull()
  })
})
