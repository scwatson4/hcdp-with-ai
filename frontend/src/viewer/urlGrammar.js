// The deep-link grammar for the climate viewer (see CONTRACT.md). Single source
// of truth for parsing, formatting and canonicalising; the assistant, the
// backend (navigator.py mirrors it) and the viewer all agree through these
// functions.
//
//   /viewer/{dataset}/{period}/{date}/{extent}[?options]
//
// The path is the map's identity; the query carries what the map shows
// (display options, layers, the selected station, the camera) in ONE fixed
// order with defaults omitted, so one view has one spelling. Dates: YYYY-MM or
// YYYY-MM-DD; the parser also accepts month names in either order
// ("october/21/2025", "2025/october/21", "oct/2025") and a few aliases for
// datasets, periods and places, so a hand-typed link still resolves — and
// canonicalize() rewrites it to the one true spelling.

import { NAMED_RAMPS } from './map/ramps'

export const DATASETS = {
  rainfall: { label: 'Rainfall', periods: ['month', 'day'], units: 'mm', api: { datatype: 'rainfall', production: 'new' }, stations: { datatype: 'rainfall', production: 'new' } },
  'rainfall-legacy': { label: 'Rainfall (legacy, 1920–2012)', periods: ['month'], units: 'mm', api: { datatype: 'rainfall', production: 'legacy' } },
  'temperature-mean': { label: 'Mean temperature', periods: ['month', 'day'], units: '°C', api: { datatype: 'temperature', aggregation: 'mean' }, stations: { datatype: 'temperature', aggregation: 'mean' } },
  'temperature-max': { label: 'Maximum temperature', periods: ['month', 'day'], units: '°C', api: { datatype: 'temperature', aggregation: 'max' }, stations: { datatype: 'temperature', aggregation: 'max' } },
  'temperature-min': { label: 'Minimum temperature', periods: ['month', 'day'], units: '°C', api: { datatype: 'temperature', aggregation: 'min' }, stations: { datatype: 'temperature', aggregation: 'min' } },
  humidity: { label: 'Relative humidity', periods: ['day'], units: '%', api: { datatype: 'relative_humidity' }, stations: { datatype: 'relative_humidity' } },
  ndvi: { label: 'Vegetation (NDVI)', periods: ['day'], units: '', api: { datatype: 'ndvi_modis' } },
  ignition: { label: 'Ignition probability', periods: ['day'], units: '', api: { datatype: 'ignition_probability' } },
  'ignition-lead-1': { label: 'Ignition probability, 1 day ahead', periods: ['day'], units: '', api: { datatype: 'ignition_probability', lead: 'lead01' } },
  'ignition-lead-2': { label: 'Ignition probability, 2 days ahead', periods: ['day'], units: '', api: { datatype: 'ignition_probability', lead: 'lead02' } },
  'ignition-lead-3': { label: 'Ignition probability, 3 days ahead', periods: ['day'], units: '', api: { datatype: 'ignition_probability', lead: 'lead03' } },
  'spi-1': { label: 'Drought index (SPI, 1 month)', periods: ['month'], units: '', api: { datatype: 'spi', timescale: 'timescale001' } },
  'spi-3': { label: 'Drought index (SPI, 3 months)', periods: ['month'], units: '', api: { datatype: 'spi', timescale: 'timescale003' } },
  'spi-6': { label: 'Drought index (SPI, 6 months)', periods: ['month'], units: '', api: { datatype: 'spi', timescale: 'timescale006' } },
  'spi-9': { label: 'Drought index (SPI, 9 months)', periods: ['month'], units: '', api: { datatype: 'spi', timescale: 'timescale009' } },
  'spi-12': { label: 'Drought index (SPI, 12 months)', periods: ['month'], units: '', api: { datatype: 'spi', timescale: 'timescale012' } },
  'spi-24': { label: 'Drought index (SPI, 24 months)', periods: ['month'], units: '', api: { datatype: 'spi', timescale: 'timescale024' } },
  'spi-36': { label: 'Drought index (SPI, 36 months)', periods: ['month'], units: '', api: { datatype: 'spi', timescale: 'timescale036' } },
  'spi-48': { label: 'Drought index (SPI, 48 months)', periods: ['month'], units: '', api: { datatype: 'spi', timescale: 'timescale048' } },
  'spi-60': { label: 'Drought index (SPI, 60 months)', periods: ['month'], units: '', api: { datatype: 'spi', timescale: 'timescale060' } },
}

