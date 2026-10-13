import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AssistantProvider, HOLD_MS, NARRATION, THINKING_MS, WAIT_FINDING, WAIT_HANDOFF, WAIT_THINKING } from './AssistantProvider'
import AssistantPanel, { HANDOFF_SENTENCE } from './AssistantPanel'

// R6 C (13 Oct): the wait line under the landing bar is staged — "Thinking…" at once, "Finding the right page…"
// after 1.4 s without an answer, "Opening {title} in a new tab…" / "Opening the AI data analysis tool…" for one
// hold — and gpt-6-luna's narration is no longer asked for (the endpoint stays; NARRATION flips it back on).
const info = { intent: 'info', reply: 'The API page explains it.', actions: [], alternatives: [] }
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const typeAndSend = async (text) => {
  const ta = screen.getByTestId('assistant-input')
  fireEvent.change(ta, { target: { value: text } })
  fireEvent.keyDown(ta, { key: 'Enter' })
  await tick(10)
  return ta
}
const mount = () => render(<MemoryRouter><AssistantProvider><AssistantPanel /></AssistantProvider></MemoryRouter>)
let resolve, calls
beforeEach(() => {
  vi.useFakeTimers()
  calls = []
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => { calls.push(url); return new Promise((r) => { resolve = r }) })
  vi.spyOn(window, 'open').mockImplementation(() => ({ opener: 'x' }))
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('the staged wait line under the landing bar (R6 C)', () => {
  it('says "Thinking…" at once beside the comet ring, "Finding the right page…" after 1.4 s, keeps the question in the field, and ends with an info reply', async () => {
    mount()
    const ta = await typeAndSend('where is the API')
    expect(screen.getByTestId('landing-working')).toBeInTheDocument()
    expect(screen.getByTestId('landing-status')).toHaveTextContent(WAIT_THINKING)
    expect(screen.getByTestId('landing-status').className).toContain('hcdp-status-in')   // each change fades in (reduced motion: none, in CSS)
    expect(document.querySelector('.hcdp-comet-ring')).not.toBeNull()
    expect(screen.queryByTestId('landing-answers')).toBeNull()
    expect(screen.queryByText('Working on that…')).toBeNull()
    expect(screen.queryByText('Reading your question')).toBeNull()
    await tick(THINKING_MS - 100)
    expect(screen.getByTestId('landing-status')).toHaveTextContent(WAIT_THINKING)
    await tick(150)
    expect(screen.getByTestId('landing-status')).toHaveTextContent(WAIT_FINDING)
    expect(ta).toHaveValue('where is the API')   // the question stays in the field through the whole wait
    await act(async () => { resolve({ ok: true, json: async () => info }); await vi.advanceTimersByTimeAsync(10) })
    expect(screen.queryByTestId('landing-working')).toBeNull()   // info: the line ends as the card shows
    expect(screen.getByTestId('landing-answers')).toBeInTheDocument()
    expect(ta).toHaveValue('where is the API')
  })

  it('never asks /api/narrate any more (NARRATION is off)', async () => {
    expect(NARRATION).toBe(false)
    mount()
    await typeAndSend('where is the API')
    await tick(THINKING_MS + 100)
    expect(calls).toEqual(['/api/navigate'])
    await act(async () => { resolve({ ok: true, json: async () => info }); await vi.advanceTimersByTimeAsync(10) })
    expect(calls).toEqual(['/api/navigate'])
  })

  it('an answer that arrives before 1.4 s never shows "Finding the right page…"', async () => {
    mount()
    await typeAndSend('where is the API')
    await act(async () => { resolve({ ok: true, json: async () => info }); await vi.advanceTimersByTimeAsync(10) })
    expect(screen.queryByTestId('landing-working')).toBeNull()
    await tick(THINKING_MS + 100)
    expect(screen.queryByTestId('landing-working')).toBeNull()
    expect(screen.queryByText(WAIT_FINDING)).toBeNull()
  })

  it('an open action says "Opening {title} in a new tab…" (the title resolved by the server) for one hold, then the card', async () => {
    mount()
    await typeAndSend('open the rainfall atlas')
    const reply = { intent: 'navigate', reply: 'Opening the Rainfall Atlas in a new tab.', actions: [{ type: 'open', url: 'https://rainfall.geography.hawaii.edu/' }], alternatives: [], destination: { title: 'Rainfall Atlas of Hawaiʻi', url: 'https://rainfall.geography.hawaii.edu/' } }
    await act(async () => { resolve({ ok: true, json: async () => reply }); await vi.advanceTimersByTimeAsync(10) })
    expect(window.open).toHaveBeenCalledWith('https://rainfall.geography.hawaii.edu/', '_blank')
    expect(screen.getByTestId('landing-status')).toHaveTextContent('Opening Rainfall Atlas of Hawaiʻi in a new tab…')
    expect(screen.queryByTestId('landing-answers')).toBeNull()
    await tick(HOLD_MS + 20)
    expect(screen.queryByTestId('landing-working')).toBeNull()
    expect(screen.getByTestId('landing-answers')).toHaveTextContent('Opening the Rainfall Atlas in a new tab.')
  })

  it('a hand-off says "Opening the AI data analysis tool…" for one hold, then the card with its countdown', async () => {
    mount()
    await typeAndSend('total rain at Hilo during Lowell')
    const reply = { intent: 'analysis', reply: HANDOFF_SENTENCE, actions: [{ type: 'handoff', url: 'https://ai.example.org/?ask=x&from=website' }], alternatives: [] }
    await act(async () => { resolve({ ok: true, json: async () => reply }); await vi.advanceTimersByTimeAsync(10) })
    expect(screen.getByTestId('landing-status')).toHaveTextContent(WAIT_HANDOFF)
    expect(screen.queryByTestId('handoff-reply')).toBeNull()
    await tick(HOLD_MS + 20)
    expect(screen.queryByTestId('landing-working')).toBeNull()
    expect(screen.getByTestId('handoff-countdown')).toHaveTextContent('Opening in 5 s')
  })
})
