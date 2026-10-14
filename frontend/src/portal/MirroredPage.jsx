import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AISummary from '../assistant/AISummary'
import { useAssistantOptional } from '../assistant/AssistantProvider'
import NotFound from '../pages/NotFound'
import { originalFor } from '../site/original'
import { applyStyles, ensureFontAwesome, inlineStyles, loadTheme, themeNow } from './portalTheme'
import { usePortalPage } from './usePortalPage'
import './portal.css'

// A page of HCDP's, replicated (CONTRACT.md "Mirrored pages", 14 Oct; the user: "If you can see these subpages on HCDP's
// website, I need you to replicate them exactly. All we are adding is the AI overview at the top"). The copy comes from
// GET /api/portal/page (kept current by the backend's mirror job) and renders inside an OPEN SHADOW ROOT with HCDP's own
// theme, so it looks as it does on HCDP while our shell around it stays as it is: the header, the docked bar, the AI
// Overview at the top (the per-question one after a navigation, else the page's cached one), the grey title band — drawn
// here, outside the shadow root, only when HCDP has one — and the portal footer. Links to pages this site has are
// followed in place (no reload); everything else opens HCDP's address in a new tab (the sanitiser marked them).
export const SITE_TITLE = 'Hawaiʻi Climate Data Portal'

const cls = (list) => (Array.isArray(list) ? list : []).filter((c) => typeof c === 'string' && /^[A-Za-z0-9_-]+$/.test(c)).join(' ')

/** The markup inside the shadow root: HCDP's own page structure, so its theme's selectors apply as on HCDP. */
export function pageMarkup(record) {
  return `<div class="hcdp-body ${cls(record.body_class)}"><div id="content" class="site-content"><div id="content-inside" class="container no-sidebar">`
    + `<div id="primary" class="content-area"><div id="main" class="site-main"><article class="${cls(record.article_class) || 'page'}">${record.html || ''}</article>`
    + '</div></div></div></div></div>'
}

export function stickyHeight() {
  if (typeof window === 'undefined') return 0
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hcdp-sticky-h'))
  return Number.isFinite(v) ? v : 0
}

const cssEscape = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'))

/** The element a #hash names inside the shadow root (an id, else a WordPress anchor's name). */
export function hashTarget(root, hash) {
  if (!root || !hash || hash.length < 2) return null
  let id = hash.slice(1)
  try { id = decodeURIComponent(id) } catch { /* as typed */ }
  return root.getElementById?.(id) || root.querySelector?.(`[id="${cssEscape(id)}"], a[name="${cssEscape(id)}"]`) || null
}

/** Scroll the window so `el` sits just below the sticky header (header + docked bar). */
export function scrollBelowHeader(el) {
  if (!el?.getBoundingClientRect) return
  const top = el.getBoundingClientRect().top + window.scrollY - stickyHeight() - 12
  window.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
}

/** "13 Oct 2026" for an ISO timestamp (the "Copied from HCDP on …" note). */
export function copiedDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Pacific/Honolulu' })
}

/** The page's cached overview (QB-O1 B) shaped like the provider's per-question one, for AISummary's fallback. */
export function pageOverview(record, pathname) {
  const ov = record?.overview
  const chunks = Array.isArray(ov?.chunks) ? ov.chunks.filter((c) => typeof c === 'string' && c.trim()) : []
  if (!chunks.length) return null
  const sources = (Array.isArray(ov.sources) ? ov.sources : []).filter((s) => s && typeof s.url === 'string' && /^https?:\/\//.test(s.url) && s.title)
  const citesOf = (list, n) => Array.from({ length: n }, (_, i) => (Array.isArray(list?.[i]) ? list[i].filter((k) => Number.isInteger(k) && k >= 1 && k <= sources.length) : []))
  const more = Array.isArray(ov.more) ? ov.more.filter((c) => typeof c === 'string' && c.trim()) : []
  return {
    id: `page:${pathname}:${ov.generated_at || ''}`, path: pathname, page: true, status: 'ready', ask: '', reply: '', requestId: null,
    chunks, cites: citesOf(ov.cites, chunks.length), more, moreCites: citesOf(ov.more_cites, more.length), sources,
    followups: (Array.isArray(ov.followups) ? ov.followups : []).filter((f) => typeof f === 'string' && f.trim()).slice(0, 3), alternatives: [],
  }
}

/** document.title "<title> – Hawaiʻi Climate Data Portal" and the canonical link to HCDP's page, while this page shows. */
export function usePageHead(title, canonical) {
  useEffect(() => {
    if (!title && !canonical) return undefined
    if (title) document.title = `${title} – ${SITE_TITLE}`
    let link = null
    if (canonical) {
      link = document.head.querySelector('link[rel="canonical"]')
      if (!link) { link = document.createElement('link'); link.setAttribute('rel', 'canonical'); document.head.appendChild(link) }
      link.setAttribute('href', canonical)
    }
    return () => {
      if (title && document.title === `${title} – ${SITE_TITLE}`) document.title = SITE_TITLE
      if (link && link.getAttribute('href') === canonical) link.remove()
    }
  }, [title, canonical])
}

/** The copy itself, in an open shadow root. `onRender(root, record)` runs after each render (the Climate Tools ring). */
export function ShadowContent({ record, onRender }) {
  const hostRef = useRef(null)
  const navigate = useNavigate()
  const navRef = useRef(navigate)
  navRef.current = navigate
  const [theme, setTheme] = useState(() => themeNow())
  const [root, setRoot] = useState(null)
  useEffect(() => { if (!theme) loadTheme().then(setTheme) }, [theme])
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || !theme || !record) return
    const sr = host.shadowRoot || host.attachShadow({ mode: 'open' })
    const how = applyStyles(sr, theme, record.css)
    sr.innerHTML = (how === 'inline' ? inlineStyles(theme, record.css) : '') + pageMarkup(record)
    ensureFontAwesome(record.html)
    if (!host.dataset.wired) {
      host.dataset.wired = '1'
      sr.addEventListener('click', (e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        const a = e.target?.closest?.('a[href]')
        if (!a) return
        const href = a.getAttribute('href') || ''
        if (href.startsWith('#') && href.length > 1) {
          e.preventDefault()
          navRef.current({ hash: href })
          return
        }
        if (a.dataset.mirror === 'internal' || (href.startsWith('/') && !href.startsWith('//'))) {
          e.preventDefault()
          navRef.current(href)
        }
      })
    }
    setRoot(sr)
    onRender?.(sr, record)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, record])
  return <div ref={hostRef} className="hcdp-mirror-host" data-testid="mirror-host" data-ready={root ? 'true' : 'false'} />
}

