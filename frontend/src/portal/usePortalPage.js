import { useEffect, useState } from 'react'

// The copy of one HCDP page, from GET /api/portal/page?path= (CONTRACT.md "Mirrored pages"). Kept in memory for the
// visit, so Back and Forward show a page at once (the request still goes out; the browser's cache usually answers it).
const memory = new Map()
const KEEP = 60
// 18 Oct: the app pages (the storm reports, the Monthly Climate Summary, the Mesonet's live and Nolo viewers, the Guam
// viewer) have no HCDP copy, but the mirror's job writes them an overview from the catalog all the same:
// GET /api/portal/overview?path= → { path, overview } (404 until it is written). Kept in memory for the visit too.
const overviews = new Map()   // our address → { path, overview } | null (none written yet)

export function forgetPortalPages() { memory.clear(); overviews.clear() }

/** { status: 'loading' | 'ready' | 'missing' | 'error', data?, hcdpUrl? } for one of our addresses. */
export function usePortalPage(path) {
  const [state, setState] = useState(() => (memory.has(path) ? { status: 'ready', data: memory.get(path) } : { status: 'loading' }))
  useEffect(() => {
    const ac = new AbortController()
    setState(memory.has(path) ? { status: 'ready', data: memory.get(path) } : { status: 'loading' })
    fetch(`/api/portal/page?path=${encodeURIComponent(path)}`, { signal: ac.signal, headers: { Accept: 'application/json' } })
      .then(async (r) => {
        if (ac.signal.aborted) return
        if (r.status === 404) {
          const d = await r.json().catch(() => ({}))
          setState({ status: 'missing', hcdpUrl: typeof d?.hcdp_url === 'string' ? d.hcdp_url : null })
          return
        }
        if (!r.ok) throw new Error(String(r.status))
        const d = await r.json()
        if (ac.signal.aborted || !d || typeof d.html !== 'string') return
        memory.set(path, d)
        while (memory.size > KEEP) memory.delete(memory.keys().next().value)
        setState({ status: 'ready', data: d })
      })
      .catch(() => { if (!ac.signal.aborted) setState((s) => (s.status === 'ready' ? s : { status: 'error' })) })
    return () => ac.abort()
  }, [path])
  return state
}

/** An app page's own overview record ({ path, overview }) for one of our addresses, or null while there is none. */
export function useAppOverview(path) {
  const [record, setRecord] = useState(() => (path ? overviews.get(path) ?? null : null))
  useEffect(() => {
    if (!path) { setRecord(null); return undefined }
    if (overviews.has(path)) { setRecord(overviews.get(path)); return undefined }
    const ac = new AbortController()
    setRecord(null)
    fetch(`/api/portal/overview?path=${encodeURIComponent(path)}`, { signal: ac.signal, headers: { Accept: 'application/json' } })
      .then(async (r) => {
        if (ac.signal.aborted) return
        const d = r.ok ? await r.json().catch(() => null) : null
        const rec = d && d.overview && Array.isArray(d.overview.chunks) ? d : null
        if (r.ok || r.status === 404) {
          overviews.set(path, rec)
          while (overviews.size > KEEP) overviews.delete(overviews.keys().next().value)
        }
        setRecord(rec)
      })
      .catch(() => {})
    return () => ac.abort()
  }, [path])
  return record
}
