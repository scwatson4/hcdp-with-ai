// Parsed rasters, cached for the life of the page and keyed by the request
// URL (/api/raster?dataset=…&period=…&date=…&extent=…), so stepping back to
// a date already seen, or flipping ramp/units (which never refetch), is
// instant. Least-recently-used entries go first once the cache holds more
// than MAX_ENTRIES maps or MAX_BYTES of GeoTIFF (a statewide grid is ~14 MB).

import { useEffect, useState } from 'react'
import { hasData } from './ramps'

const MAX_ENTRIES = 12
const MAX_BYTES = 80 * 1024 * 1024
const cache = new Map() // url → { georaster, empty, bytes }

export class RasterNotFound extends Error {
  constructor(detail) { super(detail || 'no map for that date'); this.name = 'RasterNotFound' }
}
export class RasterHttpError extends Error {
  constructor(status, detail) { super(detail || `HTTP ${status}`); this.name = 'RasterHttpError'; this.status = status }
}
export class RasterNetworkError extends Error {
  constructor(message) { super(message || 'network error'); this.name = 'RasterNetworkError' }
}

function abortError() {
  try { return new DOMException('aborted', 'AbortError') } catch { const e = new Error('aborted'); e.name = 'AbortError'; return e }
}

async function readDetail(resp) {
  try {
    const body = await resp.json()
    return typeof body?.detail === 'string' ? body.detail : null
  } catch { return null }
}

/** The cached entry for a URL (and mark it recently used), or null. */
export function cachedRaster(url) {
  const hit = cache.get(url)
  if (!hit) return null
  cache.delete(url)
  cache.set(url, hit)
  return hit
}

function remember(url, entry) {
  cache.set(url, entry)
  let bytes = 0
  for (const e of cache.values()) bytes += e.bytes || 0
  for (const key of cache.keys()) {
    if (cache.size <= 1 || (cache.size <= MAX_ENTRIES && bytes <= MAX_BYTES)) break
    bytes -= cache.get(key).bytes || 0
    cache.delete(key)
  }
}

/** For tests. */
export function clearRasterCache() { cache.clear(); inflight.clear() }

/**
 * Fetch and parse one GeoTIFF. Resolves {georaster, empty}; `empty` is true
 * for HCDP's all-nodata answer to a date it has no map for. Rejects with
 * RasterNotFound (404), RasterHttpError (other statuses), RasterNetworkError
 * (no response) or an AbortError when `signal` fires.
 */
export async function loadRaster(url, { signal } = {}) {
  const hit = cachedRaster(url)
  if (hit) return hit
  let resp
  try {
    resp = await fetch(url, { signal })
  } catch (e) {
    if (e?.name === 'AbortError' || signal?.aborted) throw abortError()
    throw new RasterNetworkError(e?.message)
  }
  if (resp.status === 404) throw new RasterNotFound(await readDetail(resp))
  if (!resp.ok) throw new RasterHttpError(resp.status, await readDetail(resp))
  let buf
  try {
    buf = await resp.arrayBuffer()
  } catch (e) {
    if (e?.name === 'AbortError' || signal?.aborted) throw abortError()
    throw new RasterNetworkError(e?.message)
  }
  if (signal?.aborted) throw abortError()
  const bytes = buf.byteLength // georaster may hand the buffer to a worker
  const { default: parseGeoraster } = await import('georaster')
  const georaster = await parseGeoraster(buf)
  const entry = { georaster, empty: !hasData(georaster), bytes }
  remember(url, entry)
  if (signal?.aborted) throw abortError()
  return entry
}

// Requests in flight, shared by everyone who wants the same URL. A request
// is aborted only when its last user lets go (checked a tick later, so
// React's StrictMode unmount/remount in development — or two panes asking
// for one map — never sends the same request twice).
const inflight = new Map() // url → { promise, ctrl, refs }

/** {promise, release}: the raster for `url`, shared; call release() when it
 *  is no longer wanted. A URL nobody wants any more is cancelled. */
export function acquireRaster(url) {
  const hit = cachedRaster(url)
  if (hit) return { promise: Promise.resolve(hit), release() {} }
  let entry = inflight.get(url)
  if (!entry) {
    const ctrl = new AbortController()
    entry = { ctrl, refs: 0, promise: null }
    const mine = entry
    entry.promise = loadRaster(url, { signal: ctrl.signal })
    entry.promise.catch(() => {}).finally(() => { if (inflight.get(url) === mine) inflight.delete(url) })
    inflight.set(url, entry)
  }
  const held = entry
  held.refs++
  let released = false
  return {
    promise: held.promise,
    release() {
      if (released) return
      released = true
      held.refs--
      setTimeout(() => {
        if (held.refs === 0 && inflight.get(url) === held) {
          inflight.delete(url)
          held.ctrl.abort()
        }
      }, 0)
    },
  }
}

function stateFor(url) {
  const hit = url ? cache.get(url) : null
  if (hit) return { url, status: hit.empty ? 'empty' : 'ready', georaster: hit.georaster, error: null }
  return { url, status: url ? 'loading' : 'idle', georaster: null, error: null }
}

export function errorStatus(err) {
  if (err instanceof RasterNotFound) return 'notfound'
  if (err instanceof RasterNetworkError) return 'network'
  if (err instanceof RasterHttpError) return err.status >= 500 ? 'network' : 'error'
  return 'error'
}

/**
 * The raster for a URL as React state: {status, georaster, error, retry}.
 * status: 'loading' | 'ready' | 'empty' | 'notfound' | 'network' | 'error'.
 * A new URL aborts the previous request; a cached URL resolves in the same
 * render, so revisiting a map never flashes a loading state.
 */
export function useRaster(url) {
  const [state, setState] = useState(() => stateFor(url))
  const [attempt, setAttempt] = useState(0)
  // Derive synchronously when the URL changes so a stale map is never shown
  // under a new title for even one frame.
  const current = state.url === url ? state : stateFor(url)

  useEffect(() => {
    if (!url) return undefined
    const hit = cachedRaster(url)
    if (hit) { setState(stateFor(url)); return undefined }
    let alive = true
    setState({ url, status: 'loading', georaster: null, error: null })
    const { promise, release } = acquireRaster(url)
    promise.then(
      (entry) => {
        if (!alive) return
        setState({ url, status: entry.empty ? 'empty' : 'ready', georaster: entry.georaster, error: null })
      },
      (err) => {
        if (!alive || err?.name === 'AbortError') return
        setState({ url, status: errorStatus(err), georaster: null, error: err })
      },
    )
    return () => { alive = false; release() }
  }, [url, attempt])

  return { ...current, retry: () => setAttempt((n) => n + 1) }
}
