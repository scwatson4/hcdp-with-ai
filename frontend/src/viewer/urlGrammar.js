// The deep-link grammar for the climate viewer (see CONTRACT.md). Single source
// of truth for parsing and formatting; the assistant, the backend's examples
// and the viewer all agree through these functions.
//
//   /viewer/{dataset}/{period}/{date}/{extent}[?options]
//
// Dates: YYYY-MM or YYYY-MM-DD. The parser also accepts month names in either
// order ("october/21/2025", "2025/october/21", "oct/2025") so a hand-typed link
// like the ones people paste in email still resolves.

export const DATASETS = {
  rainfall: { label: 'Rainfall', periods: ['month', 'day'], units: 'mm', api: { datatype: 'rainfall', production: 'new' } },
  'temperature-mean': { label: 'Mean temperature', periods: ['month', 'day'], units: '°C', api: { datatype: 'temperature', aggregation: 'mean' } },
  'temperature-max': { label: 'Maximum temperature', periods: ['month', 'day'], units: '°C', api: { datatype: 'temperature', aggregation: 'max' } },
  'temperature-min': { label: 'Minimum temperature', periods: ['month', 'day'], units: '°C', api: { datatype: 'temperature', aggregation: 'min' } },
  humidity: { label: 'Relative humidity', periods: ['day'], units: '%', api: { datatype: 'relative_humidity' } },
  ndvi: { label: 'Vegetation (NDVI)', periods: ['day'], units: '', api: { datatype: 'ndvi_modis' } },
  ignition: { label: 'Ignition probability', periods: ['day'], units: '', api: { datatype: 'ignition_probability' } },
  'spi-1': { label: 'Drought index (SPI, 1 month)', periods: ['month'], units: '', api: { datatype: 'spi', timescale: 'timescale001' } },
  'spi-3': { label: 'Drought index (SPI, 3 months)', periods: ['month'], units: '', api: { datatype: 'spi', timescale: 'timescale003' } },
  'spi-6': { label: 'Drought index (SPI, 6 months)', periods: ['month'], units: '', api: { datatype: 'spi', timescale: 'timescale006' } },
  'spi-9': { label: 'Drought index (SPI, 9 months)', periods: ['month'], units: '', api: { datatype: 'spi', timescale: 'timescale009' } },
  'spi-12': { label: 'Drought index (SPI, 12 months)', periods: ['month'], units: '', api: { datatype: 'spi', timescale: 'timescale012' } },
  'spi-24': { label: 'Drought index (SPI, 24 months)', periods: ['month'], units: '', api: { datatype: 'spi', timescale: 'timescale024' } },
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

export function parseViewerPath(pathname, search = '') {
  const segs = pathname.replace(/^\/+|\/+$/g, '').split('/')
  if (segs[0] !== 'viewer') return null
  const rest = segs.slice(1)
  if (rest.length < 3) return { error: 'incomplete' }
  const dataset = rest[0].toLowerCase()
  if (!DATASETS[dataset]) return { error: `unknown dataset "${rest[0]}"` }
  const period = rest[1].toLowerCase()
  if (!['month', 'day'].includes(period)) return { error: `unknown period "${rest[1]}"` }
  // the extent is the last segment; the date is everything in between
  const extent = rest[rest.length - 1].toLowerCase()
  if (!EXTENTS[extent]) return { error: `unknown extent "${rest[rest.length - 1]}"` }
  const loose = parseDateSegments(rest.slice(2, -1), { calendar: false })
  if (!loose) return { error: 'unreadable date' }
  const date = parseDateSegments(rest.slice(2, -1))
  if (!date) return { error: `no such date ${loose}` }
  const isDay = date.length === 10
  if (period === 'day' && !isDay) return { error: 'a daily map needs a full date (YYYY-MM-DD)' }
  if (period === 'month' && isDay) return { error: 'a monthly map takes YYYY-MM' }
  if (!DATASETS[dataset].periods.includes(period)) return { error: `${DATASETS[dataset].label} is not available by ${period}` }
  const q = new URLSearchParams(search)
  const opts = {}
  for (const k of ['ramp', 'scale', 'units']) if (q.get(k)) opts[k] = q.get(k)
  if (q.get('compare') && isRealDate(q.get('compare'))) opts.compare = q.get('compare')   // YYYY-MM or YYYY-MM-DD
  if (q.get('stations') === '1') opts.stations = true
  if (q.get('lat') && q.get('lng')) opts.view = { lat: Number(q.get('lat')), lng: Number(q.get('lng')), z: q.get('z') ? Number(q.get('z')) : undefined }
  return { dataset, period, date, extent, opts }
}

export function formatViewerPath({ dataset, period, date, extent, opts = {} }) {
  const q = new URLSearchParams()
  if (opts.ramp) q.set('ramp', opts.ramp)
  if (opts.scale) q.set('scale', opts.scale)
  if (opts.units) q.set('units', opts.units)
  if (opts.compare) q.set('compare', opts.compare)
  if (opts.stations) q.set('stations', '1')
  if (opts.view && Number.isFinite(opts.view.lat) && Number.isFinite(opts.view.lng)) {
    q.set('lat', opts.view.lat.toFixed(4)); q.set('lng', opts.view.lng.toFixed(4))
    if (opts.view.z != null) q.set('z', String(opts.view.z))
  }
  const s = q.toString()
  return `/viewer/${dataset}/${period}/${date}/${extent}${s ? `?${s}` : ''}`
}

// HCDP publishes SPI grids statewide only: an island link shows the statewide grid zoomed to the island.
export const STATEWIDE_ONLY = new Set(Object.keys(DATASETS).filter((k) => k.startsWith('spi-')))

// Query parameters for the backend raster proxy.
export function apiParamsFor({ dataset, period, date, extent }) {
  const ds = DATASETS[dataset]
  return { ...ds.api, period, date, extent: STATEWIDE_ONLY.has(dataset) ? 'statewide' : EXTENTS[extent].api }
}

// A human sentence for titles and the assistant's confirmations.
export function describeViewer({ dataset, period, date, extent }) {
  const ds = DATASETS[dataset]
  const when = period === 'day' ? new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    : new Date(date + '-15T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' })
  return `${ds.label}, ${when}, ${EXTENTS[extent].label}`
}