// Spellings people type (and links already published) → the canonical slug.
export const DATASET_ALIASES = {
  rain: 'rainfall', precipitation: 'rainfall', precip: 'rainfall', 'legacy-rainfall': 'rainfall-legacy', 'rainfall-1920': 'rainfall-legacy',
  temperature: 'temperature-mean', temp: 'temperature-mean', 'temp-mean': 'temperature-mean', tmean: 'temperature-mean',
  'temp-max': 'temperature-max', tmax: 'temperature-max', 'temperature-maximum': 'temperature-max',
  'temp-min': 'temperature-min', tmin: 'temperature-min', 'temperature-minimum': 'temperature-min',
  rh: 'humidity', 'relative-humidity': 'humidity', vegetation: 'ndvi', fire: 'ignition', 'ignition-probability': 'ignition', 'fire-risk': 'ignition',
  'ignition-1': 'ignition-lead-1', 'ignition-2': 'ignition-lead-2', 'ignition-3': 'ignition-lead-3', 'ignition+1': 'ignition-lead-1', 'ignition+2': 'ignition-lead-2', 'ignition+3': 'ignition-lead-3',
  spi: 'spi-3', drought: 'spi-3',
  ...Object.fromEntries([1, 3, 6, 9, 12, 24, 36, 48, 60].flatMap((n) => [[`spi${n}`, `spi-${n}`], [`spi-${String(n).padStart(2, '0')}`, `spi-${n}`], [`spi-${String(n).padStart(3, '0')}`, `spi-${n}`]])),
}
export const PERIOD_ALIASES = { monthly: 'month', months: 'month', m: 'month', daily: 'day', days: 'day', d: 'day' }
export const EXTENT_ALIASES = {
  state: 'statewide', all: 'statewide', hawaii: 'hawaii', 'hawaii-island': 'hawaii', bigisland: 'hawaii', 'big-island': 'hawaii', bi: 'hawaii', 'hawaiʻi': 'hawaii', 'hawaiʻi-island': 'hawaii',
  oa: 'oahu', 'oʻahu': 'oahu', ka: 'kauai', 'kauaʻi': 'kauai', mn: 'maui', 'maui-county': 'maui', 'molokaʻi': 'molokai', 'lānaʻi': 'lanai', 'lanaʻi': 'lanai',
}

// extent → the HCDP API extent code and a map view. mn is Maui County (Maui,
// Molokaʻi, Lānaʻi share one grid), so those three differ only in the view.
export const EXTENTS = {
  statewide: { label: 'Statewide', api: 'statewide', center: [20.6, -157.4], zoom: 7 },
  hawaii: { label: 'Hawaiʻi Island', api: 'bi', center: [19.6, -155.5], zoom: 9 },
  maui: { label: 'Maui', api: 'mn', center: [20.8, -156.3], zoom: 10 },
  molokai: { label: 'Molokaʻi', api: 'mn', center: [21.14, -157.0], zoom: 11 },
  lanai: { label: 'Lānaʻi', api: 'mn', center: [20.83, -156.92], zoom: 11 },
  oahu: { label: 'Oʻahu', api: 'oa', center: [21.48, -157.98], zoom: 10 },
  kauai: { label: 'Kauaʻi', api: 'ka', center: [22.06, -159.5], zoom: 10 },
}

// ── the query layer: what the map shows ─────────────────────────────────────
// One fixed order; defaults are omitted. The backend's navigator.py validates
// the same keys and values.
export const QUERY_KEYS = ['ramp', 'scale', 'range', 'log', 'units', 'basemap', 'opacity', 'layers', 'station', 'pin', 'ts', 'tsp', 'compare', 'lat', 'lng', 'z']
export const RAMP_NAMES = Object.keys(NAMED_RAMPS)
export const BASEMAP_KEYS = ['satellite', 'street', 'imagery', 'topo', 'relief', 'light']
export const DEFAULT_BASEMAP = 'satellite'
export const LAYER_KEYS = ['stations', 'outline']   // reserved for later: boundaries, ahupuaa, moku
export const DEFAULT_OPACITY = 75
export const UNIT_KEYS = ['mm', 'in', 'c', 'f']
// Hawaiʻi and its waters: a pin or a camera outside this box is not ours.
export const HAWAII_BOX = { south: 18.5, north: 22.5, west: -160.5, east: -154.5 }
const SKN_RE = /^\d{1,5}(\.\d{1,3})?$/

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const monthIndex = (s) => {
  const t = String(s || '').toLowerCase()
  const i = MONTHS.findIndex((m) => m === t || m.slice(0, 3) === t)
  return i >= 0 ? i + 1 : null
}
const pad = (n) => String(n).padStart(2, '0')
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
export const isRealDate = (iso) => { const p = parseDateSegments([iso]); return p === iso }

