import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { parseViewerPath } from '../viewer/urlGrammar'

// The navigator's client-side brain. Conversation lives in memory only (this
// tab, this visit); nothing is stored. The assistant has three states:
//   'inline'  — the big box on the landing page (or wherever a page hosts it)
//   'dock'    — minimized to the lower-right, after a navigation
//   'panel'   — the dock expanded into a small chat panel
const Ctx = createContext(null)

const WELCOME = { role: 'assistant', content: 'Tell me what you are looking for and I will take you there: a map, a station, a storm report, a download, a tool.' }

export function AssistantProvider({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [messages, setMessages] = useState([WELCOME])
  const [mode, setMode] = useState('inline')      // 'inline' | 'dock' | 'panel'
  const [busy, setBusy] = useState(false)
  const historyRef = useRef([])

  const context = useCallback(() => {
    const viewer = parseViewerPath(location.pathname, location.search)
    return { path: location.pathname + location.search, viewer: viewer && !viewer.error ? viewer : null }
  }, [location])

  const runActions = useCallback((actions = []) => {
    let navigated = false
    for (const a of actions) {
      if (a.type === 'navigate' && a.path && a.path.startsWith('/')) { navigate(a.path); navigated = true }
      else if (a.type === 'open' && a.url) { window.open(a.url, '_blank', 'noopener,noreferrer'); navigated = true }
      else if (a.type === 'handoff' && a.url) { window.open(a.url, '_blank', 'noopener,noreferrer') }
    }
    return navigated
  }, [navigate])

  const send = useCallback(async (text) => {
    const q = (text || '').trim()
    if (!q || busy) return
    setBusy(true)
    setMessages((m) => [...m, { role: 'user', content: q }])
    try {
      const res = await fetch('/api/navigate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q, history: historyRef.current.slice(-8), context: context() }),
      })
      let data
      try { data = await res.json() } catch { data = null }
      if (!res.ok && !(data && data.reply)) data = { intent: 'info', reply: `Something went wrong (${res.status}). Try again in a moment.`, actions: [], alternatives: [] }
      historyRef.current = [...historyRef.current, { role: 'user', content: q }, { role: 'assistant', content: data.reply || '' }]
      setMessages((m) => [...m, { role: 'assistant', content: data.reply || '', intent: data.intent, actions: data.actions || [], alternatives: data.alternatives || [] }])
      const navigated = runActions(data.actions)
      if (navigated || data.minimize) setMode('dock')
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: 'I could not reach the navigator. Check the connection and try again.' }])
    } finally { setBusy(false) }
  }, [busy, context, runActions])

  const open = useCallback(() => setMode((m) => (m === 'inline' ? 'inline' : 'panel')), [])
  const minimize = useCallback(() => setMode('dock'), [])
  const reset = useCallback(() => { historyRef.current = []; setMessages([WELCOME]); setMode('inline') }, [])

  const value = useMemo(() => ({ messages, mode, busy, send, open, minimize, setMode, reset }), [messages, mode, busy, send, open, minimize, reset])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAssistant() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAssistant outside AssistantProvider')
  return v
}
