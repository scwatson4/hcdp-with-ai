import { describe, it, expect } from 'vitest'
import { AI_TOOL, NAV, SIDEBAR } from './nav'
import { AI_INTERFACE } from './handoff'

// T1 picks A + D (2026-10-08): the doors to the AI data analysis tool.
describe('the AI data analysis tool door', () => {
  it('is named exactly "AI Data Analysis Tool" and links to the AI interface with from=website', () => {
    expect(AI_TOOL.label).toBe('AI Data Analysis Tool')
    expect(AI_TOOL.href).toBe(`${AI_INTERFACE}/?from=website`)
  })

  it('is the sixth sidebar button on the landing page, external, not a solid portal colour', () => {
    expect(SIDEBAR.buttons).toHaveLength(6)
    const sixth = SIDEBAR.buttons[5]
    expect(sixth).toMatchObject({ label: 'AI Data Analysis Tool', href: AI_TOOL.href, ai: true })
    expect(sixth.color).toBeUndefined()
    expect(sixth.to).toBeUndefined()
    expect(SIDEBAR.buttons.slice(0, 5).map((b) => b.label)).toEqual(['Access Data', 'Hawaiʻi Mesonet', 'Climate Summary', 'Pacific Portal', 'Extreme Events'])
  })

  it('is not in the header menu (item 12): the row is the portal’s own seven entries', () => {
    expect(NAV.map((n) => n.label)).toEqual(['Home', 'About', 'Data Portal', 'Cultural Resources', 'Library', 'Research', 'Climate Tools'])
    expect(NAV.some((n) => n.ai || /AI Data Analysis/.test(n.label))).toBe(false)
  })
})
