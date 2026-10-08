import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WINDOW_MS, flushUrlWrites, pendingUrlWrites, resetUrlWrites, scheduleUrlWrite } from './urlWrites'

beforeEach(() => { vi.useFakeTimers(); resetUrlWrites() })
afterEach(() => { vi.useRealTimers() })

describe('scheduleUrlWrite', () => {
  it('runs the first write at once and holds the rest to one per 300 ms', () => {
    const writes = []
    // 200 moveends within one second (every 5 ms), each asking for a write.
    for (let i = 0; i < 200; i++) {
      scheduleUrlWrite('camera', () => writes.push(i))
      vi.advanceTimersByTime(5)
    }
    // Within that second: one immediate write, then one per window.
    expect(writes.length).toBeLessThanOrEqual(4)
    expect(writes[0]).toBe(0)
    // The trailing write carries the LAST state, never an intermediate one.
    vi.advanceTimersByTime(WINDOW_MS)
    expect(writes[writes.length - 1]).toBe(199)
    expect(writes.length).toBeLessThanOrEqual(5)
    expect(pendingUrlWrites()).toBe(0)
  })

  it('coalesces per key: the latest write for a key wins, other keys keep theirs', () => {
    const ran = []
    scheduleUrlWrite('camera', () => ran.push('camera-1')) // immediate
    scheduleUrlWrite('camera', () => ran.push('camera-2'))
    scheduleUrlWrite('opacity', () => ran.push('opacity-1'))
    scheduleUrlWrite('camera', () => ran.push('camera-3'))
    expect(ran).toEqual(['camera-1'])
    expect(pendingUrlWrites()).toBe(2)
    vi.advanceTimersByTime(WINDOW_MS)
    expect(ran).toEqual(['camera-1', 'camera-3', 'opacity-1'])
  })

  it('writes at once again after a quiet window', () => {
    const ran = []
    scheduleUrlWrite('ramp', () => ran.push(1))
    vi.advanceTimersByTime(WINDOW_MS + 1)
    scheduleUrlWrite('ramp', () => ran.push(2))
    expect(ran).toEqual([1, 2])
  })

  it('flushUrlWrites runs what is pending right away', () => {
    const ran = []
    scheduleUrlWrite('a', () => ran.push('a'))
    scheduleUrlWrite('b', () => ran.push('b'))
    expect(ran).toEqual(['a'])
    flushUrlWrites()
    expect(ran).toEqual(['a', 'b'])
    expect(pendingUrlWrites()).toBe(0)
  })

  it('a failing write does not stop the others', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ran = []
    scheduleUrlWrite('x', () => ran.push('x'))
    scheduleUrlWrite('bad', () => { throw new Error('boom') })
    scheduleUrlWrite('y', () => ran.push('y'))
    vi.advanceTimersByTime(WINDOW_MS)
    expect(ran).toEqual(['x', 'y'])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
