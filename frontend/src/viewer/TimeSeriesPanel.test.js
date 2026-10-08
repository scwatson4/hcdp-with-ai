import { describe, it, expect, vi } from 'vitest'
import { STATS_THROTTLE_MS, dateOfEpoch, epochOf, makeThrottle, periodWindow, viewportStats, wheelZoom, zoomWindow } from './TimeSeriesPanel'

const SEC = (iso) => epochOf(iso)
const WHOLE = { start: '1990-01-01', end: '2026-09-23' }

describe('the time-series panel\'s arithmetic', () => {
  it('computes hcdp_v2\'s viewport statistics over the values in the x-window', () => {
    const xs = [SEC('2026-09-01'), SEC('2026-09-02'), SEC('2026-09-03'), SEC('2026-09-04')]
    const ys = [2, null, 4, 6]
    expect(viewportStats(xs, ys)).toEqual({ count: 3, min: 2, max: 6, mean: 4, stddev: Math.sqrt(8 / 3) })
    expect(viewportStats(xs, ys, { min: SEC('2026-09-02'), max: SEC('2026-09-03') })).toEqual({ count: 1, min: 4, max: 4, mean: 4, stddev: 0 })
    expect(viewportStats(xs, ys, { min: SEC('2026-09-02'), max: SEC('2026-09-02') })).toEqual({ count: 0, min: null, max: null, mean: null, stddev: null })
  })
  it('turns a zoomed x-range into the ?ts= window it covers, inside the record', () => {
    expect(zoomWindow(SEC('2026-09-01') + 3600, SEC('2026-09-03') + 7200, 'day', WHOLE)).toEqual({ start: '2026-09-01', end: '2026-09-03' })
    expect(zoomWindow(SEC('2026-09-03'), SEC('2026-09-01'), 'day', WHOLE)).toEqual({ start: '2026-09-01', end: '2026-09-03' })       // ends in any order
    expect(zoomWindow(SEC('1980-01-01'), SEC('2030-01-01'), 'day', WHOLE)).toBeNull()                                                // the whole record = no ts
    expect(zoomWindow(SEC('1980-01-01'), SEC('1985-01-01'), 'day', WHOLE)).toEqual({ start: '1990-01-01', end: '1990-01-01' })      // clamped, never inverted
    expect(zoomWindow(SEC('2026-03-15'), SEC('2026-08-20'), 'month', { start: '1990-01', end: '2026-08' })).toEqual({ start: '2026-03', end: '2026-08' })
    expect(zoomWindow(NaN, 1, 'day', WHOLE)).toBeNull()
    expect(dateOfEpoch(SEC('2026-09-07') + 50000, 'day')).toBe('2026-09-07')
    expect(dateOfEpoch(SEC('2026-09-07'), 'month')).toBe('2026-09')
  })
  it('knows the map\'s month for a daily series and its year for a monthly one', () => {
    expect(periodWindow('2026-09-07', 'day', WHOLE)).toEqual({ start: '2026-09-01', end: '2026-09-23' })
    expect(periodWindow('2024-02-10', 'day', WHOLE)).toEqual({ start: '2024-02-01', end: '2024-02-29' })
    expect(periodWindow('2026-08', 'month', { start: '1990-01', end: '2026-08' })).toEqual({ start: '2026-01', end: '2026-08' })
    expect(periodWindow('1990-03', 'month', { start: '1990-01', end: '2026-08' })).toEqual({ start: '1990-01', end: '1990-12' })
  })
  it('zooms about the cursor with the wheel and stops at the data\'s extent', () => {
    const extent = { min: 0, max: 1000 }
    expect(wheelZoom({ min: 0, max: 1000 }, extent, 500, -100)).toEqual({ min: 125, max: 875 })        // in: three quarters about the middle
    expect(wheelZoom({ min: 0, max: 1000 }, extent, 0, -100)).toEqual({ min: 0, max: 750 })            // about the left edge
    expect(wheelZoom({ min: 125, max: 875 }, extent, 500, 100)).toEqual({ min: 0, max: 1000 })         // out again, no further than the data
    expect(wheelZoom({ min: 0, max: 1000 }, extent, 500, 100)).toBeNull()                              // already everything: let the page scroll
    expect(wheelZoom({ min: 0, max: 1 }, extent, 0.5, -100)).toBeNull()                                // too close to zoom further
  })
  it('throttles to one run per window, keeping the latest arguments', () => {
    vi.useFakeTimers()
    const calls = []
    const throttle = makeThrottle(STATS_THROTTLE_MS)
    const fn = (x) => calls.push(x)
    throttle(fn, 1); throttle(fn, 2); throttle(fn, 3)
    expect(calls).toEqual([1])
    vi.advanceTimersByTime(STATS_THROTTLE_MS)
    expect(calls).toEqual([1, 3])
    vi.advanceTimersByTime(STATS_THROTTLE_MS + 1)
    throttle(fn, 4)
    expect(calls).toEqual([1, 3, 4])
    throttle(fn, 5); throttle.cancel()
    vi.advanceTimersByTime(STATS_THROTTLE_MS)
    expect(calls).toEqual([1, 3, 4])
    vi.useRealTimers()
  })
})
