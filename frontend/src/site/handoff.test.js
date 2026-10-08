import { describe, it, expect } from 'vitest'
import { AI_INTERFACE, aiInterfaceHost, handoffUrl } from './handoff'

// The hand-off contract shared with the AI interface: ask + ctx + from (see CONTRACT.md).
describe('handoffUrl', () => {
  it('always says where the visitor came from, even with nothing to ask', () => {
    expect(handoffUrl({})).toBe(`${AI_INTERFACE}/?from=website`)
    expect(handoffUrl()).toBe(`${AI_INTERFACE}/?from=website`)
  })

  it('carries the question as typed, URL-encoded, at most 500 characters', () => {
    expect(handoffUrl({ question: 'Compare September 2026 rainfall on Kauaʻi with the 30-year normal' }))
      .toBe(`${AI_INTERFACE}/?ask=Compare%20September%202026%20rainfall%20on%20Kaua%CA%BBi%20with%20the%2030-year%20normal&from=website`)
    const long = 'x'.repeat(600)
    expect(new URL(handoffUrl({ question: long })).searchParams.get('ask')).toHaveLength(500)
    expect(handoffUrl({ question: '   ' })).toBe(`${AI_INTERFACE}/?from=website`)
  })

  it('adds ctx=viewer:<canonical path> only for a viewer address, without its query', () => {
    expect(handoffUrl({ question: 'q', viewerPath: '/viewer/rainfall/day/2026-09-07/kauai?units=in&layers=stations' }))
      .toBe(`${AI_INTERFACE}/?ask=q&ctx=viewer%3A%2Fviewer%2Frainfall%2Fday%2F2026-09-07%2Fkauai&from=website`)
    expect(handoffUrl({ viewerPath: '/viewer/spi-3/month/2026-08/statewide' })).toBe(`${AI_INTERFACE}/?ctx=viewer%3A%2Fviewer%2Fspi-3%2Fmonth%2F2026-08%2Fstatewide&from=website`)
    expect(handoffUrl({ question: 'q', viewerPath: '/data' })).toBe(`${AI_INTERFACE}/?ask=q&from=website`)
    expect(handoffUrl({ question: 'q', viewerPath: null })).toBe(`${AI_INTERFACE}/?ask=q&from=website`)
  })

  it('knows the AI interface host and has no trailing slash on the base', () => {
    expect(AI_INTERFACE.endsWith('/')).toBe(false)
    expect(aiInterfaceHost()).toBe(new URL(AI_INTERFACE).host)
  })
})