// Accepts: 2025-10-21 · 2025-10 · 2025/10/21 · october/21/2025 · 2025/october/21 · oct/2025 · 2025/oct
export function parseDateSegments(segs, { calendar = true } = {}) {
  const parts = segs.flatMap((s) => String(s).split(/[-/]/)).filter(Boolean)
  if (!parts.length) return null
  let y = null, m = null, d = null
  const nums = [], names = []
  for (const p of parts) (monthIndex(p) ? names : nums).push(p)
  if (names.length === 1) m = monthIndex(names[0])
  for (const n of nums) {
    if (!/^\d+$/.test(n)) return null
    const v = Number(n)
    if (n.length === 4) y = v
    else if (m == null && v >= 1 && v <= 12 && nums.length >= 2 && y == null && names.length === 0) { m = v }
    else if (m == null && v >= 1 && v <= 12 && (y != null || nums.indexOf(n) === 1)) m = v
    else if (v >= 1 && v <= 31) d = v
  }
  // ISO-like numeric: y-m[-d] already handled; numeric m/d/y order (10/21/2025)
  if (y == null) return null
  if (m == null) return null
  if (d != null && (d < 1 || d > 31)) return null
  if (calendar && d != null && d > daysInMonth(y, m)) return null   // 2026-02-30 is not a date
  return d != null ? `${y}-${pad(m)}-${pad(d)}` : `${y}-${pad(m)}`
}

const lower = (s) => decodeURIComponent(String(s || '')).toLowerCase()
export const canonicalDataset = (s) => { const t = lower(s); return DATASETS[t] ? t : (DATASET_ALIASES[t] || null) }
export const canonicalPeriod = (s) => { const t = lower(s); return ['month', 'day'].includes(t) ? t : (PERIOD_ALIASES[t] || null) }
export const canonicalExtent = (s) => { const t = lower(s); return EXTENTS[t] ? t : (EXTENT_ALIASES[t] || null) }

const inBox = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= HAWAII_BOX.south && lat <= HAWAII_BOX.north && lng >= HAWAII_BOX.west && lng <= HAWAII_BOX.east

// ── the colour scale's modifiers ────────────────────────────────────────────
// ramp=viridis-r   the ramp run the other way (the suffix travels on the ramp key)
// range=lo..hi     the legend locked to lo..hi in the dataset's native units (mm,
//                  °C, …): at most two decimals, lo < hi; absent = the portal's scale
// log=1            pseudo-log scaling of the colours: sign(v)·ln(1+|v|)

/** "viridis" or "viridis-r" → { ramp, reverse } for a ramp ramps.js knows, else null. */
export function parseRamp(text) {
  const t = String(text || '').toLowerCase()
  const reverse = t.endsWith('-r')
  const ramp = reverse ? t.slice(0, -2) : t
  return RAMP_NAMES.includes(ramp) ? { ramp, reverse } : null
}
export const formatRamp = (ramp, reverse = false) => (RAMP_NAMES.includes(ramp) ? `${ramp}${reverse ? '-r' : ''}` : null)

const RANGE_NUM = '-?\\d{1,7}(?:\\.\\d{1,2})?'
const LEGEND_RANGE_RE = new RegExp(`^(${RANGE_NUM})\\.\\.(${RANGE_NUM})$`)

/** "lo..hi" (two numbers, up to two decimals) → { min, max }; swapped ends are
 *  put in order, equal ends and anything else are null. */
export function parseLegendRange(text) {
  const m = LEGEND_RANGE_RE.exec(String(text || ''))
  if (!m) return null
  let min = Number(m[1]), max = Number(m[2])
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return null
  if (min > max) [min, max] = [max, min]
  return { min, max }
}
/** A legend bound as the URL spells it: at most two decimals, no trailing zeros ("12.50" → "12.5", "20.00" → "20"). */
export const formatLegendNumber = (n) => String(Number(Number(n).toFixed(2)))
export const formatLegendRange = (r) => (r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.min < r.max ? `${formatLegendNumber(r.min)}..${formatLegendNumber(r.max)}` : null)

