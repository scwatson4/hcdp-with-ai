import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { parseViewerPath } from '../viewer/urlGrammar'
import { handoffUrl } from '../site/handoff'
import TravelProxy from './TravelProxy'

// The navigator's client-side brain. Conversation lives in memory only (this
// tab, this visit); nothing is stored. The assistant has three states:
//   'inline'  — the big bar in the landing page's hero (the answers show in a card under it)
//   'dock'    — the bar docked under the header on every inner page, its dropdown closed
//   'panel'   — the docked bar with its dropdown (the conversation) open
// R1 picks A + D (2026-10-08): a navigation from the landing page answers first (the reply
// shows under the hero bar for HOLD_MS), then the bar rides up to the header row (TRAVEL_MS)
// and the page changes; the reply then sits in a strip under the docked bar for STRIP_MS.
// 13 Oct: every navigation also asks /api/summary for the destination's AI summary (shown by
// <AISummary /> at the top of the page instead of the strip; the strip only when the summary fails)
// and stores its follow-up asks, keyed by the destination's pathname + search, for the docked
// bar's ghost carousel (setFollowups / followupsFor).
const Ctx = createContext(null)

const WELCOME = { id: 0, role: 'assistant', content: 'Tell me what you are looking for and I will take you there: a map, a station, a storm report, a download, a tool.' }

// T2 pick B (2026-10-08): an analysis reply counts down five seconds and then opens the AI
// interface in a new tab by itself; "Stay here" cancels. Only the newest analysis reply counts,
// and only once (keyed by the message's id).
export const HANDOFF_SECONDS = 5
export const HOLD_MS = 700      // answer first: the reply shows under the hero bar this long
export const TRAVEL_MS = 450    // then the bar rides up and docks under the header
export const STRIP_MS = 5000    // the reply strip under the docked bar (hover/focus holds it)
export const FOLLOWUPS_KEEP = 12 // how many addresses' follow-up sets are kept (memory only)
export const MAX_FOLLOWUPS = 3

/** Open a new tab and say whether the browser allowed it. `noopener` as a feature makes
 *  window.open return null even on success, so the opener is cut afterwards instead. */
export function openNewTab(href) {
  let w = null
  try { w = window.open(href, '_blank') } catch { w = null }
  if (w) { try { w.opener = null } catch { /* cross-origin */ } }
  return Boolean(w)
}

