import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AssistantProvider } from './AssistantProvider'
import { AskBar } from './AssistantPanel'
import { DEBOUNCE_MS } from './localMatch'

// QB-Q1 B (13 Oct): the magnifier, the × that clears, Esc's order (list first, then the text), the solid send arrow.
const mount = (docked) => render(<MemoryRouter initialEntries={[docked ? '/data' : '/']}><AssistantProvider><AskBar docked={docked} /></AssistantProvider></MemoryRouter>)
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const input = () => screen.getByTestId('assistant-input')

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ intent: 'info', reply: 'hi', actions: [], alternatives: [] }) }))); window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe.each([['hero', false], ['docked', true]])('the %s bar', (_, docked) => {
  it('has an 18 px grey magnifier at the left edge, hidden from readers', () => {
    mount(docked)
    const field = screen.getByTestId('ask-field')
    const glass = within(field).getByTestId('ask-magnifier')
    expect(glass).toHaveAttribute('aria-hidden', 'true')
    const cls = glass.getAttribute('class')
    expect(cls).toContain('h-[18px]'); expect(cls).toContain('w-[18px]'); expect(cls).toContain('text-subtle')
    expect(field.querySelector('.hcdp-ask-field').firstElementChild).toBe(glass)   // left of the field and the ghost
  })

  it('shows a round × only while there is text, 44 px on coarse pointers; it empties the field and keeps focus', async () => {
    mount(docked)
    expect(screen.queryByTestId('ask-clear')).toBeNull()
    fireEvent.change(input(), { target: { value: 'rain' } })
    const x = screen.getByTestId('ask-clear')
    expect(x).toHaveAttribute('aria-label', 'Clear')
    expect(x.className).toContain('rounded-full'); expect(x.className).toContain('h-7'); expect(x.className).toContain('[@media(pointer:coarse)]:h-11')
    fireEvent.click(x)
    expect(input()).toHaveValue('')
    expect(screen.queryByTestId('ask-clear')).toBeNull()
    expect(document.activeElement).toBe(input())
  })

  it('Esc closes the typeahead first and clears the field on the next press', async () => {
    mount(docked)
    fireEvent.change(input(), { target: { value: 'Lowe' } })
    await tick(DEBOUNCE_MS + 20)
    expect(screen.getByTestId('typeahead')).toBeInTheDocument()
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(screen.queryByTestId('typeahead')).toBeNull()
    expect(input()).toHaveValue('Lowe')
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(input()).toHaveValue('')
  })

  it('the send arrow is greyed (disabled) when empty and solid the moment there is text', () => {
    mount(docked)
    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled(); expect(send).toHaveAttribute('data-solid', 'false'); expect(send.className).toContain('disabled:opacity-40')
    fireEvent.change(input(), { target: { value: 'r' } })
    expect(send).toBeEnabled(); expect(send).toHaveAttribute('data-solid', 'true')
    fireEvent.change(input(), { target: { value: '   ' } })
    expect(send).toBeDisabled(); expect(send).toHaveAttribute('data-solid', 'false')
  })
})
