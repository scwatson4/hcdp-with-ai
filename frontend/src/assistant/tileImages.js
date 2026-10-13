// R5 C (13 Oct): the picture on a did-you-mean tile. A tool's own portal picture (public/tools, by its slug); a map for
// a viewer address (the backend's /api/map.webp, the same rendering as the landing backdrops, over the hero's ocean
// fill); a storm's peak-day map for its report (the storms have no pictures of their own); the landing's fallback
// backdrop for everything else — and for a map that fails to load (an unpublished date).
import { TOOL_IMAGES } from '../pages/content/toolImages'
import { parseViewerPath } from '../viewer/urlGrammar'

export const FALLBACK_SRC = '/backdrop-fallback-light.webp'
export const FALLBACK = { src: FALLBACK_SRC, width: 1400, height: 930 }
export const OCEAN_FILL = 'bfe0f7'   // app.py OCEAN_FILLS[0], MapBackdrop's light ocean

/** The map pictures behind the storm reports: each storm's peak day (or month), as its Extreme Events section shows. */
export const STORM_MAPS = {
  lowell: ['rainfall', 'day', '2026-09-07', 'kauai'],
  lala: ['rainfall', 'day', '2026-08-15', 'hawaii'],
  nolo: ['rainfall', 'day', '2026-09-23', 'statewide'],
  'kona-low-1': ['rainfall', 'month', '2026-03', 'statewide'],
  'kona-low-2': ['rainfall', 'month', '2026-03', 'statewide'],
  'kona-lows': ['rainfall', 'month', '2026-03', 'statewide'],
}

export const mapImage = (dataset, period, date, extent) => ({
  src: `/api/map.webp?dataset=${dataset}&period=${period}&date=${date}&extent=${extent}&w=800&bg=${OCEAN_FILL}`,
  width: 800, height: 533, fallback: FALLBACK_SRC,
})

/** { src, width, height, fallback? } for an option { url | path, id? }. */
export function tileImageFor(option) {
  const target = String(option?.url || option?.path || '')
  const tool = target.match(/^\/tools\/([a-z0-9-]+)/)
  if (tool) return TOOL_IMAGES[tool[1]] || FALLBACK
  if (target.startsWith('/viewer/')) {
    const q = target.indexOf('?')
    const v = parseViewerPath(q < 0 ? target : target.slice(0, q), q < 0 ? '' : target.slice(q))
    if (v && !v.error) return mapImage(v.dataset, v.period, v.date, v.extent)
  }
  const storm = target.match(/^\/extreme-events(?:\/|#)([a-z0-9-]+)/)
  if (storm && STORM_MAPS[storm[1]]) return mapImage(...STORM_MAPS[storm[1]])
  return FALLBACK
}
