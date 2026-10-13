import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AssistantProvider } from './AssistantProvider'
import { AskBar, EXAMPLES, QUIET_HOLD_MS, GHOST_FADE_MS } from './AssistantPanel'

// N3 B (13 Oct): the docked bar's ghost is the quiet variant; the hero bar keeps its typewriter.
const mount = (docked) => render(<MemoryRouter initialEntries={[docked ? '/data' : '/']}><AssistantProvider><AskBar docked={docked} /></AssistantProvider></MemoryRouter>)
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const ghost = () => screen.getByTestId('composer-ghost')
const text = () => screen.getByTestId('composer-ghost-text').textContent

beforeEach(() => { vi.useFakeTimers(); window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
afterEach(() => { vi.useRealTimers() })

describe('the docked bar’s quiet ghost', () => {
  it('shows a whole example at once, no caret, holds 3.5 s, then crossfades into the next (a random order); Tab inserts it', async () => {
    mount(true)
    await tick(10)
    expect(ghost()).toHaveAttribute('data-variant', 'quiet')
    const first = text()
    expect(EXAMPLES).toContain(first)                                   // whole, not typed letter by letter
    expect(ghost().querySelector('.hcdp-caret')).toBeNull()
    expect(screen.getByTestId('composer-ghost-text').className).toContain('hcdp-ghost-in')
    await tick(QUIET_HOLD_MS - 200)
    expect(text()).toBe(first)                                           // still there through the hold
    await tick(300)
    const second = text()
    expect(EXAMPLES).toContain(second); expect(second).not.toBe(first)
    const out = screen.getByTestId('composer-ghost-outgoing')
    expect(out).toHaveTextContent(first); expect(out.className).toContain('hcdp-ghost-out')
    await tick(GHOST_FADE_MS + 20)
    expect(screen.queryByTestId('composer-ghost-outgoing')).toBeNull()
    fireEvent.keyDown(screen.getByTestId('assistant-input'), { key: 'Tab' })
    expect(screen.getByTestId('assistant-input')).toHaveValue(second)
    expect(screen.queryByTestId('composer-ghost')).toBeNull()
  })

  it('freezes while the field has focus and goes on after blur; the hero bar still types letter by letter', async () => {
    mount(true)
    await tick(10)
    const first = text()
    fireEvent.focus(screen.getByTestId('assistant-input'))
    await tick(QUIET_HOLD_MS + 2000)
    expect(text()).toBe(first)
    fireEvent.blur(screen.getByTestId('assistant-input'))
    await tick(QUIET_HOLD_MS + GHOST_FADE_MS + 400)
    expect(text()).not.toBe(first)
  })

  it('the hero bar keeps the typewriter', async () => {
    mount(false)
    await tick(400)
    expect(ghost()).toHaveAttribute('data-variant', 'typewriter')
    const partial = text()
    expect(partial.length).toBeGreaterThan(3)
    expect(EXAMPLES.some((e) => e.startsWith(partial) && e !== partial)).toBe(true)
    expect(ghost().querySelector('.hcdp-caret')).not.toBeNull()
  })
})
