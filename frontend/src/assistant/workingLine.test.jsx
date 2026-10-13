import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AssistantProvider } from './AssistantProvider'
import AssistantPanel from './AssistantPanel'

describe('the working line under the landing bar', () => {
  afterEach(() => vi.restoreAllMocks())
  it('shows a comet ring with "Working on that…" while the AI works, and no card', async () => {
    let resolve
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => url === '/api/narrate' ? Promise.reject(new Error('no narration')) : new Promise((r) => { resolve = r }))
    render(<MemoryRouter><AssistantProvider><AssistantPanel /></AssistantProvider></MemoryRouter>)
    const ta = screen.getByTestId('assistant-input')
    act(() => { fireEvent.change(ta, { target: { value: 'where is the API' } }) })
    act(() => { fireEvent.keyDown(ta, { key: 'Enter' }) })
    expect(await screen.findByTestId('landing-working')).toBeInTheDocument()
    expect(screen.getByTestId('landing-status')).toHaveTextContent('Working on that…')
    expect(document.querySelector('.hcdp-comet-ring')).not.toBeNull()
    expect(screen.queryByTestId('landing-answers')).toBeNull()
    expect(ta).toHaveValue('where is the API')
    await act(async () => { resolve({ ok: true, json: async () => ({ intent: 'info', reply: 'The API page explains it.', actions: [], alternatives: [] }) }) })
    expect(screen.queryByTestId('landing-working')).toBeNull()
    expect(screen.getByTestId('landing-answers')).toBeInTheDocument()   // a reply with nowhere to go keeps the card
  })

  it('replaces the fallback with the short narration from the model when it arrives first', async () => {
    let resolve
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => url === '/api/narrate' ? Promise.resolve({ ok: true, json: async () => ({ line: 'Pulling up the API access info' }) }) : new Promise((r) => { resolve = r }))
    render(<MemoryRouter><AssistantProvider><AssistantPanel /></AssistantProvider></MemoryRouter>)
    const ta = screen.getByTestId('assistant-input')
    act(() => { fireEvent.change(ta, { target: { value: 'where is the API' } }) })
    act(() => { fireEvent.keyDown(ta, { key: 'Enter' }) })
    expect(await screen.findByText('Pulling up the API access info')).toBeInTheDocument()
    await act(async () => { resolve({ ok: true, json: async () => ({ intent: 'info', reply: 'The API page explains it.', actions: [], alternatives: [] }) }) })
    expect(screen.queryByTestId('landing-working')).toBeNull()
  })
})
