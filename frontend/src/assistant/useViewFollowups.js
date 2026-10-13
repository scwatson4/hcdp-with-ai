import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAssistantOptional } from './AssistantProvider'
import { describeViewer } from '../viewer/urlGrammar'

// N4 A (13 Oct): follow-ups that follow the visitor's own clicks. When the viewer's address changes from the rail —
// dataset, period, date or extent; not a display option, not the first load, not a page the assistant opened — the
// hook waits VIEW_FOLLOWUPS_DELAY_MS after the last change, then asks POST /api/followups for three asks about the
// new view and stores them under the address (setFollowups(key, list, { source: 'view' })), so the docked bar's ghost
// cycles them. A memory cache by view (at most VIEW_CACHE_MAX) answers a return visit at once; a newer change aborts
// the call in flight; nothing changes when the call fails or answers empty. The AskBar adopts a new set only at the end
// of the current example's hold. A rail change also counts as the visitor's next page for an open "Wrong page?" report.
export const VIEW_FOLLOWUPS_DELAY_MS = 1500
export const VIEW_CACHE_MAX = 50
const cache = new Map()   // view path → follow-ups (memory only)
export function clearViewFollowupsCache() { cache.clear() }
export const viewFollowupsCacheSize = () => cache.size

export function useViewFollowups(v) {
  const assistant = useAssistantOptional()
  const { pathname, search } = useLocation()
  const identity = v && !v.error ? `${v.dataset}/${v.period}/${v.date}/${v.extent}` : null
  const last = useRef(identity)
  const timer = useRef(null)
  const abort = useRef(null)
  const setFollowups = assistant?.setFollowups
  const wasAssistant = assistant?.wasAssistantNavigation
  const noteNavigation = assistant?.noteNavigation
  useEffect(() => {
    if (!identity || !setFollowups) { last.current = identity; return undefined }
    if (identity === last.current) return undefined   // a display option, the camera, a station: not the view
    last.current = identity
    if (wasAssistant?.(pathname, search)) return undefined   // the assistant brought the visitor here: its overview has the follow-ups
    const address = pathname + (search || '')
    noteNavigation?.(address)
    clearTimeout(timer.current)
    abort.current?.abort(); abort.current = null
    timer.current = setTimeout(() => {
      timer.current = null
      const hit = cache.get(pathname)
      if (hit) { setFollowups(address, hit, { source: 'view' }); return }
      const ac = new AbortController(); abort.current = ac
      const context = { dataset: v.dataset, period: v.period, date: v.date, extent: v.extent, title: describeViewer(v) }
      fetch('/api/followups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: address, context }), signal: ac.signal })
        .then((r) => (r && r.ok ? r.json() : null))
        .then((d) => {
          if (ac.signal.aborted) return
          const list = (Array.isArray(d?.followups) ? d.followups : []).filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim()).slice(0, 3)
          if (!list.length) return
          cache.set(pathname, list)
          while (cache.size > VIEW_CACHE_MAX) cache.delete(cache.keys().next().value)
          setFollowups(address, list, { source: 'view' })
        })
        .catch(() => {})
    }, VIEW_FOLLOWUPS_DELAY_MS)
    return undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity])
  useEffect(() => () => { clearTimeout(timer.current); abort.current?.abort() }, [])
}
