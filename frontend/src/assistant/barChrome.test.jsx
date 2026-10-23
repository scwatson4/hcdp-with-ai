import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AssistantProvider } from './AssistantProvider'
import { AskBar } from './AssistantPanel'
import { DEBOUNCE_MS } from './localMatch'

// QB-Q1 B (13 Oct): the × that clears, Esc's order (list first, then the text), the solid send arrow; no magnifier since 23 Oct 2026.
const mount = (docked) => render(<MemoryRouter initialEntries={[docked ? '/data' : '/']}><AssistantProvider><AskBar docked={docked} /></AssistantProvider></MemoryRouter>)
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const input = () => screen.getByTestId('assistant-input')

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ intent: 'info', reply: 'hi', actions: [], alternatives: [] }) }))); window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe.each([['hero', false], ['docked', true]])('the %s bar', (_, docked) => {
  it('has no magnifier: the field is the first thing in the pill (user, 23 Oct 2026)', () => {
    mount(docked)
    const field = screen.getByTestId('ask-field')
    expect(within(field).queryByTestId('ask-magnifier')).toBeNull()
    expect(field.querySelector('.hcdp-ask-field').firstElementChild).toBe(input())   // the textarea leads; the up arrow is the only mark
  })

  it('a finger slide to the right across the box takes the suggestion (phones have no Tab); no chip', () => {
    mount(docked)
    expect(screen.queryByTestId('ask-use-ghost')).toBeNull()
    if (docked || !screen.queryByTestId('composer-ghost-text')) return      // the docked bar on a phone opens the sheet instead
    const zone = screen.getByTestId('ask-swipe')
    fireEvent.touchStart(zone, { touches: [{ clientX: 30, clientY: 20 }] })
    fireEvent.touchMove(zone, { touches: [{ clientX: 60, clientY: 22 }] })
    fireEvent.touchMove(zone, { touches: [{ clientX: 110, clientY: 24 }] })
    fireEvent.touchEnd(zone, { changedTouches: [{ clientX: 110, clientY: 24 }] })
    expect(input().value.length).toBeGreaterThan(0)
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