/** A time-series range "YYYY-MM-DD..YYYY-MM-DD" or "YYYY-MM..YYYY-MM" (both ends real, start ≤ end). */
export function parseRange(text) {
  const m = /^(\d{4}-\d{2}(?:-\d{2})?)\.\.(\d{4}-\d{2}(?:-\d{2})?)$/.exec(String(text || ''))
  if (!m || m[1].length !== m[2].length || !isRealDate(m[1]) || !isRealDate(m[2])) return null
  const [start, end] = m[1] <= m[2] ? [m[1], m[2]] : [m[2], m[1]]
  return { start, end }
}
export const formatRange = (r) => (r && r.start && r.end ? `${r.start}..${r.end}` : null)

/** The query options as the viewer understands them (unknown keys and bad values are dropped). */
export function parseViewerOptions(search = '', period = 'day') {
  const q = new URLSearchParams(search)
  const opts = {}
  const ramp = parseRamp(q.get('ramp'))
  if (ramp) { opts.ramp = ramp.ramp; if (ramp.reverse) opts.reverse = true }
  if (q.get('scale') === 'extreme') opts.scale = 'extreme'
  const range = parseLegendRange(q.get('range'))
  if (range) opts.range = range
  if (q.get('log') === '1') opts.log = true
  if (q.get('units') && UNIT_KEYS.includes(q.get('units').toLowerCase())) opts.units = q.get('units').toLowerCase()
  if (q.get('basemap') && BASEMAP_KEYS.includes(q.get('basemap').toLowerCase())) opts.basemap = q.get('basemap').toLowerCase()
  if (q.get('opacity') != null && /^\d{1,3}$/.test(q.get('opacity')) && Number(q.get('opacity')) <= 100) opts.opacity = Number(q.get('opacity'))
  const layers = new Set((q.get('layers') || '').toLowerCase().split(',').filter((l) => LAYER_KEYS.includes(l)))
  if (q.get('stations') === '1') layers.add('stations')   // the first grammar's spelling
  if (layers.size) opts.layers = LAYER_KEYS.filter((l) => layers.has(l))
  if (q.get('station') && SKN_RE.test(q.get('station'))) opts.station = q.get('station')
  else if (q.get('pin')) {
    const [lat, lng] = q.get('pin').split(',').map(Number)
    if (inBox(lat, lng)) opts.pin = { lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) }
  }
  if (opts.station || opts.pin) {
    const r = parseRange(q.get('ts'))
    if (r) opts.ts = r
    if (q.get('tsp') && ['day', 'month'].includes(q.get('tsp').toLowerCase()) && q.get('tsp').toLowerCase() !== period) opts.tsp = q.get('tsp').toLowerCase()
  }
  if (q.get('compare') && isRealDate(q.get('compare'))) opts.compare = q.get('compare')   // YYYY-MM or YYYY-MM-DD
  if (q.get('lat') && q.get('lng')) {
    const lat = Number(q.get('lat')), lng = Number(q.get('lng'))
    if (inBox(lat, lng)) opts.view = { lat, lng, z: q.get('z') && Number.isFinite(Number(q.get('z'))) ? Math.max(5, Math.min(20, Math.round(Number(q.get('z'))))) : undefined }
  }
  return opts
}

export function parseViewerPath(pathname, search = '') {
  const segs = pathname.replace(/^\/+|\/+$/g, '').split('/')
  if (segs[0] !== 'viewer') return null
  const rest = segs.slice(1)
  if (rest.length < 3) return { error: 'incomplete' }
  const dataset = canonicalDataset(rest[0])
  if (!dataset) return { error: `unknown dataset "${rest[0]}"` }
  const period = canonicalPeriod(rest[1])
  if (!period) return { error: `unknown period "${rest[1]}"` }
  // the extent is the last segment; the date is everything in between
  const extent = canonicalExtent(rest[rest.length - 1])
  if (!extent) return { error: `unknown extent "${rest[rest.length - 1]}"` }
  const loose = parseDateSegments(rest.slice(2, -1), { calendar: false })
  if (!loose) return { error: 'unreadable date' }
  const date = parseDateSegments(rest.slice(2, -1))
  if (!date) return { error: `no such date ${loose}` }
  const isDay = date.length === 10
  if (period === 'day' && !isDay) return { error: 'a daily map needs a full date (YYYY-MM-DD)' }
  if (period === 'month' && isDay) return { error: 'a monthly map takes YYYY-MM' }
  if (!DATASETS[dataset].periods.includes(period)) return { error: `${DATASETS[dataset].label} is not available by ${period}` }
  return { dataset, period, date, extent, opts: parseViewerOptions(search, period) }
}

