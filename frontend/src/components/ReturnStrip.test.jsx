import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation, Link } from 'react-router-dom'
import ReturnStrip from './ReturnStrip'
import { AI_INTERFACE } from '../site/handoff'

function Probe() {
  const { pathname, search, hash } = useLocation()
  return <div data-testid="probe">{pathname}{search}{hash}</div>
}
const renderAt = (entry) => render(
  <MemoryRouter initialEntries={[entry]}>
    <ReturnStrip />
    <Probe />
    <Routes>
      <Route path="/" element={<Link to="/data">go</Link>} />
      <Route path="*" element={<Link to="/data">go</Link>} />
    </Routes>
  </MemoryRouter>,
)

afterEach(() => { vi.restoreAllMocks() })

describe('ReturnStrip (?from=ai)', () => {
  it('shows the one-line strip with "Return" and strips only the from key from the address', () => {
    renderAt('/?from=ai&ask=rain#x')
    const strip = screen.getByTestId('return-strip')
    expect(strip).toHaveTextContent('You came from the AI data analysis tool · Return')
    expect(screen.queryByText(/AI tool/)).toBeNull()
    const link = screen.getByTestId('return-link')
    expect(link).toHaveTextContent('Return')
    expect(link.textContent).toBe('Return')
    expect(link).toHaveAttribute('href', AI_INTERFACE)
    expect(link).not.toHaveAttribute('target')
    expect(screen.getByTestId('probe')).toHaveTextContent('/?ask=rain#x')
    expect(screen.getByTestId('probe').textContent).not.toContain('from=ai')
  })

  it('stays hidden without the key, and does not store anything', () => {
    renderAt('/data?x=1')
    expect(screen.queryByTestId('return-strip')).toBeNull()
    expect(screen.getByTestId('probe')).toHaveTextContent('/data?x=1')
    expect(Object.keys(localStorage)).not.toContain('from')
  })

  it('✕ dismisses it', () => {
    renderAt('/data?from=ai')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('return-strip')).toBeNull()
  })

  it('disappears on the next route change', () => {
    renderAt('/?from=ai')
    expect(screen.getByTestId('return-strip')).toBeInTheDocument()
    fireEvent.click(screen.getByText('go'))
    expect(screen.getByTestId('probe')).toHaveTextContent('/data')
    expect(screen.queryByTestId('return-strip')).toBeNull()
  })

  it('Return goes back in history when the visitor came from the AI interface, else visits it', () => {
    renderAt('/?from=ai')
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    Object.defineProperty(document, 'referrer', { value: 'https://elsewhere.example/page', configurable: true })
    const link = screen.getByTestId('return-link')
    // Watch whether the strip prevented the link's default (and stop jsdom from trying to navigate).
    const seen = []
    const watch = (e) => { seen.push(e.defaultPrevented); e.preventDefault() }
    document.addEventListener('click', watch)
    fireEvent.click(link)
    expect(seen).toEqual([false])   // not prevented → the href (the AI interface) is followed
    expect(back).not.toHaveBeenCalled()
    Object.defineProperty(document, 'referrer', { value: `${AI_INTERFACE}/?x=1`, configurable: true })
    Object.defineProperty(window.history, 'length', { value: 3, configurable: true })
    fireEvent.click(link)
    expect(seen).toEqual([false, true])   // prevented: history.back() instead
    expect(back).toHaveBeenCalledTimes(1)
    document.removeEventListener('click', watch)
    Object.defineProperty(document, 'referrer', { value: '', configurable: true })
  })
})
