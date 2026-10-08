import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AssistantProvider } from './AssistantProvider'
import AssistantPanel, { HANDOFF_NOTE, HANDOFF_SENTENCE } from './AssistantPanel'

// T2 pick B: the hand-off moment, with fake timers.
const HREF = 'https://ai.example.org/?ask=Compare%20September&from=website'
const analysis = () => ({ ok: true, status: 200, json: () => Promise.resolve({ intent: 'analysis', reply: HANDOFF_SENTENCE, actions: [{ type: 'handoff', url: HREF }], alternatives: [] }) })

const renderBar = (path = '/') => render(<MemoryRouter initialEntries={[path]}><AssistantProvider><AssistantPanel bar /></AssistantProvider></MemoryRouter>)

const ask = async (question = 'Compare September 2026 rainfall on Kauaʻi with the 30-year normal') => {
  const input = screen.getByTestId('assistant-input')
  fireEvent.change(input, { target: { value: question } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await act(async () => { await vi.advanceTimersByTimeAsync(30) })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(analysis())))
  vi.spyOn(window, 'open').mockImplementation(() => ({ opener: 'x' }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('the ask field', () => {
  it('wears the spectrum border through its class alone (soft at rest, full with focus — see globals.css)', () => {
    renderBar()
    const field = screen.getByTestId('ask-field')
    expect(field.className).toContain('hcdp-ask')
    expect(field.className).not.toMatch(/border-border|bg-canvas/)
  })
})

describe('the hand-off moment (analysis replies)', () => {
  it('says exactly the sentence with "here" as the external link, then the grey note and a countdown', async () => {
    renderBar()
    await ask()
    const bubble = screen.getByTestId('handoff-reply')
    expect(screen.getByTestId('handoff-sentence')).toHaveTextContent(HANDOFF_SENTENCE)
    expect(screen.getByTestId('handoff-sentence').textContent).toBe(HANDOFF_SENTENCE)
    const link = within(bubble).getByRole('link', { name: 'here' })
    expect(link).toHaveAttribute('href', HREF)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toMatch(/noopener/)
    expect(bubble).toHaveTextContent(HANDOFF_NOTE)
    expect(screen.getByTestId('handoff-countdown')).toHaveTextContent('Opening in 5 s · Stay here')
    expect(screen.queryByText('Open the analysis AI')).toBeNull()
    expect(window.open).not.toHaveBeenCalled()
  })

  it('counts down and opens the tab by itself after five seconds, once', async () => {
    renderBar()
    await ask()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByTestId('handoff-countdown')).toHaveTextContent('Opening in 4 s')
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(screen.getByTestId('handoff-countdown')).toHaveTextContent('Opening in 1 s')
    expect(window.open).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(window.open).toHaveBeenCalledTimes(1)
    expect(window.open).toHaveBeenCalledWith(HREF, '_blank')
    expect(screen.queryByTestId('handoff-countdown')).toBeNull()
    expect(screen.getByTestId('handoff-opened')).toHaveTextContent('Opened in a new tab')
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(window.open).toHaveBeenCalledTimes(1)
  })

  it('"Stay here" cancels the countdown and nothing opens', async () => {
    renderBar()
    await ask()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    fireEvent.click(screen.getByTestId('handoff-stay'))
    expect(screen.queryByTestId('handoff-countdown')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(window.open).not.toHaveBeenCalled()
    // the sentence and its link stay
    expect(screen.getByRole('link', { name: 'here' })).toHaveAttribute('href', HREF)
  })

  it('shows the blocked-tab fallback link when the browser refuses the new tab', async () => {
    window.open.mockImplementation(() => null)
    renderBar()
    await ask()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(window.open).toHaveBeenCalledTimes(1)
    const fallback = screen.getByTestId('handoff-blocked-link')
    expect(fallback).toHaveTextContent('Your browser blocked the new tab — open it here')
    expect(fallback).toHaveAttribute('href', HREF)
    expect(fallback).toHaveAttribute('target', '_blank')
  })

  it('clicking "here" by hand ends the countdown so no second tab opens', async () => {
    renderBar()
    await ask()
    fireEvent.click(screen.getByTestId('handoff-link'))
    expect(screen.queryByTestId('handoff-countdown')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(window.open).not.toHaveBeenCalled()
  })

  it('counts down only for the newest analysis reply', async () => {
    renderBar()
    await ask('first')
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    await ask('second')
    const countdowns = screen.getAllByTestId('handoff-countdown')
    expect(countdowns).toHaveLength(1)
    expect(screen.getAllByTestId('handoff-reply')).toHaveLength(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(window.open).toHaveBeenCalledTimes(1)
  })
})
