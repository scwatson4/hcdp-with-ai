import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { canonicalize, parseViewerPath } from '../viewer/urlGrammar'
import { handoffUrl } from '../site/handoff'
import { clearDownload, currentDownload, noteDownload } from '../download/downloadStore'
import TravelProxy from './TravelProxy'
import { shortTitle } from './localMatch'
import { OVERLAY, liveState, overlayOf } from '../components/overlayHistory'
import { resolveDoor } from '../site/visualize'

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
// R6 C (13 Oct): the wait line under either bar is staged — "Thinking…" at once, "Finding the right
// page…" after THINKING_MS without an answer, then "Opening {destination}…" (the title resolved
// server-side, `destination` in the /api/navigate response) for the hold and the travel; an
// open action says "Opening {title} in a new tab…", a hand-off "Opening the AI data analysis
// tool…", each for one hold; info and clarify replies end the line as their card shows.
// R6 D / R5 C (13 Oct): `choose(target)` is a navigation the visitor made themselves — a typeahead
// row or a did-you-mean tile — with no AI call: "Opening {title}…" for one hold, then the page (an
// external one in a new tab at once), then the overview flow with the reply "You chose {title}.".
// P4 A (13 Oct): "Wrong page?" at the bottom of an overview reports what the visitor wanted instead
// (reportWrongPage → POST /api/feedback/wrong-page → {id}); for WRONG_PAGE_WINDOW_MS the next
// navigation the visitor makes — an AI answer, a typeahead row, a tile, a rail change in the viewer —
// is attached to that report (noteNavigation → POST …/{id}/chose, fire-and-forget; tab memory only).
// 18 Oct (the user: "In the Visualize Data tool the AI overview should not appear automatically … I'd rather it appear inside
// the 'Ask AI' popup. Also that popup should keep conversation history."): every exchange — the question, the answer and,
// once it is written, the destination's overview (its sentences and sources) — is also kept in `log`, which the viewer's
// Ask AI popup shows as a conversation (ChatHistory.jsx: the phone's sheet, the docked bar's dropdown, the full-screen map's
// mini box). The log lives in sessionStorage (HISTORY_KEY) for the visit: it survives a reload, goes when the tab closes,
// and Start over clears it; nothing is stored on a server. The rest of the site keeps showing the latest reply only.
const Ctx = createContext(null)
export const WRONG_PAGE_WINDOW_MS = 10 * 60 * 1000
export const HISTORY_KEY = 'hcdp-ask-history'
export const HISTORY_KEEP = 40
/** This page load: message ids start over on a reload, so an exchange kept from an earlier load never matches one of this load. */
export const PAGE_LOAD = Math.random().toString(36).slice(2, 8)

const isExchange = (x) => x && typeof x === 'object' && typeof x.key === 'string' && typeof (x.ask ?? '') === 'string' && typeof (x.reply ?? '') === 'string'
/** The kept conversation (sessionStorage; [] where there is none or the browser refuses storage). */
export function readHistory() {
  try {
    const raw = typeof window !== 'undefined' ? window.sessionStorage.getItem(HISTORY_KEY) : null
    const d = raw ? JSON.parse(raw) : null
    return Array.isArray(d?.items) ? d.items.filter(isExchange).map((x) => (x.pending ? { ...x, pending: false, reply: x.reply || '' } : x)).slice(-HISTORY_KEEP) : []
  } catch { return [] }
}
function writeHistory(items) {
  try {
    if (typeof window === 'undefined') return
    if (items.length) window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify({ v: 1, items }))
    else window.sessionStorage.removeItem(HISTORY_KEY)
  } catch { /* storage refused: the history lasts as long as the page */ }
}
/** The navigator's context (its last 8 turns) rebuilt from the kept conversation. */
const turnsOf = (items) => items.flatMap((x) => [...(x.ask ? [{ role: 'user', content: x.ask }] : []), ...(x.reply ? [{ role: 'assistant', content: x.reply }] : [])]).slice(-8)
/** Whether an address is a page of the Visualize Data tool (the viewer), where Ask AI keeps its history in view. */
export const isViewerPage = (pathname) => /^\/viewer\//.test(String(pathname || ''))

