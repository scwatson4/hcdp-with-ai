import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AssistantProvider } from './AssistantProvider'
import { AskBar } from './AssistantPanel'

describe('the example carousel', () => {
  afterEach(() => { vi.useRealTimers() })
  it('stops where it is when the field gets focus, and goes on after blur', async () => {
    vi.useFakeTimers()
    render(<MemoryRouter><AssistantProvider><AskBar /></AssistantProvider></MemoryRouter>)
    const ghost = () => screen.getByTestId('composer-ghost').textContent
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    const before = ghost().length
    expect(before).toBeGreaterThan(3)
    fireEvent.focus(screen.getByTestId('assistant-input'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(ghost().length).toBe(before)   // frozen
    fireEvent.blur(screen.getByTestId('assistant-input'))
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(ghost().length).toBeGreaterThan(before)   // typing again
  })
  it('does not cycle while the visitor types', async () => {
    vi.useFakeTimers()
    render(<MemoryRouter><AssistantProvider><AskBar /></AssistantProvider></MemoryRouter>)
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    fireEvent.change(screen.getByTestId('assistant-input'), { target: { value: 'Show me' } })
    expect(screen.queryByTestId('composer-ghost')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(screen.queryByTestId('composer-ghost')).toBeNull()
  })
})
