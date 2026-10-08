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
const Ctx = createContext(null)

const WELCOME = { id: 0, role: 'assistant', content: 'Tell me what you are looking for and I will take you there: a map, a station, a storm report, a download, a tool.' }

// T2 pick B (2026-10-08): an analysis reply counts down five seconds and then opens the AI
// interface in a new tab by itself; "Stay here" cancels. Only the newest analysis reply counts,
// and only once (keyed by the message's id).
export const HANDOFF_SECONDS = 5
export const HOLD_MS = 700      // answer first: the reply shows under the hero bar this long
export const TRAVEL_MS = 450    // then the bar rides up and docks under the header
export const STRIP_MS = 5000    // the reply strip under the docked bar (hover/focus holds it)

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

  // ── answer first, then travel ──
  const clearTravel = useCallback(() => { clearTimeout(timers.current.hold); clearTimeout(timers.current.travel); timers.current.hold = timers.current.travel = null }, [])
  /** The page changes: the bar docks under the header and the reply sits in the strip for a while. */
  const arrive = useCallback((path, s) => {
    clearTravel()
    setTravel({ phase: 'idle', path: null })
    navigate(path)
    setMode('dock')
    showStrip({ ...s, path: path.split('?')[0].split('#')[0] })
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

  const send = useCallback(async (text) => {
    const q = (text || '').trim()
    if (!q || busy || travelling) return
    setBusy(true)
    setMessages((m) => [...m, { id: nextId(), role: 'user', content: q }])
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
      const onLanding = location.pathname === '/'
      if (nav) {
        const s = { id, reply: data.reply || '', alternatives: alternatives.slice(0, 2) }
        if (onLanding) beginTravel(nav.path, s)   // answer first, then the bar rides up
        else arrive(nav.path, s)                   // already docked: go now, the strip repeats the reply
      } else if (!onLanding) {
        setMode('panel')   // a reply with nowhere to go: the dropdown shows it
      }
    } catch (e) {
      setMessages((m) => [...m, { id: nextId(), role: 'assistant', content: 'I could not reach the navigator. Check the connection and try again.' }])
    } finally { setBusy(false) }
  }, [busy, travelling, context, startHandoff, beginTravel, arrive, location.pathname])

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
    setMessages([WELCOME]); setMode(location.pathname === '/' ? 'inline' : 'dock')
  }, [location.pathname, clearTravel, hideStrip])

  // Arriving on the landing page brings the conversation back into the hero bar; on an inner page the
  // bar is docked and any open dropdown closes (a navigation happened).
  useEffect(() => {
    if (location.pathname === '/') setMode('inline')
    else setMode((m) => (m === 'dock' ? m : 'dock'))
  }, [location.pathname])
  // A page change during the hold or the ride-up (the visitor clicked elsewhere) cancels the travel;
  // and the strip belongs to the page it was shown on.
  useEffect(() => {
    if (travel.phase !== 'idle' && location.pathname !== '/') { clearTravel(); setTravel({ phase: 'idle', path: null }) }
    if (strip && strip.path !== location.pathname) hideStrip()
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
    messages, mode, busy, travelling, travel, strip, send, open, minimize, setMode, reset,
    handoff, stayHere, settleHandoff, holdStrip, releaseStrip, hideStrip,
  }), [messages, mode, busy, travelling, travel, strip, send, open, minimize, reset, handoff, stayHere, settleHandoff, holdStrip, releaseStrip, hideStrip])
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
