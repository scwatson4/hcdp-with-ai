import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAssistantOptional } from '../assistant/AssistantProvider'
import { postFeedback } from './api'
import { exchangeFields, lastExchange, overviewExchange } from './exchange'
import { LIMITS, clip, featureForPath } from './features'
import { clearHighlight, flashQuote } from './highlight'
import { readReviewerName, writeReviewerName } from './reviewer'

// The review-period feedback (F1–F5, picked 13 Oct): the HCDP team reviews the site and says what they think of the AI's
// answers, its navigation results, its overviews and the revamped features — the same ability the AI data analysis
// interface has. Three ways in (F1 A): 👍/👎 on every AI answer and AI overview, a "Copy · Give feedback" pill over any
// selected text, and the right-edge "Give feedback" tab. They all end in one composer (F2 A) — a right-side panel on
// desktop, a bottom sheet on phones — whose header also opens "My feedback" and "Others" (F3 A). 👍 is one tap; 👎 first
// asks which page was wanted (F5 A, the "Wrong page?" chooser with "Other…") and then opens the composer with it attached.
// The reviewer's name is remembered in this browser for the review period (F4 A, reviewer.js); nothing else is kept.
const Ctx = createContext(null)

export const TOAST_MS = 3200

/** The page's title for the composer: the viewer's descriptive tab title, else the page's first heading, else the tab title. */
export function pageTitle() {
  if (typeof document === 'undefined') return ''
  const tab = (document.title || '').trim()
  const generic = /^Hawai.i Climate Data Portal$/.test(tab)
  if (tab && !generic) return clip(tab, LIMITS.title)
  const h1 = document.querySelector('#main h1')?.textContent?.trim()
  return clip(h1 || tab, LIMITS.title)
}