// Our own keys only carry letters, digits, '.', ',', '-' and '_', so the query
// is written by hand: readable commas and dots instead of %2C and %2E.
class PlainQuery {
  constructor() { this.parts = [] }
  set(k, v) { this.parts.push(`${k}=${encodeURIComponent(String(v)).replace(/%2C/gi, ',').replace(/%2E/gi, '.')}`) }
  toString() { return this.parts.join('&') }
}

/** The one spelling of a view: fixed key order, defaults omitted. */
export function formatViewerPath({ dataset, period, date, extent, opts = {} }) {
  const q = new PlainQuery()
  const ramp = opts.ramp ? formatRamp(opts.ramp, opts.reverse) : null
  if (ramp) q.set('ramp', ramp)
  if (opts.scale === 'extreme') q.set('scale', 'extreme')
  const range = formatLegendRange(opts.range)
  if (range) q.set('range', range)
  if (opts.log) q.set('log', '1')
  if (opts.units && opts.units !== 'mm' && opts.units !== 'c') q.set('units', opts.units)
  if (opts.basemap && opts.basemap !== DEFAULT_BASEMAP && BASEMAP_KEYS.includes(opts.basemap)) q.set('basemap', opts.basemap)
  if (opts.opacity != null && Number.isFinite(Number(opts.opacity)) && Math.round(opts.opacity) !== DEFAULT_OPACITY) q.set('opacity', String(Math.max(0, Math.min(100, Math.round(opts.opacity)))))
  const layers = Array.isArray(opts.layers) ? LAYER_KEYS.filter((l) => opts.layers.includes(l)) : (opts.stations ? ['stations'] : [])
  if (layers.length) q.set('layers', layers.join(','))
  if (opts.station) q.set('station', String(opts.station))
  else if (opts.pin && inBox(opts.pin.lat, opts.pin.lng)) q.set('pin', `${opts.pin.lat.toFixed(4)},${opts.pin.lng.toFixed(4)}`)
  if (opts.station || opts.pin) {
    const r = formatRange(opts.ts)
    if (r) q.set('ts', r)
    if (opts.tsp && opts.tsp !== period) q.set('tsp', opts.tsp)
  }
  if (opts.compare) q.set('compare', opts.compare)
  if (opts.view && Number.isFinite(opts.view.lat) && Number.isFinite(opts.view.lng)) {
    q.set('lat', opts.view.lat.toFixed(4)); q.set('lng', opts.view.lng.toFixed(4))
    if (opts.view.z != null) q.set('z', String(Math.round(opts.view.z)))
  }
  const s = q.toString()
  return `/viewer/${dataset}/${period}/${date}/${extent}${s ? `?${s}` : ''}`
}

/** The canonical path+query for any viewer address the grammar accepts
 *  (aliases resolved, dates normalised, keys ordered, defaults dropped), or
 *  null when the address is not a viewer address or cannot be shown. */
export function canonicalize(pathname, search = '') {
  const v = parseViewerPath(pathname, search)
  if (!v || v.error) return null
  return formatViewerPath(v)
}

/** Whether `pathname + search` is already spelled canonically. */
export function isCanonical(pathname, search = '') {
  const c = canonicalize(pathname, search)
  return c != null && c === `${pathname}${search || ''}`
}

/** Those keys of the query that are NOT this grammar's (kept apart so a
 *  rewrite to canonical never deletes something another feature owns). */
export function foreignQuery(search = '') {
  const q = new URLSearchParams(search)
  const out = new URLSearchParams()
  for (const [k, val] of q) if (!QUERY_KEYS.includes(k) && k !== 'stations') out.append(k, val)
  return out.toString()
}

// HCDP publishes SPI grids (and the legacy rainfall) statewide only: an island link shows the statewide grid zoomed to the island.
export const STATEWIDE_ONLY = new Set([...Object.keys(DATASETS).filter((k) => k.startsWith('spi-')), 'rainfall-legacy'])

// Query parameters for the backend raster proxy.
export function apiParamsFor({ dataset, period, date, extent }) {
  const ds = DATASETS[dataset]
  return { ...ds.api, period, date, extent: STATEWIDE_ONLY.has(dataset) ? 'statewide' : EXTENTS[extent].api }
}

/** Whether HCDP has station values for this dataset (markers, time series). */
export const hasStations = (dataset) => Boolean(DATASETS[dataset]?.stations)

// A human sentence for titles and the assistant's confirmations.
export function describeViewer({ dataset, period, date, extent }) {
  const ds = DATASETS[dataset]
  const when = period === 'day' ? new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    : new Date(date + '-15T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' })
  return `${ds.label}, ${when}, ${EXTENTS[extent].label}`
}
