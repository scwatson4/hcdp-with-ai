import { useEffect, useState } from 'react'

// The copy of one HCDP page, from GET /api/portal/page?path= (CONTRACT.md "Mirrored pages"). Kept in memory for the
// visit, so Back and Forward show a page at once (the request still goes out; the browser's cache usually answers it).
const memory = new Map()
const KEEP = 60

export function forgetPortalPages() { memory.clear() }

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
