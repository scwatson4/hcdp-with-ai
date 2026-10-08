import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { parseViewerPath } from '../viewer/urlGrammar'
import { handoffUrl } from '../site/handoff'

// The navigator's client-side brain. Conversation lives in memory only (this
// tab, this visit); nothing is stored. The assistant has three states:
//   'inline'  — the big box on the landing page (or wherever a page hosts it)
//   'dock'    — minimized to the lower-right, after a navigation
//   'panel'   — the dock expanded into a small chat panel
const Ctx = createContext(null)

const WELCOME = { id: 0, role: 'assistant', content: 'Tell me what you are looking for and I will take you there: a map, a station, a storm report, a download, a tool.' }

// T2 pick B (2026-10-08): an analysis reply counts down five seconds and then opens the AI
// interface in a new tab by itself; "Stay here" cancels. Only the newest analysis reply counts,
// and only once (keyed by the message's id).
export const HANDOFF_SECONDS = 5

/** Open a new tab and say whether the browser allowed it. `noopener` as a feature makes
 *  window.open return null even on success, so the opener is cut afterwards instead. */
export function openNewTab(href) {
  let w = null
  try { w = window.open(href, '_blank') } catch { w = null }
  if (w) { try { w.opener = null } catch { /* cross-origin */ } }
  return Boolean(w)
}

export function AssistantProvider({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [messages, setMessages] = useState([WELCOME])
  const [mode, setMode] = useState('inline')      // 'inline' | 'dock' | 'panel'
  const [busy, setBusy] = useState(false)
  const historyRef = useRef([])
  const seq = useRef(0)
  const nextId = () => { seq.current += 1; return seq.current }

  // The hand-off countdown: { id, href, remaining, status: 'counting' | 'opened' | 'blocked' | 'stayed' }.
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
  useEffect(() => () => clearHandoffTimer(), [])

  const context = useCallback(() => {
    const viewer = parseViewerPath(location.pathname, location.search)
    return { path: location.pathname + location.search, viewer: viewer && !viewer.error ? viewer : null }
  }, [location])

  const runActions = useCallback((actions = []) => {
    let navigated = false
    for (const a of actions) {
      if (a.type === 'navigate' && a.path && a.path.startsWith('/')) { navigate(a.path); navigated = true }
      else if (a.type === 'open' && a.url) { if (!openNewTab(a.url)) a.blocked = true; navigated = true }   // the message keeps a link if the tab was blocked
      // handoff: the reply bubble links the AI interface and counts down to opening it (startHandoff)
    }
    return navigated
  }, [navigate])

  const send = useCallback(async (text) => {
    const q = (text || '').trim()
    if (!q || busy) return
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
      const navigated = runActions(data.actions)
      const id = nextId()
      const actions = data.actions || []
      setMessages((m) => [...m, { id, role: 'assistant', content: data.reply || '', intent: data.intent, actions, alternatives: data.alternatives || [] }])
      if (data.intent === 'analysis') startHandoff(id, actions.find((a) => a.type === 'handoff')?.url || handoffUrl({ question: q, viewerPath: location.pathname }))
      if (navigated) setMode('dock')   // only a real navigation docks the assistant; a hand-off answer stays open
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: 'I could not reach the navigator. Check the connection and try again.' }])
    } finally { setBusy(false) }
  }, [busy, context, runActions, startHandoff, location.pathname])

  const open = useCallback(() => {
    if (mode === 'inline' && location.pathname === '/') { document.querySelector('[data-testid="assistant-input"]')?.focus(); return }
    setMode('panel')
    setTimeout(() => document.querySelector('[data-testid="assistant-dock-panel"] [data-testid="assistant-input"]')?.focus(), 50)
  }, [mode, location.pathname])
  const minimize = useCallback(() => setMode('dock'), [])
  // Start over: the inline box on the landing page, the pill anywhere else.
  const reset = useCallback(() => { historyRef.current = []; clearHandoffTimer(); setHandoff(null); setMessages([WELCOME]); setMode(location.pathname === '/' ? 'inline' : 'dock') }, [location.pathname])

  // Arriving on the landing page brings the conversation back into the inline box.
  useEffect(() => { if (location.pathname === '/') setMode('inline') }, [location.pathname])
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

  const value = useMemo(() => ({ messages, mode, busy, send, open, minimize, setMode, reset, handoff, stayHere, settleHandoff }), [messages, mode, busy, send, open, minimize, reset, handoff, stayHere, settleHandoff])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAssistant() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAssistant outside AssistantProvider')
  return v
}