export function FeedbackProvider({ children }) {
  const assistant = useAssistantOptional()
  const location = useLocation()
  const navigate = useNavigate()
  const [panel, setPanel] = useState(null)        // { view: 'compose' | 'mine' | 'others', seq, draft } or null
  const [toast, setToast] = useState(null)        // { id, text, tone: 'ok' | 'error', action: { label, run } | null }
  const [name, setNameState] = useState(readReviewerName)
  const seq = useRef(0)
  const opener = useRef(null)                     // where the focus goes back to when the panel closes
  const textDraft = useRef('')                    // the composer's words survive a close (not a send)
  const toastTimer = useRef(null)
  const stopFlash = useRef(() => {})
  const live = useRef({ assistant, location })
  live.current = { assistant, location }

  const currentPage = useCallback(() => {
    const { pathname, search } = live.current.location
    return { path: clip(pathname + (search || ''), LIMITS.path), title: pageTitle() }
  }, [])

  /** The exchange the feedback is about when nobody named one: the overview on this page, else the newest answer. */
  const autoExchange = useCallback(() => {
    const { assistant: a, location: loc } = live.current
    const s = a?.summary
    if (s && s.path === loc.pathname) { const ex = overviewExchange(s); if (ex) return ex }
    return lastExchange(a?.messages || [])
  }, [])

  const dismissToast = useCallback(() => { clearTimeout(toastTimer.current); setToast(null) }, [])
  const say = useCallback((text, { tone = 'ok', action = null, ms = action ? TOAST_MS + 1800 : TOAST_MS } = {}) => {
    clearTimeout(toastTimer.current)
    const id = Date.now() + Math.random()
    setToast({ id, text, tone, action })
    toastTimer.current = setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), ms)
  }, [])
  useEffect(() => () => { clearTimeout(toastTimer.current); stopFlash.current() }, [])

  /** Where the focus returns on close: `el` when given (the 👎 whose chooser row has gone by then), else the focused element. */
  const rememberOpener = (el = null) => {
    const active = el || (typeof document !== 'undefined' ? document.activeElement : null)
    opener.current = active && active !== document.body ? active : null
  }

  /** Open the composer. `kind`: thumbs | selection | tab; `exchange` undefined → the automatic one, null → none;
   *  `opener` the element the focus goes back to on close. */
  const openComposer = useCallback((opts = {}) => {
    rememberOpener(opts.opener || null)
    seq.current += 1
    const exchange = opts.exchange !== undefined ? opts.exchange : autoExchange()
    setPanel({
      view: 'compose', seq: seq.current,
      draft: {
        kind: opts.kind || 'tab', rating: opts.rating || null, feature: opts.feature || featureForPath(live.current.location.pathname),
        quote: opts.quote ? clip(opts.quote, LIMITS.quote) : '', range: opts.range || null, exchange: exchange || null,
        wanted: opts.wanted || null, page: opts.page || currentPage(), text: textDraft.current,
      },
    })
  }, [autoExchange, currentPage])

  /** Open the panel on a view; 'compose' starts a fresh tab-kind draft unless one is open. */
  const openPanel = useCallback((view = 'compose') => {
    if (view === 'compose') { openComposer({ kind: 'tab' }); return }
    rememberOpener()
    setPanel((p) => ({ ...(p || { seq: (seq.current += 1), draft: null }), view }))
  }, [openComposer])

  const setView = useCallback((view) => {
    if (view === 'compose') {
      setPanel((p) => (p && p.draft ? { ...p, view } : p))
      if (!panel?.draft) openComposer({ kind: 'tab' })
      return
    }
    setPanel((p) => (p ? { ...p, view } : p))
  }, [panel, openComposer])

  const closePanel = useCallback(({ restoreFocus = true } = {}) => {
    setPanel(null)
    clearHighlight()
    const el = opener.current
    opener.current = null
    // after the re-render: the tab is visible again by then
    if (restoreFocus && el && typeof el.focus === 'function') setTimeout(() => { if (el.isConnected) { try { el.focus({ preventScroll: true }) } catch { el.focus() } } }, 0)
  }, [])

  const rememberText = useCallback((t) => { textDraft.current = t }, [])

  const setName = useCallback((n) => { const v = writeReviewerName(n); setNameState(v); return v }, [])

  /** 👍: one tap, the exchange attached; a toast says thanks. Resolves to whether it was stored. */
  const sendThumbUp = useCallback(async ({ feature = 'answer', exchange = null } = {}) => {
    try {
      await postFeedback({ kind: 'thumbs', rating: 'up', feature, page: currentPage(), quote: null, ...exchangeFields(exchange), wanted: null, text: '', reviewer_name: name })
      say('Thanks')
      return true
    } catch (e) {
      say(e?.message || 'That could not be sent. Try again in a moment.', { tone: 'error' })
      return false
    }
  }, [currentPage, name, say])

  /** The composer's Send. `item` is the API body without the reviewer's name, which is remembered here first. */
  const submit = useCallback(async (item, reviewerName) => {
    const who = setName(reviewerName)
    await postFeedback({ ...item, reviewer_name: who })   // throws: the composer shows the error and keeps the draft
    textDraft.current = ''
    closePanel()
    say('Thanks — your feedback is in.', { action: { label: 'My feedback', run: () => openPanel('mine') } })
  }, [setName, closePanel, say, openPanel])

  /** "My feedback" / "Others": back to the page an item is about, and to the quoted passage on it. */
  const goTo = useCallback((item) => {
    const path = typeof item?.page_path === 'string' ? item.page_path : ''
    closePanel({ restoreFocus: false })
    stopFlash.current()
    const { pathname, search } = live.current.location
    if (path.startsWith('/') && path !== pathname + (search || '')) navigate(path)
    if (item?.quote) stopFlash.current = flashQuote(item.quote)
  }, [closePanel, navigate])

  const value = useMemo(() => ({
    panel, openComposer, openPanel, setView, closePanel, rememberText, sendThumbUp, submit, toast, say, dismissToast, name, setName, goTo, currentPage,
  }), [panel, openComposer, openPanel, setView, closePanel, rememberText, sendThumbUp, submit, toast, say, dismissToast, name, setName, goTo, currentPage])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useFeedback() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useFeedback outside FeedbackProvider')
  return v
}

/** The feedback context, or null when a component renders outside it (pages render on their own in tests). */
export function useFeedbackOptional() {
  return useContext(Ctx)
}
