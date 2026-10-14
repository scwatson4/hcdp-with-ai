import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AISummary from '../assistant/AISummary'
import { useMediaQuery } from '../viewer/useMediaQuery'
import { HCDP } from '../site/nav'
import { usePageHead } from './MirroredPage'
import { EmbedCard } from '../pages/content/EmbedFrame'
import './portal.css'

// HCDP's app shells — pages that are one full-screen iframe (the storm reports, the Monthly Climate Summary, the Mesonet
// live data, the Guam viewer) — rebuilt here as native embeds of the same apps, looking as they do on HCDP: the app fills
// the window below the sticky header (header + docked bar). All we add is the AI overview at the top (after a navigation)
// and a slim strip with the title and "Open full screen ↗"; on touch screens a cover asks for one tap first, so a swipe
// scrolls the page instead of the map. The Climate Summary and the Mesonet viewer keep their URL sync: the apps post their
// route (origin-checked, from our frame only) and our address follows it with replaceState, as HCDP's pages do.
export const SUMMARY_APP = 'https://cherryleh.github.io/climate-summary/'
export const MESONET_APP = 'https://cherryleh.github.io/mesonet'
export const CHERRY_ORIGIN = 'https://cherryleh.github.io'

export const STORMS = {
  nolo: { route: 'hurricane-nolo', title: 'Hurricane Nolo', hcdp: `${HCDP}/hurricane-nolo/` },
  lowell: { route: 'hurricane-lowell', title: 'Hurricane Lowell', hcdp: `${HCDP}/hurricane-lowell/` },
  lala: { route: 'hurricane-lala', title: 'Hurricane Lala', hcdp: `${HCDP}/hurricane-lala/` },
  'kona-low-1': { route: 'storm-viewer', title: 'Kona Low Storm (#1)', hcdp: `${HCDP}/2026-kona-low-1/` },
  'kona-low-2': { route: 'storm-viewer-march2026-2', title: 'Kona Low Storm (#2)', hcdp: `${HCDP}/2026-kona-low-2/` },
}

