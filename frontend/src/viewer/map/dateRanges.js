// Published date ranges per dataset/period/extent from /api/dates (the HCDP
// /datasets/date/range answer, proxied). Cached for the page's life; the
// same request in flight is shared. A failed call is not cached, and the
// viewer then allows any date.

import { useEffect, useState } from 'react'
import { datesRequestUrl, parseDateRange } from './viewerModel'

const ranges = new Map() // url → {start, end} | null
const inflight = new Map() // url → Promise

/** For tests. */
export function clearDateRanges() { ranges.clear(); inflight.clear() }

export function cachedDateRange(dataset, period, extent) {
  const url = datesRequestUrl(dataset, period, extent)
  return ranges.has(url) ? ranges.get(url) : undefined
}

/** Resolves {start, end} (in the period's format) or rejects. */
export function getDateRange(dataset, period, extent) {
  const url = datesRequestUrl(dataset, period, extent)
  if (ranges.has(url)) return Promise.resolve(ranges.get(url))
  if (inflight.has(url)) return inflight.get(url)
  const p = (async () => {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`dates: HTTP ${resp.status}`)
    const range = parseDateRange(await resp.json(), period)
    if (!range) throw new Error('dates: no range in the answer')
    ranges.set(url, range)
    return range
  })()
  inflight.set(url, p)
  p.catch(() => {}).finally(() => inflight.delete(url))
  return p
}

/** getDateRange, bounded in time: resolves null instead of waiting longer
 *  than `ms` or failing (used before a navigation that would like to clamp). */
export function getDateRangeSoon(dataset, period, extent, ms = 1500) {
  return Promise.race([
    getDateRange(dataset, period, extent).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

/** {status: 'loading' | 'ready' | 'error', range} for the current map. */
export function useDateRange(dataset, period, extent) {
  const key = datesRequestUrl(dataset, period, extent)
  const initial = () => {
    const hit = cachedDateRange(dataset, period, extent)
    return hit ? { key, status: 'ready', range: hit } : { key, status: 'loading', range: null }
  }
  const [state, setState] = useState(initial)
  const current = state.key === key ? state : initial()

  useEffect(() => {
    let alive = true
    const hit = cachedDateRange(dataset, period, extent)
    if (hit) { setState({ key, status: 'ready', range: hit }); return undefined }
    setState({ key, status: 'loading', range: null })
    getDateRange(dataset, period, extent).then(
      (range) => { if (alive) setState({ key, status: 'ready', range }) },
      () => { if (alive) setState({ key, status: 'error', range: null }) },
    )
    return () => { alive = false }
  }, [key, dataset, period, extent])

  return current
}
