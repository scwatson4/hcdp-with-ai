import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AssistantProvider } from './AssistantProvider'
import AssistantBar from './AssistantBar'
import Landing from '../pages/Landing'
import { ThemeProvider } from '../components/ThemeProvider'
import { TooltipProvider } from '../components/ui/tooltip'

// L4 E: once the landing hero scrolls out of view the docked bar appears under the header; back in view, it goes.
describe('the landing bar docks on scroll', () => {
  let cb
  beforeEach(() => { vi.stubGlobal('IntersectionObserver', class { constructor(c) { cb = c } observe() {} disconnect() {} }) })
  afterEach(() => { vi.unstubAllGlobals() })
  it('shows the docked bar while the hero is scrolled away', async () => {
    render(
      <MemoryRouter initialEntries={['/']}><ThemeProvider><TooltipProvider><AssistantProvider>
        <AssistantBar />
        <Routes><Route path="/" element={<Landing />} /></Routes>
      </AssistantProvider></TooltipProvider></ThemeProvider></MemoryRouter>
    )
    expect(await screen.findByTestId('landing-hero')).toBeInTheDocument()
    expect(screen.queryByTestId('assistant-bar')).toBeNull()
    act(() => { cb([{ isIntersecting: false }]) })
    expect(screen.getByTestId('assistant-bar')).toBeInTheDocument()
    act(() => { cb([{ isIntersecting: true }]) })
    expect(screen.queryByTestId('assistant-bar')).toBeNull()
  })
})
