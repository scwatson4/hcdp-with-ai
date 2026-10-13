import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import BackToTop from './BackToTop'

describe('back to top', () => {
  it('appears after the page scrolls and scrolls back to the top', () => {
    window.scrollTo = vi.fn()
    render(<BackToTop />)
    const b = screen.getByTestId('back-to-top')
    expect(b.className).toContain('opacity-0')
    act(() => { Object.defineProperty(window, 'scrollY', { value: 800, configurable: true }); window.dispatchEvent(new Event('scroll')) })
    expect(b.className).toContain('opacity-100')
    fireEvent.click(b)
    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
  })
})