/** One app, full window height under the sticky header, with the strip and (on touch screens) the tap-to-interact cover. */
export function AppEmbed({ title, src, openHref, canonical, origin = null, onMessage = null, testid = 'app-embed' }) {
  const coarse = useMediaQuery('(pointer: coarse)')
  const narrow = useMediaQuery('(max-width: 767px)')   // M6 A (14 Oct): no desktop app squeezed into a phone
  const [armed, setArmed] = useState(false)
  const frameRef = useRef(null)
  usePageHead(title, canonical)
  useEffect(() => {
    if (!onMessage || !origin) return undefined
    const onMsg = (e) => {
      if (e.origin !== origin) return
      const win = frameRef.current?.contentWindow
      if (e.source && win && e.source !== win) return
      onMessage(e.data)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [onMessage, origin])
  // M6 A, the user's pick for phones: below 768 px the app opens full screen in a new tab from a card (EmbedFrame's
  // EmbedCard) instead of running at 358 px (the 8 Oct audit: the Mesonet app's "Accept" clipped, nested scrolling).
  if (narrow) {
    return (
      <div className="hcdp-embed" data-testid={testid}>
        <div className="hcdp-mirror-container hcdp-embed-overview"><AISummary /></div>
        <div className="hcdp-mirror-container py-4"><EmbedCard title={title} href={openHref || src} /></div>
      </div>
    )
  }
  return (
    <div className="hcdp-embed" data-testid={testid}>
      <div className="hcdp-mirror-container hcdp-embed-overview"><AISummary /></div>
      <div className="hcdp-embed-strip" data-testid="embed-strip">
        <h1>{title}</h1>
        <a href={openHref || src} target="_blank" rel="noopener noreferrer" data-testid="embed-fullscreen">
          Open full screen<span aria-hidden="true">&nbsp;↗</span><span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
      <div className="hcdp-embed-frame">
        <iframe ref={frameRef} src={src} title={title} allow="fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" data-testid="embed-frame" />
        {coarse && !armed && (
          <button type="button" className="hcdp-embed-cover" onClick={() => setArmed(true)} aria-label={`Tap to interact with ${title}`} data-testid="embed-cover">
            <span>Tap to interact</span>
          </button>
        )}
      </div>
    </div>
  )
}

// ----- the storm reports ---------------------------------------------------------------------------------------------
export function StormEmbed({ slug }) {
  const storm = STORMS[slug]
  const src = `${SUMMARY_APP}#/${storm.route}`
  return <AppEmbed key={slug} title={storm.title} src={src} canonical={storm.hcdp} testid="storm-embed" />
}

export function GuamEmbed() {
  return <AppEmbed title="Guam Data Viewer" src="https://hcdp.github.io/gcdp/" canonical={`${HCDP}/guam-data-viewer/`} testid="guam-embed" />
}

// ----- address ⇄ app route ------------------------------------------------------------------------------------------------
const YEAR = /^\d{4}$/
const MONTH = /^(1[0-2]|[1-9])$/

/** The Monthly Climate Summary app's address for /climate-summary?year&month. */
export function summarySrc(search) {
  const q = new URLSearchParams(search)
  const y = q.get('year') || ''
  const m = q.get('month') || ''
  return YEAR.test(y) && MONTH.test(m) ? `${SUMMARY_APP}#/?year=${y}&month=${m}` : `${SUMMARY_APP}#/`
}

/** The app's route hash ('#/?year=2026&month=8') → our query ('?year=2026&month=8'), or '' for its other routes. */
export function summarySearchFromHash(hash) {
  const h = String(hash || '').replace(/^#/, '').replace(/^\//, '')
  const [route, q = ''] = h.split('?')
  if (route.replace(/\//g, '')) return ''
  const p = new URLSearchParams(q)
  const y = p.get('year') || ''
  const m = String(Number(p.get('month') || '') || '')
  return YEAR.test(y) && MONTH.test(m) ? `?year=${y}&month=${m}` : ''
}

const VIEW = /^[a-z0-9-]{1,40}$/
const STATION = /^[A-Za-z0-9_.-]{1,20}$/

/** The live Mesonet app's address for our /mesonet?viewer=live&station&view (HCDP's: ?source=iframe#/<view>?id=<station>). */
export function mesonetSrc(search) {
  const q = new URLSearchParams(search)
  const viewer = q.get('viewer') || 'live'
  const station = STATION.test(q.get('station') || '') ? q.get('station') : ''
  const view = VIEW.test(q.get('view') || '') ? q.get('view') : ''
  if (viewer === 'app') return station ? `https://hawaiimesonet.app/station/${encodeURIComponent(station)}` : 'https://hawaiimesonet.app/'
  if (viewer === 'nolo') return `${SUMMARY_APP}#/nolo-viewer`
  const v = view || 'dashboard'
  const withId = station && (v === 'dashboard' || v === 'graphing')
  return `${MESONET_APP}/?source=iframe#/${v}${withId ? `?id=${encodeURIComponent(station)}` : ''}`
}

/** The live app's posted hash ('#/dashboard?id=0115') → our query ('?viewer=live&station=0115&view=dashboard'). */
export function mesonetSearchFromHash(hash) {
  const h = String(hash || '').replace(/^#/, '').replace(/^\//, '')
  const [route, q = ''] = h.split('?')
  const view = route.split('/')[0]
  const id = new URLSearchParams(q).get('id') || ''
  const p = new URLSearchParams({ viewer: 'live' })
  if (STATION.test(id)) p.set('station', id)
  if (VIEW.test(view)) p.set('view', view)
  return `?${p.toString()}`
}

/** Keep an app's src steady while our address follows it: a change that came from the frame never reloads the frame. */
function useSyncedSrc(computeSrc) {
  const location = useLocation()
  const navigate = useNavigate()
  const [src, setSrc] = useState(() => computeSrc(location.search))
  const fromFrame = useRef(null)
  const locRef = useRef(location)
  locRef.current = location
  useEffect(() => {
    if (fromFrame.current !== null && fromFrame.current === location.search) return
    fromFrame.current = null
    setSrc(computeSrc(location.search))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])
  const follow = useCallback((search) => {
    const loc = locRef.current
    if (search === loc.search) return
    fromFrame.current = search
    navigate({ pathname: loc.pathname, search }, { replace: true })
  }, [navigate])
  return [src, follow]
}

export function ClimateSummaryEmbed() {
  const [src, follow] = useSyncedSrc(summarySrc)
  const onMessage = useCallback((data) => {
    if (!data || data.type !== 'routeChange' || typeof data.hash !== 'string') return
    follow(summarySearchFromHash(data.hash))
  }, [follow])
  return <AppEmbed title="Monthly Climate Summary" src={src} canonical={`${HCDP}/climate-summary/`} origin={CHERRY_ORIGIN} onMessage={onMessage} testid="summary-embed" />
}

const MESONET_VIEWERS = {
  live: { title: 'Hawaiʻi Mesonet Live Data Access', canonical: `${HCDP}/hawaii-mesonet-data/` },
  app: { title: 'Hawaiʻi Mesonet app', canonical: 'https://hawaiimesonet.app/' },
  nolo: { title: 'Tropical Storm Nolo Mesonet Viewer', canonical: `${HCDP}/nolo-mesonet-viewer/` },
}

export function MesonetViewerEmbed() {
  const { search } = useLocation()
  const viewer = MESONET_VIEWERS[new URLSearchParams(search).get('viewer')] ? new URLSearchParams(search).get('viewer') : 'live'
  const [src, follow] = useSyncedSrc(mesonetSrc)
  const onMessage = useCallback((data) => {
    if (typeof data !== 'string' || !data.startsWith('#')) return
    follow(mesonetSearchFromHash(data))
  }, [follow])
  const live = viewer === 'live'
  const open = live ? src.replace('/?source=iframe', '/') : src
  return <AppEmbed key={viewer} title={MESONET_VIEWERS[viewer].title} src={src} openHref={open} canonical={MESONET_VIEWERS[viewer].canonical}
    origin={live ? CHERRY_ORIGIN : null} onMessage={live ? onMessage : null} testid="mesonet-embed" />
}
