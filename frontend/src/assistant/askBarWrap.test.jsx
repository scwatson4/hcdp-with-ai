import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AssistantProvider } from './AssistantProvider'
import { AskBar, MAX_LINES } from './AssistantPanel'

function mount() {
  return render(<MemoryRouter><AssistantProvider><AskBar /></AssistantProvider></MemoryRouter>)
}

describe('the ask field wraps long questions', () => {
  const orig = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'scrollHeight')
  afterEach(() => { if (orig) Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', orig); else delete HTMLTextAreaElement.prototype.scrollHeight })

  it('is a textarea that starts at one line', () => {
    mount()
    const ta = screen.getByTestId('assistant-input')
    expect(ta.tagName).toBe('TEXTAREA')
    expect(screen.getByTestId('ask-field').dataset.lines).toBe('1')
  })

  it('grows with the text and stops at three lines, scrolling beyond', () => {
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get() { return (this.value.length > 200 ? 5 : this.value.length > 60 ? 2 : 1) * 24 } })
    mount()
    const ta = screen.getByTestId('assistant-input')
    act(() => { fireEvent.change(ta, { target: { value: 'x'.repeat(80) } }) })
    expect(screen.getByTestId('ask-field').dataset.lines).toBe('2')
    act(() => { fireEvent.change(ta, { target: { value: 'y'.repeat(300) } }) })
    expect(screen.getByTestId('ask-field').dataset.lines).toBe(String(MAX_LINES))
    expect(ta.className).toContain('overflow-y-auto')
    expect(screen.getByTestId('ask-field').className).toContain('rounded-3xl')
  })

  it('Enter sends and Shift+Enter does not', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ intent: 'info', reply: 'hi', actions: [], alternatives: [] }) })
    mount()
    const ta = screen.getByTestId('assistant-input')
    act(() => { fireEvent.change(ta, { target: { value: 'hello' } }) })
    const navigates = () => fetchSpy.mock.calls.filter((c) => c[0] === '/api/navigate').length
    act(() => { fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true }) })
    expect(navigates()).toBe(0)
    act(() => { fireEvent.keyDown(ta, { key: 'Enter' }) })
    expect(navigates()).toBe(1)
    fetchSpy.mockRestore()
  })
})
