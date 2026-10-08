// One page-wide limiter for the viewer's history writes. Every replaceState
// writer (the camera after its 400 ms debounce, sliders on commit, selects,
// the time-series window) schedules through here, so a burst of changes
// becomes at most ONE history write per 300 ms — Mobile Safari throws after
// 100 pushState/replaceState calls in 30 s. Writes are coalesced per key
// (the last write scheduled under a key is the one that runs), the first
// write after a quiet spell runs at once, and the rest wait for the end of
// the window (trailing), so nothing a visitor did is lost.

export const WINDOW_MS = 300

const pending = new Map() // key → fn; Map keeps the order keys were first scheduled in
let timer = null
let lastWrite = -Infinity

function flush() {
  timer = null
  const fns = [...pending.values()]
  pending.clear()
  lastWrite = Date.now()
  for (const fn of fns) {
    try { fn() } catch (e) { console.error('url write failed', e) }
  }
}

/** Run `fn` (which performs one history write) now or at the end of the
 *  current 300 ms window; a later call with the same key replaces it. */
export function scheduleUrlWrite(key, fn) {
  pending.set(key, fn)
  if (timer) return
  const wait = WINDOW_MS - (Date.now() - lastWrite)
  if (wait <= 0) { flush(); return }
  timer = setTimeout(flush, wait)
}

/** Run whatever is pending right away (page unload, tests). */
export function flushUrlWrites() {
  if (!timer && !pending.size) return
  clearTimeout(timer)
  flush()
}

/** Forget pending writes and the window (tests). */
export function resetUrlWrites() {
  clearTimeout(timer)
  timer = null
  pending.clear()
  lastWrite = -Infinity
}

export const pendingUrlWrites = () => pending.size
