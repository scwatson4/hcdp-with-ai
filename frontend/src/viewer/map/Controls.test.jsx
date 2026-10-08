import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnalyzeWithAI, analyzeQuestion } from './Controls'
import { AI_INTERFACE } from '../../site/handoff'

const kauai = { dataset: 'rainfall', period: 'day', date: '2026-09-07', extent: 'kauai', opts: {} }

describe('AnalyzeWithAI (the rail’s door to the AI data analysis tool)', () => {
  it('asks about this map, carries the canonical view as ctx and says it came from the website', () => {
    render(<AnalyzeWithAI v={kauai} path="/viewer/rainfall/day/2026-09-07/kauai?units=in&layers=stations" />)
    const a = screen.getByTestId('analyze-ai')
    expect(a).toHaveTextContent('Analyze this map with AI')
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', 'noopener noreferrer')
    expect(a).toHaveAccessibleName(/Analyze this map with AI.*opens in a new tab/)
    expect(a.className).toContain('hcdp-rainbow-border')
    expect(a).toHaveAttribute('href', `${AI_INTERFACE}/?ask=${encodeURIComponent('Analyze the Rainfall map for 2026-09-07 (Kauaʻi)')}&ctx=viewer%3A%2Fviewer%2Frainfall%2Fday%2F2026-09-07%2Fkauai&from=website`)
  })

  it('follows the view: a new dataset, date or island changes the question and the ctx', () => {
    const { rerender } = render(<AnalyzeWithAI v={kauai} path="/viewer/rainfall/day/2026-09-07/kauai" />)
    const first = screen.getByTestId('analyze-ai').getAttribute('href')
    const spi = { dataset: 'spi-3', period: 'month', date: '2026-08', extent: 'statewide', opts: {} }
    rerender(<AnalyzeWithAI v={spi} path="/viewer/spi-3/month/2026-08/statewide" />)
    const second = screen.getByTestId('analyze-ai').getAttribute('href')
    expect(second).not.toBe(first)
    expect(second).toContain('ctx=viewer%3A%2Fviewer%2Fspi-3%2Fmonth%2F2026-08%2Fstatewide')
    expect(decodeURIComponent(second)).toContain('Analyze the Drought index (SPI, 3 months) map for 2026-08 (Statewide)')
    expect(analyzeQuestion(kauai)).toBe('Analyze the Rainfall map for 2026-09-07 (Kauaʻi)')
  })
})
