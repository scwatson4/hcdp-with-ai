import { useCallback } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import NotFound from '../pages/NotFound'
import OfferCard from '../download/OfferCard'
import { Mirror, scrollBelowHeader } from './MirroredPage'
import { ClimateSummaryEmbed, GuamEmbed, MesonetViewerEmbed, STORMS, StormEmbed } from './AppEmbed'

// The routes the mirror serves (CONTRACT.md "Mirrored pages", 14 Oct), with the URL state our pages had before the mirror
// kept working: /tools/<slug> rings that tool's tile on HCDP's own Climate Tools page; /mesonet?viewer|station|view is the
// native live viewer; /pacific#american-samoa and #guam and /extreme-events#<storm> (the old sections) land on the pages
// that replaced them; /extreme-events/kona-lows (both Kona lows) is the Extreme Events page.

// /tools/<slug> → the tile whose link (or name) is that tool's, on the mirrored page.
export const TILE_MATCH = {
  'rainfall-atlas': 'rainfall.geography.hawaii.edu',
  'ccvd-portfolios': 'ccvd.manoa.hawaii.edu',
  'h-rip': 'hrip.manoa.hawaii.edu',
  'groundwater-recharge': 'recharge.ikewai.org',
  'monthly-climate-summary': '/climate-summary',
  'sea-level-rise-viewer': 'slr-hawaii',
  'american-samoa-data-viewer': 'hcdp.github.io/ascdp',
  'soest-coastal-viewer': 'crc/slr-viewer',
  'climate-of-hawaii': 'climate-atlas',
  'vmap-vog-forecast': 'vmap/new',
  'vmap-fire-weather': 'vmap/fireweather',
  'avian-malaria': { text: 'Avian Malaria' },
}
export const RING_MS = 2200

/** The tile (its rounded picture box) for a tool slug inside the shadow root, or null. */
export function findTile(root, slug) {
  const m = TILE_MATCH[slug]
  if (!m || !root) return null
  let el = null
  if (typeof m === 'string') {
    el = [...root.querySelectorAll('a[href]')].find((a) => (a.getAttribute('href') || '').includes(m)) || null
  } else {
    el = [...root.querySelectorAll('h2, h3, h4, p')].find((h) => (h.textContent || '').includes(m.text)) || null
  }
  if (!el) return null
  let box = el
  while (box && box.parentElement && !(box.getAttribute?.('style') || '').includes('border-radius')) box = box.parentElement
  return box && (box.getAttribute?.('style') || '').includes('border-radius') ? box : el
}

export function ToolsRoute() {
  const { slug } = useParams()
  const onRender = useCallback((root) => {
    if (!slug) return
    window.setTimeout(() => {
      const tile = findTile(root, slug)
      // 13 Oct: when the assistant's AI overview tops the page, land on it (the tile is ringed below it); else centre the tile.
      const overview = document.querySelector('[data-testid="mirror-overview"] .hcdp-ai-summary[data-kind="answer"]')
      if (overview) scrollBelowHeader(overview)
      else tile?.scrollIntoView?.({ block: 'center' })
      if (tile) {
        tile.classList.add('hcdp-mirror-ring')
        window.setTimeout(() => tile.classList.remove('hcdp-mirror-ring'), RING_MS)
      }
    }, 80)
  }, [slug])
  return <Mirror path="/tools" onRender={onRender} />
}

export function PacificRoute() {
  const { hash } = useLocation()
  const legacy = { '#american-samoa': '/pacific/american-samoa', '#guam': '/pacific/guam' }[hash]
  return legacy ? <Navigate to={legacy} replace /> : <Mirror />
}

export function ExtremeEventsRoute() {
  const { hash } = useLocation()
  const legacy = { '#nolo': 'nolo', '#lowell': 'lowell', '#lala': 'lala' }[hash]
  return legacy ? <Navigate to={`/extreme-events/${legacy}`} replace /> : <Mirror />
}

export function StormRoute() {
  const { slug } = useParams()
  if (slug === 'kona-lows') return <Navigate to="/extreme-events" replace />
  return STORMS[slug] ? <StormEmbed slug={slug} /> : <NotFound />
}

export function MesonetRoute() {
  const { search } = useLocation()
  const q = new URLSearchParams(search)
  return q.get('viewer') || q.get('station') || q.get('view') ? <MesonetViewerEmbed /> : <Mirror />
}

/** HCDP's API page, with the AI-prepared download's offer card on top after a data ask (gallery D1 A). */
export function ApiRoute() {
  return <Mirror top={<OfferCard />} />
}

export { ClimateSummaryEmbed, GuamEmbed }
