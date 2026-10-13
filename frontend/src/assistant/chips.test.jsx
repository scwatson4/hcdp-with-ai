import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom'
import { AssistantProvider } from './AssistantProvider'
import AssistantPanel, { CHIPS } from './AssistantPanel'
import AssistantBar from './AssistantBar'
import Landing from '../pages/Landing'
import SiteHeader from '../components/SiteHeader'
import { ThemeProvider } from '../components/ThemeProvider'
import { TooltipProvider } from '../components/ui/tooltip'

// QB-Q5 B (13 Oct): the four chips under the hero bar.
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
let calls
beforeEach(() => {
  vi.useFakeTimers(); calls = []
  vi.stubGlobal('fetch', vi.fn((url, init) => { calls.push({ url, body: init?.body ? JSON.parse(init.body) : null }); return Promise.resolve({ ok: true, json: async () => (url === '/api/navigate' ? { intent: 'info', reply: 'ok', actions: [], alternatives: [] } : { items: [] }) }) }))
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.requestAnimationFrame = (cb) => { cb(); return 1 }
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const mountLanding = () => render(<MemoryRouter initialEntries={['/']}><AssistantProvider><AssistantPanel /></AssistantProvider></MemoryRouter>)

describe('the quick-start chips', () => {
  it('render under the hero bar in the portal chip style: four, white with a 1 px border, 44 px on coarse pointers, centred and wrapping', () => {
    mountLanding()
    const list = screen.getByTestId('ask-chips')
    expect(list.className).toContain('flex-wrap'); expect(list.className).toContain('justify-center')
    const chips = within(list).getAllByTestId('ask-chip')
    expect(chips.map((c) => c.textContent)).toEqual(['Rainfall maps', 'Live stations', 'Storm reports', 'Climate summary'])
    chips.forEach((c) => { expect(c.className).toContain('bg-card'); expect(c.className).toContain('border'); expect(c.className).toContain('rounded-full'); expect(c.className).toContain('[@media(pointer:coarse)]:h-11') })
    expect(Boolean(screen.getByTestId('ask-field').compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)   // under the bar
    expect(CHIPS.map((c) => c.template)).toEqual(['Rainfall map for island on date', 'Live station data for place', 'The storm report for storm', 'Climate summary for month'])
  })

  it('the carousel keeps cycling until a chip is clicked; the click stops it and puts the template in the field with its first blank selected', async () => {
    mountLanding()
    await tick(400)
    expect(screen.getByTestId('composer-ghost')).toBeInTheDocument()
    await tick(1000)
    expect(screen.getByTestId('composer-ghost')).toBeInTheDocument()       // still cycling
    fireEvent.click(screen.getAllByTestId('ask-chip')[0])
    await tick(20)
    const ta = screen.getByTestId('assistant-input')
    expect(ta).toHaveValue('Rainfall map for island on date')
    expect(screen.queryByTestId('composer-ghost')).toBeNull()               // stopped, as typing does
    expect(document.activeElement).toBe(ta)
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe('island')   // the first blank is selected: typing replaces it
    await tick(3000)
    expect(screen.queryByTestId('composer-ghost')).toBeNull()
    fireEvent.click(screen.getAllByTestId('ask-chip')[3])
    await tick(20)
    expect(ta).toHaveValue('Climate summary for month')
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe('month')
  })

  it('Enter with a blank still present sends the sentence as it is', async () => {
    mountLanding()
    fireEvent.click(screen.getAllByTestId('ask-chip')[2])
    await tick(20)
    const ta = screen.getByTestId('assistant-input')
    expect(ta).toHaveValue('The storm report for storm')
    fireEvent.keyDown(ta, { key: 'Enter' })
    await tick(30)
    const nav = calls.filter((c) => c.url === '/api/navigate')
    expect(nav).toHaveLength(1)
    expect(nav[0].body.message).toBe('The storm report for storm')
  })

  it('does not show on inner pages (the docked bar has the follow-ups)', () => {
    render(
      <ThemeProvider><TooltipProvider><MemoryRouter initialEntries={['/data']}><AssistantProvider>
        <Routes><Route element={<><SiteHeader /><AssistantBar /><Outlet /></>}><Route index element={<Landing />} /><Route path="*" element={<div>page</div>} /></Route></Routes>
      </AssistantProvider></MemoryRouter></TooltipProvider></ThemeProvider>,
    )
    expect(screen.getByTestId('assistant-bar')).toBeInTheDocument()
    expect(screen.queryByTestId('ask-chips')).toBeNull()
  })
})