// The gpt-6-luna narration (/api/narrate) used to be the wait line. R6 C replaced it (13 Oct); flip to try it again.
export const NARRATION = false
export const THINKING_MS = 1400    // "Thinking…" this long without an answer → "Finding the right page…"
export const WAIT_THINKING = 'Thinking…'
export const WAIT_FINDING = 'Finding the right page…'
export const WAIT_HANDOFF = 'Opening the AI data analysis tool…'
export const opening = (title) => (title ? `Opening ${title}…` : 'Opening…')
export const openingTab = (title) => (title ? `Opening ${title} in a new tab…` : 'Opening a new tab…')

export const WELCOME_TEXT = 'Tell me what you are looking for and I will take you there: a map, a station, a storm report, a download, a tool.'
const WELCOME = { id: 0, role: 'assistant', content: WELCOME_TEXT }

/** Whether a path is one viewer map (not the launcher), so an answer from the full-screen map can open it in place. */
const isViewerMap = (path) => {
  const [p, q = ''] = String(path || '').split('#')[0].split('?')
  const v = parseViewerPath(p, q ? `?${q}` : '')
  return Boolean(v && !v.error)
}

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
  const [wait, setWait] = useState(null)     // the staged wait line under the bar (R6 C), or null when there is none
  const [narration, setNarration] = useState(null)   // gpt-6-luna's line, only while NARRATION is on
  const [heroOut, setHeroOut] = useState(false)   // L4 E: the landing hero has scrolled away → the bar docks under the header
  const narrateAbort = useRef(null)
  // The AI overview of the latest destination: { id, path (pathname only), status: 'pending' | 'ready', chunks, cites,
  // more, moreCites, sources, followups, alternatives (the answer's, for the Show more fold) }. A ref mirrors it so
  // arrive() can read it synchronously.
  const [summary, setSummaryState] = useState(null)
  const summaryRef = useRef(null)
  const setSummary = useCallback((next) => { summaryRef.current = typeof next === 'function' ? next(summaryRef.current) : next; setSummaryState(summaryRef.current) }, [])
  const pendingStrip = useRef(null)   // { id, strip }: the strip to show if the summary fails after the page has arrived
  const pathRef = useRef(location.pathname)
  // Follow-up asks by address (pathname + search): { key: { list, source: 'summary' | 'view', at } }.
  const [followups, setFollowupsState] = useState({})
  const wrongPage = useRef(null)             // { id, until, skip }: the open "Wrong page?" report awaiting the visitor's next page (P4 A)
  const assistantPath = useRef(null)         // the last path the assistant itself navigated to (the viewer's follow-ups skip it, N4 A)
  // QB-Q5 B: the chip the visitor clicked under the hero bar — { template, blanks, seq }; the landing bar fills itself from it.
  const [chipTemplate, setChipTemplate] = useState(null)
  // `target`: the bar that fills itself — 'hero' (the landing) or 'sheet' (the phone's Ask AI sheet, M2 A).
  const pickChip = useCallback((chip, target = 'hero') => { if (chip?.template) setChipTemplate({ template: chip.template, blanks: chip.blanks || [], target, seq: Date.now() + Math.random() }) }, [])
  const [epoch, setEpoch] = useState(0)      // bumped by reset(): the bars remount empty (item 13)
  // 18 Oct: the kept conversation (sessionStorage) the viewer's Ask AI popup shows, and the navigator's context from it
  const [log, setLogState] = useState(readHistory)
  const logRef = useRef(log)
  const setLog = useCallback((fn) => { logRef.current = fn(logRef.current).slice(-HISTORY_KEEP); setLogState(logRef.current) }, [])
  useEffect(() => { writeHistory(log) }, [log])
  const pushLog = useCallback((entry) => setLog((l) => [...l, { load: PAGE_LOAD, at: Date.now(), ...entry }]), [setLog])
  const patchLog = useCallback((key, patch) => setLog((l) => (l.some((x) => x.key === key) ? l.map((x) => (x.key === key ? { ...x, ...patch } : x)) : l)), [setLog])
  const historyRef = useRef(null)
  if (historyRef.current === null) historyRef.current = turnsOf(log)
  const seq = useRef(0)
  const nextId = () => { seq.current += 1; return seq.current }
  const logKey = () => `${PAGE_LOAD}-${nextId()}`
  const keepPanelFor = useRef(null)   // the viewer map an answer from the popup opened: the popup stays open there
  const timers = useRef({})
  const travelling = travel.phase !== 'idle'
  const locStateRef = useRef(location.state)
  locStateRef.current = location.state

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

  /** N4 A: whether the assistant itself opened this viewer address (its overview carries the follow-ups then), alias
   *  spellings resolved on both sides. */
  const wasAssistantNavigation = useCallback((pathname, search = '') => {
    const p = assistantPath.current
    if (!p) return false
    const [pp, ps = ''] = p.split('?')
    const a = canonicalize(pathname, search || '') || pathname
    const b = canonicalize(pp, ps ? `?${ps}` : '') || pp
    return a.split('?')[0] === b.split('?')[0]
  }, [])

  // ── "Wrong page?" (P4 A) ──
  /** The visitor's next page, attached to the open report (once; never the page they asked for by name). */
  const noteNavigation = useCallback((target) => {
    const p = wrongPage.current
    if (!p || typeof target !== 'string' || !target) return
    if (Date.now() > p.until) { wrongPage.current = null; return }
    if (p.skip && target.split('#')[0] === p.skip.split('#')[0]) { p.skip = null; return }   // the wanted page itself is not "instead"
    wrongPage.current = null
    try {
      fetch(`/api/feedback/wrong-page/${encodeURIComponent(p.id)}/chose`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: target }), keepalive: true }).catch(() => {})
    } catch { /* fire and forget */ }
  }, [])
  /** Record a "Wrong page?" report for the overview on screen: `wanted` is { title, url } (an alternative) or { text }.
   *  Resolves to the report's id (or null); the next navigation within WRONG_PAGE_WINDOW_MS is attached to it. */
  const reportWrongPage = useCallback(async (wanted) => {
    const s = summaryRef.current
    if (!s || !wanted) return null
    const body = { ask: s.ask || '', reply: s.reply || '', destination: s.destination || s.path || '', overview_id: s.requestId || null, wanted }
    try {
      const r = await fetch('/api/feedback/wrong-page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = r && r.ok ? await r.json() : null
      const id = d && typeof d.id === 'string' ? d.id : null
      if (id) wrongPage.current = { id, until: Date.now() + WRONG_PAGE_WINDOW_MS, skip: wanted.url || null }
      return id
    } catch { return null }
  }, [])

  // ── the AI summary of a destination ──
  const dismissSummary = useCallback(() => { pendingStrip.current = null; setSummary(null) }, [setSummary])
  /** Ask /api/summary for the page the navigator just chose. The block shows as pending at once; when the sentences
   *  arrive it fills in and the follow-ups are stored under the destination's address; if the call fails or comes back
   *  empty the block goes and the reply strip shows (after the arrival, if the visitor is still on that page).
   *  18 Oct: the call is no longer cancelled by the next question or a route change — the page only shows the newest
   *  overview, but every answer's overview lands in its exchange in the kept conversation (`logKey`). */
  const requestSummary = useCallback((id, question, data, navPath, lkey = null) => {
    const key = navPath.split('#')[0]
    const pathname = key.split('?')[0]
    const alternatives = (Array.isArray(data.alternatives) ? data.alternatives : []).filter((a) => a && typeof a.url === 'string' && a.title).slice(0, 4)
    // ask, reply and destination ride along for a "Wrong page?" report (P4 A); requestId comes back with the sentences
    setSummary({ id, path: pathname, destination: key, ask: question, reply: data.reply || '', requestId: null, status: 'pending', chunks: [], cites: [], more: [], moreCites: [], sources: [], followups: [], alternatives })
    const fail = () => {
      if (lkey) patchLog(lkey, { overview: null })
      setSummary((cur) => (cur && cur.id === id ? null : cur))
      const p = pendingStrip.current
      if (p && p.id === id) { pendingStrip.current = null; if (pathRef.current === p.strip.path) showStrip(p.strip) }
    }
    fetch('/api/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: question, reply: data.reply || '', path: navPath, intent: data.intent || 'navigate' }) })
      .then((r) => (r && r.ok ? r.json() : null))
      .then((d) => {
        const chunks = Array.isArray(d?.chunks) ? d.chunks.filter((c) => typeof c === 'string' && c.trim()) : []
        if (!chunks.length) { fail(); return }
        const sources = Array.isArray(d.sources) ? d.sources.filter((x) => x && typeof x.url === 'string' && /^https?:\/\//.test(x.url) && typeof x.title === 'string' && x.title.trim()) : []
        const citesOf = (list, n) => Array.from({ length: n }, (_, i) => (Array.isArray(list?.[i]) ? list[i].filter((k) => Number.isInteger(k) && k >= 1 && k <= sources.length) : []))
        const more = Array.isArray(d.more) ? d.more.filter((c) => typeof c === 'string' && c.trim()) : []
        const followupList = (Array.isArray(d.followups) ? d.followups : []).filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim()).slice(0, MAX_FOLLOWUPS)
        const requestId = typeof d.request_id === 'string' ? d.request_id : null
        const ready = { status: 'ready', requestId, chunks, cites: citesOf(d.cites, chunks.length), more, moreCites: citesOf(d.more_cites, more.length), sources, followups: followupList }
        if (lkey) patchLog(lkey, { overview: ready })
        setSummary((cur) => (cur && cur.id === id ? { ...cur, ...ready } : cur))
        setFollowups(key, followupList, { source: 'summary' })
        if (pendingStrip.current && pendingStrip.current.id === id) pendingStrip.current = null
      })
      .catch(fail)
  }, [setSummary, setFollowups, showStrip, patchLog])

  // ── the staged wait line (R6 C) ──
  const clearWaitTimers = useCallback(() => { clearTimeout(timers.current.finding); clearTimeout(timers.current.lineHold); timers.current.finding = timers.current.lineHold = null }, [])
  /** "Thinking…" now; "Finding the right page…" after THINKING_MS unless an answer has moved the line on. */
  const startWait = useCallback(() => {
    clearWaitTimers()
    setWait(WAIT_THINKING)
    timers.current.finding = setTimeout(() => { timers.current.finding = null; setWait((w) => (w === WAIT_THINKING ? WAIT_FINDING : w)) }, THINKING_MS)
  }, [clearWaitTimers])
  const endWait = useCallback(() => { clearWaitTimers(); setWait(null) }, [clearWaitTimers])
  /** Show one line for a hold (an open action, the hand-off), then run `then`. */
  const holdLine = useCallback((text, then) => {
    clearWaitTimers()
    setWait(text)
    timers.current.lineHold = setTimeout(() => { timers.current.lineHold = null; setWait(null); then?.() }, HOLD_MS)
  }, [clearWaitTimers])

  // ── answer first, then travel ──
  const clearTravel = useCallback(() => { clearTimeout(timers.current.hold); clearTimeout(timers.current.travel); timers.current.hold = timers.current.travel = null }, [])
  /** The page changes: the bar docks under the header and the reply sits in the strip for a while.
   *  14 Oct: an answer that arrives while an overlay owns the history entry (the phone's Ask AI sheet, the menu, the
   *  full-screen map) replaces that entry, so Back from the destination does not reopen the overlay; `inPlace` (the
   *  full-screen map's mini box, QB-T3 B) opens another map in the same full-screen entry. */
  const arrive = useCallback((path, s, { inPlace = false, keepPopup = false } = {}) => {
    clearTravel()
    endWait()
    setTravel({ phase: 'idle', path: null })
    noteNavigation(path)
    assistantPath.current = path.split('#')[0]
    const overlay = overlayOf(liveState() ?? locStateRef.current)
    // 18 Oct: an answer asked in the viewer's Ask AI popup that opens another map keeps the popup open over it (the reply
    // and its overview land in the popup's history): the phone's sheet keeps its overlay on the new entry, the docked
    // bar's dropdown stays open; the full-screen map's mini box changes the map in place as before.
    const stay = keepPopup && !inPlace && isViewerMap(path)
    const pathname = path.split('?')[0].split('#')[0]
    keepPanelFor.current = stay ? pathname : null
    if (inPlace && overlay === 'full' && isViewerMap(path)) navigate(path, { replace: true, state: { [OVERLAY]: 'full' } })
    else if (stay && overlay === 'ask') navigate(path, { replace: true, state: { [OVERLAY]: 'ask' } })
    else if (overlay) navigate(path, { replace: true })
    else navigate(path)
    setMode(stay ? 'panel' : 'dock')
    const strip = { ...s, path: pathname }
    pathRef.current = strip.path
    if (stay || (inPlace && isViewerMap(path))) { pendingStrip.current = null; return }   // the popup shows the reply
    const sum = summaryRef.current
    // 13 Oct: when a summary is on its way (or here) it is the explanation; the strip shows only if it fails.
    if (sum && sum.id === s.id) pendingStrip.current = { id: s.id, strip }
    else showStrip(strip)
  }, [clearTravel, navigate, showStrip, endWait, noteNavigation])
  /** Hold (HOLD_MS), then arrive — by way of the ride-up (`ride`, the landing page) or a plain cut (the docked bar). */
  const beginTravel = useCallback((path, s, { ride = true, inPlace = false } = {}) => {
    clearTravel()
    setTravel({ phase: 'hold', path })
    timers.current.hold = setTimeout(() => {
      timers.current.hold = null
      if (!ride || prefersReducedMotion()) { arrive(path, s, { inPlace }); return }   // a cut instead of the ride-up, same end state
      setTravel({ phase: 'travel', path })
      timers.current.travel = setTimeout(() => arrive(path, s), TRAVEL_MS)
    }, HOLD_MS)
  }, [arrive, clearTravel])
  useEffect(() => () => { clearHandoffTimer(); clearTravel(); clearWaitTimers(); clearTimeout(timers.current.strip) }, [clearTravel, clearWaitTimers])

  const context = useCallback(() => {
    const viewer = parseViewerPath(location.pathname, location.search)
    return { path: location.pathname + location.search, viewer: viewer && !viewer.error ? viewer : null }
  }, [location])

  const send = useCallback(async (text, opts = {}) => {
    const q = (text || '').trim()
    if (!q || busy || travelling) return
    setBusy(true)
    setNarration(null)
    startWait()   // R6 C: "Thinking…", then "Finding the right page…"
    // A new question replaces the last answer's summary and strip (the page shows the wait line meanwhile).
    pendingStrip.current = null; setSummary(null); hideStrip()
    setMessages((m) => [...m, { id: nextId(), role: 'user', content: q }])
    // 18 Oct: the question joins the kept conversation at once (the popup shows it with the wait line under it); on the
    // viewer the Ask AI popup is where the answer shows, so the docked bar's dropdown opens with it.
    const lkey = logKey()
    pushLog({ key: lkey, ask: q, pending: true })
    const fromViewer = isViewerPage(location.pathname) && !opts.inPlace
    if (fromViewer) setMode('panel')
    // The gpt-6-luna narration, only while NARRATION is on: one short line in parallel with the answer (never delays it).
    if (NARRATION) {
      try {
        narrateAbort.current?.abort()
        const ac = new AbortController(); narrateAbort.current = ac
        fetch('/api/narrate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: q }), signal: ac.signal })
          .then((r) => (r.ok ? r.json() : null)).then((d) => { if (!ac.signal.aborted && d && typeof d.line === 'string' && d.line.trim()) setNarration(d.line.trim()) }).catch(() => {})
      } catch { /* no narration: the staged line shows */ }
    }
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
      if (!actions.some((a) => a.type === 'navigate')) { const op = actions.find((a) => a.type === 'open' && a.url); if (op) noteNavigation(op.url) }
      const navAction = actions.find((a) => a.type === 'navigate' && typeof a.path === 'string' && a.path.startsWith('/'))
      // 18 Oct: /data/visualize (Visualize Data's door) is the default map itself, so the overview is asked for under the map's address
      const nav = navAction ? { ...navAction, path: resolveDoor(navAction.path) } : null
      const opened = actions.find((a) => a.type === 'open' && typeof a.url === 'string')
      const destination = data.destination && typeof data.destination === 'object' ? data.destination : null
      const id = nextId()
      setMessages((m) => [...m, { id, role: 'assistant', content: data.reply || '', intent: data.intent, actions, alternatives, options: data.options }])
      patchLog(lkey, { pending: false, mid: id, reply: data.reply || '', intent: data.intent, actions, alternatives, options: Array.isArray(data.options) ? data.options : undefined,
        path: nav ? nav.path : null, overview: nav && !data.off_topic ? { status: 'pending' } : null })
      // 13 Oct (D1): a data ask carries a download offer for the page it opens (the OfferCard on /data/api); any other answer clears it.
      if (data.intent === 'download' && data.download && nav) noteDownload(id, data.download, nav.path)
      else clearDownload()
      if (data.intent === 'analysis') startHandoff(id, actions.find((a) => a.type === 'handoff')?.url || handoffUrl({ question: q, viewerPath: location.pathname }))
      const onLanding = location.pathname === '/' && !opts.docked   // sent from the scroll-docked bar: go at once, like an inner page
      if (nav) {
        const s = { id, reply: data.reply || '', alternatives: alternatives.slice(0, 2) }
        setWait(opening(destination?.title))   // "Opening Hurricane Lowell report…" for the hold and the travel (arrive() ends it)
        if (!data.off_topic) requestSummary(id, q, data, nav.path, lkey)   // the destination's AI summary, in parallel with the travel
        if (onLanding) beginTravel(nav.path, s)   // answer first, then the bar rides up
        else arrive(nav.path, s, { inPlace: Boolean(opts.inPlace), keepPopup: fromViewer })   // already docked: go now; the summary (or, failing that, the strip) explains
      } else if (data.intent === 'analysis') {
        holdLine(WAIT_HANDOFF, () => { if (!onLanding) setMode('panel') })   // one hold, then the card with its countdown
      } else if (opened) {
        holdLine(openingTab(destination?.title), () => { if (!onLanding) setMode('panel') })
      } else {
        endWait()   // info or clarify: the card (or the dropdown) is the answer
        if (!onLanding) setMode('panel')   // a reply with nowhere to go: the dropdown shows it
      }
    } catch (e) {
      endWait()
      const failed = 'I could not reach the navigator. Check the connection and try again.'
      const fid = nextId()
      setMessages((m) => [...m, { id: fid, role: 'assistant', content: failed }])
      patchLog(lkey, { pending: false, mid: fid, reply: failed, intent: 'info', actions: [], alternatives: [] })
    } finally { setBusy(false); narrateAbort.current?.abort(); narrateAbort.current = null }
  }, [busy, travelling, context, startHandoff, beginTravel, arrive, location.pathname, requestSummary, setSummary, hideStrip, startWait, endWait, holdLine, noteNavigation, pushLog, patchLog])

  /** R6 D / R5 C: the visitor chose a catalogued place themselves (a typeahead row, a did-you-mean tile): no AI call.
   *  `target` is { title, path | url } (a url starting with "/" counts as a path). The wait line says "Opening {title}…"
   *  for one hold (an external page opens in a new tab at once — browsers allow a new tab only close to the tap — and
   *  its line says so), then the page opens and the destination's overview flow runs with `ask` as the question and
   *  "You chose {title}." as the reply; for an external open nothing more. `echoAsk` records the typed text as the
   *  visitor's turn (a typeahead pick); a tile answers a question already in the conversation. */
  const choose = useCallback((target, { ask = '', echoAsk = false, docked = false, inPlace = false } = {}) => {
    if (busy || travelling || !target) return false
    const title = shortTitle(target.title) || 'the page'
    const raw = typeof target.path === 'string' && target.path.startsWith('/') ? target.path : (typeof target.url === 'string' && target.url.startsWith('/') ? target.url : null)
    const path = raw ? resolveDoor(raw) : null   // Visualize Data's door is the default map itself (18 Oct)
    const url = !path && typeof target.url === 'string' && /^https?:\/\//.test(target.url) ? target.url : null
    if (!path && !url) return false
    const q = (ask || '').trim()
    const reply = `You chose ${title}.`
    pendingStrip.current = null; setSummary(null); hideStrip()
    const userId = echoAsk && q ? nextId() : null
    const id = nextId()
    const actions = path ? [{ type: 'navigate', path }] : [{ type: 'open', url }]
    if (url && !openNewTab(url)) actions[0].blocked = true
    if (url) noteNavigation(url)
    setMessages((m) => [...m, ...(userId ? [{ id: userId, role: 'user', content: q }] : []), { id, role: 'assistant', content: reply, intent: 'navigate', actions, alternatives: [] }])
    historyRef.current = [...historyRef.current, ...(userId ? [{ role: 'user', content: q }] : []), { role: 'assistant', content: reply }]
    const lkey = logKey()
    pushLog({ key: lkey, ask: userId ? q : '', pending: false, mid: id, reply, intent: 'navigate', actions, alternatives: [], path: path || null, overview: path ? { status: 'pending' } : null })
    const onLanding = location.pathname === '/' && !docked
    setMode((m) => (m === 'panel' ? 'dock' : m))   // the dropdown gives way to the wait line
    if (url) { holdLine(openingTab(title), () => { if (actions[0].blocked && !onLanding) setMode('panel') }); return true }
    setWait(opening(title))
    requestSummary(id, q, { reply, intent: 'navigate', alternatives: [] }, path, lkey)
    beginTravel(path, { id, reply, alternatives: [] }, { ride: onLanding, inPlace })
    return true
  }, [busy, travelling, location.pathname, setSummary, hideStrip, holdLine, requestSummary, beginTravel, noteNavigation, pushLog])

  /** Put the cursor in the bar (the landing bar on /, the full-screen map's mini box, else the docked bar). */
  const open = useCallback(() => {
    const sels = location.pathname === '/' ? ['[data-testid="landing-assistant"] [data-testid="assistant-input"]', '[data-testid="assistant-bar"] [data-testid="assistant-input"]'] : ['[data-testid="mini-ask"] [data-testid="assistant-input"]', '[data-testid="assistant-bar"] [data-testid="assistant-input"]']
    for (const sel of sels) { const el = document.querySelector(sel); if (el) { el.focus(); return } }
  }, [location.pathname])
  const minimize = useCallback(() => setMode((m) => (m === 'panel' ? 'dock' : m)), [])
  // Start over: the hero bar on the landing page, the docked bar anywhere else. 18 Oct: Start over also clears the kept
  // conversation; the logo's reset of the landing page (item 13) passes { keepHistory: true } and leaves it for the visit.
  const reset = useCallback((opts) => {
    historyRef.current = []
    clearHandoffTimer(); setHandoff(null); clearTravel(); setTravel({ phase: 'idle', path: null }); hideStrip(); endWait()
    dismissSummary(); setFollowupsState({}); clearDownload()
    if (!(opts && opts.keepHistory === true)) setLog(() => [])
    setMessages([WELCOME]); setMode(location.pathname === '/' ? 'inline' : 'dock'); setEpoch((n) => n + 1)
  }, [location.pathname, clearTravel, hideStrip, dismissSummary, endWait, setLog])

  // Arriving on the landing page brings the conversation back into the hero bar; on an inner page the
  // bar is docked and any open dropdown closes (a navigation happened).
  useEffect(() => {
    if (location.pathname === '/') setMode('inline')
    else if (keepPanelFor.current && keepPanelFor.current === location.pathname) { keepPanelFor.current = null; setMode('panel') }   // the popup stays (18 Oct)
    else { keepPanelFor.current = null; setMode((m) => (m === 'dock' ? m : 'dock')) }
  }, [location.pathname])
  // A page change during the hold or the ride-up (the visitor clicked elsewhere) cancels the travel;
  // and the strip belongs to the page it was shown on.
  useEffect(() => {
    pathRef.current = location.pathname
    if (travel.phase !== 'idle' && location.pathname !== '/') { clearTravel(); setTravel({ phase: 'idle', path: null }); endWait() }
    if (strip && strip.path !== location.pathname) hideStrip()
    // and the summary belongs to the page the assistant opened: a route change it did not cause takes it away
    if (summaryRef.current && summaryRef.current.path !== location.pathname) dismissSummary()
    const offer = currentDownload()   // the download offer likewise (13 Oct)
    if (offer && offer.path !== location.pathname) clearDownload()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // A shared question link (/?ask=…) asks it once on arrival — on the landing page only: /download?ask=… is the
  // AI-prepared download's own address (13 Oct), not a question for the assistant.
  const askedRef = useRef(false)
  useEffect(() => {
    const ask = new URLSearchParams(location.search).get('ask')
    if (location.pathname !== '/' || !ask || askedRef.current) return
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

  // The wait line the bars show: the staged line; gpt-6-luna's narration instead while it is on and has arrived.
  const waitLine = wait ? (NARRATION && busy && narration ? narration : wait) : null
  const value = useMemo(() => ({
    messages, log, mode, busy, travelling, travel, strip, wait: waitLine, heroOut, setHeroOut, epoch, send, choose, open, minimize, setMode, reset,
    handoff, stayHere, settleHandoff, holdStrip, releaseStrip, hideStrip,
    summary, dismissSummary, followups, followupsFor, setFollowups, reportWrongPage, noteNavigation, wasAssistantNavigation, chipTemplate, pickChip,
  }), [messages, log, mode, busy, travelling, travel, strip, waitLine, heroOut, epoch, send, choose, open, minimize, reset, handoff, stayHere, settleHandoff, holdStrip, releaseStrip, hideStrip,
    summary, dismissSummary, followups, followupsFor, setFollowups, reportWrongPage, noteNavigation, wasAssistantNavigation, chipTemplate, pickChip])
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