export const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function AssistantProvider({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [messages, setMessages] = useState([WELCOME])
  const [mode, setMode] = useState(() => (location.pathname === '/' ? 'inline' : 'dock'))   // 'inline' | 'dock' | 'panel'
  const [busy, setBusy] = useState(false)
  const [travel, setTravel] = useState({ phase: 'idle', path: null })   // 'idle' | 'hold' | 'travel'
  const [strip, setStrip] = useState(null)   // { id, reply, alternatives, path }
  const [narration, setNarration] = useState(null)
  const [heroOut, setHeroOut] = useState(false)   // L4 E: the landing hero has scrolled away → the bar docks under the header   // the wait line from gpt-6-luna, or null → "Working on that…"
  const narrateAbort = useRef(null)
  // The AI overview of the latest destination: { id, path (pathname only), status: 'pending' | 'ready', chunks, cites,
  // more, moreCites, sources, followups, alternatives (the answer's, for the Show more fold) }. A ref mirrors it so
  // arrive() can read it synchronously.
  const [summary, setSummaryState] = useState(null)
  const summaryRef = useRef(null)
  const setSummary = useCallback((next) => { summaryRef.current = typeof next === 'function' ? next(summaryRef.current) : next; setSummaryState(summaryRef.current) }, [])
  const summaryAbort = useRef(null)
  const pendingStrip = useRef(null)   // { id, strip }: the strip to show if the summary fails after the page has arrived
  const pathRef = useRef(location.pathname)
  // Follow-up asks by address (pathname + search): { key: { list, source: 'summary' | 'view', at } }.
  const [followups, setFollowupsState] = useState({})
  const [epoch, setEpoch] = useState(0)      // bumped by reset(): the bars remount empty (item 13)
  const historyRef = useRef([])
  const seq = useRef(0)
  const nextId = () => { seq.current += 1; return seq.current }
  const timers = useRef({})
  const travelling = travel.phase !== 'idle'

  // ── the hand-off countdown: { id, href, remaining, status: 'counting' | 'opened' | 'blocked' | 'stayed' } ──
  const [handoff, setHandoff] = useState(null)
  const handoffTimer = useRef(null)
  const clearHandoffTimer = () => { if (handoffTimer.current) { clearInterval(handoffTimer.current); handoffTimer.current = null } }
  const startHandoff = useCallback((id, href) => {
    clearHandoffTimer()
    let remaining = HANDOFF_SECONDS
    setHandoff({ id, href, remaining, status: 'counting' })
    handoffTimer.current = setInterval(() => {
      remaining -= 1
      if (remaining > 0) { setHandoff((h) => (h && h.id === id ? { ...h, remaining } : h)); return }
      clearHandoffTimer()
      const ok = openNewTab(href)
      setHandoff((h) => (h && h.id === id ? { ...h, remaining: 0, status: ok ? 'opened' : 'blocked' } : h))
    }, 1000)
  }, [])
  /** "Stay here": the countdown stops and nothing opens. */
  const stayHere = useCallback(() => { clearHandoffTimer(); setHandoff((h) => (h && h.status === 'counting' ? { ...h, status: 'stayed' } : h)) }, [])
  /** The visitor opened the link by hand: no second tab. */
  const settleHandoff = useCallback(() => { clearHandoffTimer(); setHandoff((h) => (h && h.status === 'counting' ? { ...h, status: 'opened' } : h)) }, [])

  // ── the reply strip under the docked bar ──
  const hideStrip = useCallback(() => { clearTimeout(timers.current.strip); timers.current.strip = null; setStrip(null) }, [])
  const releaseStrip = useCallback(() => { clearTimeout(timers.current.strip); timers.current.strip = setTimeout(() => setStrip(null), STRIP_MS) }, [])
  const holdStrip = useCallback(() => { clearTimeout(timers.current.strip); timers.current.strip = null }, [])
  const showStrip = useCallback((s) => { setStrip(s); releaseStrip() }, [releaseStrip])

  // ── the follow-ups store ──
  /** Remember the follow-up asks for an address (pathname + search). `source` says who made them: the summary call,
   *  or (reserved) a per-view regeneration. An empty list forgets the address. */
  const setFollowups = useCallback((key, list, { source = 'summary' } = {}) => {
    const clean = (Array.isArray(list) ? list : []).filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim()).slice(0, MAX_FOLLOWUPS)
    setFollowupsState((m) => {
      const next = { ...m }
      if (!clean.length) { delete next[key]; return next }
      next[key] = { list: clean, source, at: Date.now() }
      const keys = Object.keys(next).sort((a, b) => next[a].at - next[b].at)
      while (keys.length > FOLLOWUPS_KEEP) delete next[keys.shift()]
      return next
    })
  }, [])
  /** The follow-ups for an address: the exact pathname + search first; else the newest set for the pathname (the
   *  viewer rewrites its address on load — canonical spelling, remembered units — and the page's set still applies). */
  const followupsFor = useCallback((pathname, search = '') => {
    const exact = followups[pathname + (search || '')]
    if (exact) return exact.list
    let best = null
    for (const [k, v] of Object.entries(followups)) if (k.split('?')[0] === pathname && (!best || v.at > best.at)) best = v
    return best ? best.list : null
  }, [followups])

  // ── the AI summary of a destination ──
  const dismissSummary = useCallback(() => { summaryAbort.current?.abort(); summaryAbort.current = null; pendingStrip.current = null; setSummary(null) }, [setSummary])
  /** Ask /api/summary for the page the navigator just chose. The block shows as pending at once; when the sentences
   *  arrive it fills in and the follow-ups are stored under the destination's address; if the call fails or comes back
   *  empty the block goes and the reply strip shows (after the arrival, if the visitor is still on that page). */
  const requestSummary = useCallback((id, question, data, navPath) => {
    summaryAbort.current?.abort()
    const ac = new AbortController(); summaryAbort.current = ac
    const key = navPath.split('#')[0]
    const pathname = key.split('?')[0]
    const alternatives = (Array.isArray(data.alternatives) ? data.alternatives : []).filter((a) => a && typeof a.url === 'string' && a.title).slice(0, 4)
    setSummary({ id, path: pathname, status: 'pending', chunks: [], cites: [], more: [], moreCites: [], sources: [], followups: [], alternatives })
    const fail = () => {
      if (ac.signal.aborted) return
      setSummary((cur) => (cur && cur.id === id ? null : cur))
      const p = pendingStrip.current
      if (p && p.id === id) { pendingStrip.current = null; if (pathRef.current === p.strip.path) showStrip(p.strip) }
    }
    fetch('/api/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: question, reply: data.reply || '', path: navPath, intent: data.intent || 'navigate' }), signal: ac.signal })
      .then((r) => (r && r.ok ? r.json() : null))
      .then((d) => {
        if (ac.signal.aborted) return
        const chunks = Array.isArray(d?.chunks) ? d.chunks.filter((c) => typeof c === 'string' && c.trim()) : []
        if (!chunks.length) { fail(); return }
        const sources = Array.isArray(d.sources) ? d.sources.filter((x) => x && typeof x.url === 'string' && /^https?:\/\//.test(x.url) && typeof x.title === 'string' && x.title.trim()) : []
        const citesOf = (list, n) => Array.from({ length: n }, (_, i) => (Array.isArray(list?.[i]) ? list[i].filter((k) => Number.isInteger(k) && k >= 1 && k <= sources.length) : []))
        const more = Array.isArray(d.more) ? d.more.filter((c) => typeof c === 'string' && c.trim()) : []
        const followupList = (Array.isArray(d.followups) ? d.followups : []).filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim()).slice(0, MAX_FOLLOWUPS)
        setSummary((cur) => (cur && cur.id === id ? { ...cur, status: 'ready', chunks, cites: citesOf(d.cites, chunks.length), more, moreCites: citesOf(d.more_cites, more.length), sources, followups: followupList } : cur))
        setFollowups(key, followupList, { source: 'summary' })
        if (pendingStrip.current && pendingStrip.current.id === id) pendingStrip.current = null
      })
      .catch(fail)
  }, [setSummary, setFollowups, showStrip])

  // ── answer first, then travel ──
  const clearTravel = useCallback(() => { clearTimeout(timers.current.hold); clearTimeout(timers.current.travel); timers.current.hold = timers.current.travel = null }, [])
  /** The page changes: the bar docks under the header and the reply sits in the strip for a while. */
  const arrive = useCallback((path, s) => {
    clearTravel()
    setTravel({ phase: 'idle', path: null })
    navigate(path)
    setMode('dock')
    const strip = { ...s, path: path.split('?')[0].split('#')[0] }
    pathRef.current = strip.path
    const sum = summaryRef.current
    // 13 Oct: when a summary is on its way (or here) it is the explanation; the strip shows only if it fails.
    if (sum && sum.id === s.id) pendingStrip.current = { id: s.id, strip }
    else showStrip(strip)
  }, [clearTravel, navigate, showStrip])
  const beginTravel = useCallback((path, s) => {
    clearTravel()
    setTravel({ phase: 'hold', path })
    timers.current.hold = setTimeout(() => {
      timers.current.hold = null
      if (prefersReducedMotion()) { arrive(path, s); return }   // a cut instead of the ride-up, same end state
      setTravel({ phase: 'travel', path })
      timers.current.travel = setTimeout(() => arrive(path, s), TRAVEL_MS)
    }, HOLD_MS)
  }, [arrive, clearTravel])
  useEffect(() => () => { clearHandoffTimer(); clearTravel(); clearTimeout(timers.current.strip) }, [clearTravel])

  const context = useCallback(() => {
    const viewer = parseViewerPath(location.pathname, location.search)
    return { path: location.pathname + location.search, viewer: viewer && !viewer.error ? viewer : null }
  }, [location])

  const send = useCallback(async (text, opts = {}) => {
    const q = (text || '').trim()
    if (!q || busy || travelling) return
    setBusy(true)
    setNarration(null)
    // A new question replaces the last answer's summary and strip (the page shows the wait line meanwhile).
    summaryAbort.current?.abort(); summaryAbort.current = null; pendingStrip.current = null; setSummary(null); hideStrip()
    setMessages((m) => [...m, { id: nextId(), role: 'user', content: q }])
    // In parallel with the answer: one short narration line for the wait indicator (never delays the answer).
    try {
      narrateAbort.current?.abort()
      const ac = new AbortController(); narrateAbort.current = ac
      fetch('/api/narrate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: q }), signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null)).then((d) => { if (!ac.signal.aborted && d && typeof d.line === 'string' && d.line.trim()) setNarration(d.line.trim()) }).catch(() => {})
    } catch { /* no narration: the fallback line shows */ }
    try {
      const res = await fetch('/api/navigate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q, history: historyRef.current.slice(-8), context: context() }),
      })
      let data
      try { data = await res.json() } catch { data = null }
      if (!res.ok && !(data && data.reply)) data = { intent: 'info', reply: `Something went wrong (${res.status}). Try again in a moment.`, actions: [], alternatives: [] }
      historyRef.current = [...historyRef.current, { role: 'user', content: q }, { role: 'assistant', content: data.reply || '' }]
      const actions = data.actions || []
      const alternatives = data.alternatives || []
      // External HCDP pages open now, in a new tab; the message keeps a link if the tab was blocked.
      for (const a of actions) if (a.type === 'open' && a.url) { if (!openNewTab(a.url)) a.blocked = true }
      const nav = actions.find((a) => a.type === 'navigate' && typeof a.path === 'string' && a.path.startsWith('/'))
      const id = nextId()
      setMessages((m) => [...m, { id, role: 'assistant', content: data.reply || '', intent: data.intent, actions, alternatives }])
      if (data.intent === 'analysis') startHandoff(id, actions.find((a) => a.type === 'handoff')?.url || handoffUrl({ question: q, viewerPath: location.pathname }))
      const onLanding = location.pathname === '/' && !opts.docked   // sent from the scroll-docked bar: go at once, like an inner page
      if (nav) {
        const s = { id, reply: data.reply || '', alternatives: alternatives.slice(0, 2) }
        if (!data.off_topic) requestSummary(id, q, data, nav.path)   // the destination's AI summary, in parallel with the travel
        if (onLanding) beginTravel(nav.path, s)   // answer first, then the bar rides up
        else arrive(nav.path, s)                   // already docked: go now; the summary (or, failing that, the strip) explains
      } else if (!onLanding) {
        setMode('panel')   // a reply with nowhere to go: the dropdown shows it
      }
    } catch (e) {
      setMessages((m) => [...m, { id: nextId(), role: 'assistant', content: 'I could not reach the navigator. Check the connection and try again.' }])
    } finally { setBusy(false); narrateAbort.current?.abort(); narrateAbort.current = null }
  }, [busy, travelling, context, startHandoff, beginTravel, arrive, location.pathname, requestSummary, setSummary, hideStrip])

  /** Put the cursor in the bar (the landing bar on /, the docked bar elsewhere). */
  const open = useCallback(() => {
    const sel = location.pathname === '/' ? '[data-testid="landing-assistant"] [data-testid="assistant-input"]' : '[data-testid="assistant-bar"] [data-testid="assistant-input"]'
    document.querySelector(sel)?.focus()
  }, [location.pathname])
  const minimize = useCallback(() => setMode((m) => (m === 'panel' ? 'dock' : m)), [])
  // Start over: the hero bar on the landing page, the docked bar anywhere else.
  const reset = useCallback(() => {
    historyRef.current = []
    clearHandoffTimer(); setHandoff(null); clearTravel(); setTravel({ phase: 'idle', path: null }); hideStrip()
    dismissSummary(); setFollowupsState({})
    setMessages([WELCOME]); setMode(location.pathname === '/' ? 'inline' : 'dock'); setEpoch((n) => n + 1)
  }, [location.pathname, clearTravel, hideStrip, dismissSummary])

  // Arriving on the landing page brings the conversation back into the hero bar; on an inner page the
  // bar is docked and any open dropdown closes (a navigation happened).
  useEffect(() => {
    if (location.pathname === '/') setMode('inline')
    else setMode((m) => (m === 'dock' ? m : 'dock'))
  }, [location.pathname])
  // A page change during the hold or the ride-up (the visitor clicked elsewhere) cancels the travel;
  // and the strip belongs to the page it was shown on.
  useEffect(() => {
    pathRef.current = location.pathname
    if (travel.phase !== 'idle' && location.pathname !== '/') { clearTravel(); setTravel({ phase: 'idle', path: null }) }
    if (strip && strip.path !== location.pathname) hideStrip()
    // and the summary belongs to the page the assistant opened: a route change it did not cause takes it away
    if (summaryRef.current && summaryRef.current.path !== location.pathname) dismissSummary()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // A shared question link (/?ask=…) asks it once on arrival.
  const askedRef = useRef(false)
  useEffect(() => {
    const ask = new URLSearchParams(location.search).get('ask')
    if (!ask || askedRef.current) return
    askedRef.current = true
    setTimeout(() => send(ask), 50)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])

  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(input|textarea|select)$/i.test(e.target?.tagName || '') || e.target?.isContentEditable
      if (e.key === 'Escape' && mode === 'panel') { setMode('dock'); return }
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); open() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, open])

  const value = useMemo(() => ({
    messages, mode, busy, travelling, travel, strip, narration, heroOut, setHeroOut, epoch, send, open, minimize, setMode, reset,
    handoff, stayHere, settleHandoff, holdStrip, releaseStrip, hideStrip,
    summary, dismissSummary, followups, followupsFor, setFollowups,
  }), [messages, mode, busy, travelling, travel, strip, narration, heroOut, epoch, send, open, minimize, reset, handoff, stayHere, settleHandoff, holdStrip, releaseStrip, hideStrip,
    summary, dismissSummary, followups, followupsFor, setFollowups])
  return (
    <Ctx.Provider value={value}>
      {children}
      {travel.phase === 'travel' && <TravelProxy />}
    </Ctx.Provider>
  )
}

export function useAssistant() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAssistant outside AssistantProvider')
  return v
}

/** The assistant, or null when rendered outside the provider (pages render on their own in tests). */
export function useAssistantOptional() {
  return useContext(Ctx)
}
