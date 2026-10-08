// Station values, station metadata and time series from the backend
// (CONTRACT.md → "Viewer data endpoints"), as React state. Answers are kept
// for the life of the page in one cache keyed by the request URL; a hook
// whose URL changes aborts the request it no longer wants.

import { useEffect, useState } from 'react'

const cache = new Map() // url → parsed JSON

/** For tests. */
export function clearStationCache() { cache.clear() }

// ── request URLs ────────────────────────────────────────────────────────────

/** The stations with a value for one map (joined with their metadata). */
export function stationValuesUrl({ dataset, period, date }) {
  const q = new URLSearchParams({ dataset, period, date })
  return `/api/station-values?${q}`
}

/** Every station of HCDP's climate network, with elevation. */
export const CLIMATE_STATIONS_URL = '/api/climate-stations'

/** A station's record (station=SKN) or a grid cell's (lat & lng). */
export function timeseriesUrl({ dataset, period, start, end, station = null, lat = null, lng = null }) {
  const q = new URLSearchParams({ dataset, period, start, end })
  if (station) q.set('station', String(station))
  else { q.set('lat', Number(lat).toFixed(4)); q.set('lng', Number(lng).toFixed(4)) }
  return `/api/timeseries?${q}`
}

// ── fetching ────────────────────────────────────────────────────────────────

export class JsonHttpError extends Error {
  constructor(status, detail) { super(detail || `HTTP ${status}`); this.name = 'JsonHttpError'; this.status = status }
}

async function readDetail(resp) {
  try {
    const body = await resp.json()
    return typeof body?.detail === 'string' ? body.detail : null
  } catch { return null }
}

/** Fetch and parse one JSON answer (cached by URL). Rejects with
 *  JsonHttpError for a non-2xx status, the fetch error otherwise. */
export async function loadJson(url, { signal } = {}) {
  if (cache.has(url)) return cache.get(url)
  const resp = await fetch(url, { signal })
  if (!resp.ok) throw new JsonHttpError(resp.status, await readDetail(resp))
  const data = await resp.json()
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  cache.set(url, data)
  return data
}

function stateFor(url) {
  if (!url) return { url, status: 'idle', data: null, error: null }
  if (cache.has(url)) return { url, status: 'ready', data: cache.get(url), error: null }
  return { url, status: 'loading', data: null, error: null }
}

/**
 * The JSON at `url` as React state: {status, data, error, retry}.
 * status: 'idle' (no url) | 'loading' | 'ready' | 'notfound' (404) | 'error'.
 * A new URL aborts the previous request; a cached URL is ready at once.
 */
export function useJson(url) {
  const [state, setState] = useState(() => stateFor(url))
  const [attempt, setAttempt] = useState(0)
  const current = state.url === url ? state : stateFor(url)

  useEffect(() => {
    if (!url) return undefined
    if (cache.has(url)) { setState(stateFor(url)); return undefined }
    const ctrl = new AbortController()
    let alive = true
    setState({ url, status: 'loading', data: null, error: null })
    loadJson(url, { signal: ctrl.signal }).then(
      (data) => { if (alive) setState({ url, status: 'ready', data, error: null }) },
      (err) => {
        if (!alive || err?.name === 'AbortError') return
        setState({ url, status: err instanceof JsonHttpError && err.status === 404 ? 'notfound' : 'error', data: null, error: err })
      },
    )
    return () => { alive = false; ctrl.abort() }
  }, [url, attempt])

  return { ...current, retry: () => setAttempt((n) => n + 1) }
}

/** The station list of a /api/station-values or /api/climate-stations answer. */
export function stationsOf(data) {
  return Array.isArray(data?.stations) ? data.stations : []
}

/** One station by SKN out of an answer's list (SKNs compare as strings). */
export function findStation(data, skn) {
  if (skn == null) return null
  const key = String(skn)
  return stationsOf(data).find((s) => String(s.skn) === key) || null
}