function useHashScroll(root) {
  const { hash, key } = useLocation()   // the key too: a click on a #link to the hash already in the address scrolls again
  useEffect(() => {
    if (!root || !hash || hash.length < 2) return undefined
    let y1 = null
    const first = window.setTimeout(() => {
      const el = hashTarget(root, hash)
      if (el) { scrollBelowHeader(el); y1 = window.scrollY }
    }, 60)
    // once more after the pictures above it have taken their room, unless the visitor scrolled meanwhile
    const second = window.setTimeout(() => {
      const el = hashTarget(root, hash)
      if (el && y1 !== null && Math.abs(window.scrollY - y1) < 4) scrollBelowHeader(el)
    }, 450)
    return () => { window.clearTimeout(first); window.clearTimeout(second) }
  }, [root, hash, key])
}

function MissingCard({ hcdpUrl }) {
  return (
    <div className="hcdp-mirror-container hcdp-mirror-missing" data-testid="mirror-missing">
      <h1 className="mb-2 font-display text-2xl text-foreground">This page is on HCDP</h1>
      <p className="mb-4 text-sm text-subtle">This site has no copy of it yet.</p>
      <a href={hcdpUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-muted">
        Open it on HCDP<span aria-hidden="true">&nbsp;↗</span><span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  )
}

/**
 * One mirrored page. `path` is our address (the location's pathname by default); `top` renders above everything (the
 * AI-prepared download's offer card on /data/api); `after` below the copy (the Library's list); `onRender(root, record)`
 * after each render of the copy.
 */
export default function MirroredPage({ path: forced, top = null, after = null, onRender }) {
  const { pathname, search } = useLocation()
  const path = forced || pathname
  const state = usePortalPage(path)
  const record = state.status === 'ready' ? state.data : null
  const assistant = useAssistantOptional()
  const [root, setRoot] = useState(null)
  usePageHead(record?.title, record?.url)
  useHashScroll(root)
  const fallback = useMemo(() => pageOverview(record, pathname), [record, pathname])
  // The page's own follow-up asks go to the docked bar's ghost, unless an answer already brought some for this address.
  useEffect(() => {
    if (!assistant || !fallback?.followups?.length) return
    if (assistant.followupsFor?.(pathname, search)) return
    assistant.setFollowups?.(pathname + (search || ''), fallback.followups, { source: 'page' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallback, pathname])
  if (state.status === 'missing') return state.hcdpUrl ? <MissingCard hcdpUrl={state.hcdpUrl} /> : <NotFound />
  if (state.status === 'error') return <MissingCard hcdpUrl={originalFor(pathname, search).url} />
  const band = record?.band
  return (
    <div className="hcdp-mirror" data-testid="mirrored-page" data-slug={record?.slug || ''} data-source={record?.source || ''}>
      {top && <div className="hcdp-mirror-container hcdp-mirror-top">{top}</div>}
      <div className="hcdp-mirror-container hcdp-mirror-overview" data-testid="mirror-overview"><AISummary fallback={fallback} /></div>
      {band && (
        <div className="hcdp-band" data-testid="mirror-band"><div className="hcdp-mirror-container"><h1>{band}</h1></div></div>
      )}
      {record && !band && !record.has_h1 && <h1 className="sr-only">{record.title}</h1>}
      {!record && <div className="hcdp-mirror-loading" role="status" aria-label="Loading the page"><span className="hcdp-comet-ring" aria-hidden="true" /></div>}
      {record && <ShadowContent record={record} onRender={(sr, rec) => { setRoot(sr); onRender?.(sr, rec) }} />}
      {record?.copied_at && (
        <p className="hcdp-mirror-container hcdp-mirror-copied" data-testid="mirror-copied">
          Copied from HCDP on {copiedDate(record.copied_at)} · <a href={record.url} target="_blank" rel="noopener noreferrer">see the original<span className="sr-only"> (opens in a new tab)</span></a>
        </p>
      )}
      {record && after}
    </div>
  )
}

/** A route element: the mirrored page for the current address, remounted on every new address. */
export function Mirror(props) {
  const { pathname } = useLocation()
  return <MirroredPage key={pathname} {...props} />
}
