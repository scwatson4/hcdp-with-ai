// Pure helpers that turn a parsed viewer URL (urlGrammar.parseViewerPath)
// into what the map needs: the backend request, the portal's dataset facts,
// the ramp, the legend domain, display units and date arithmetic. Nothing
// here parses or formats the URL itself — that is urlGrammar.js's job.

import { DATASETS, EXTENTS, apiParamsFor, formatViewerPath } from '../urlGrammar'
import { portalDataset, portalLegendHeader, portalLegendLabels } from '../portalDatasets.reference'
import { NAMED_RAMPS, DEFAULT_COLORMAP_BY_DATATYPE, COLORMAP_OPTIONS } from './ramps'

export const PORTAL_URL = 'https://www.hawaii.edu/climate-data-portal/data-portal/'

// ── requests ────────────────────────────────────────────────────────────────

/** The backend GeoTIFF proxy URL for one map (also the raster cache key). */
export function rasterRequestUrl({ dataset, period, date, extent }) {
  const q = new URLSearchParams({ dataset, period, date, extent })
  return `/api/raster?${q}`
}

/** The backend date-range proxy URL for a dataset/period/extent. */
export function datesRequestUrl(dataset, period, extent) {
  const q = new URLSearchParams({ dataset, period, extent })
  return `/api/dates?${q}`
}

// ── the portal's dataset facts ──────────────────────────────────────────────

/** A raster "spec" in the shape portalDatasets.reference.js reads, built from
 *  urlGrammar's API mapping. SPI's timescale travels as "timescale003" in the
 *  API; the portal helpers want the number of months. */
export function specFor(v) {
  const p = apiParamsFor(v)
  const spec = { ...p }
  if (p.timescale != null) spec.timescale = Number(String(p.timescale).replace(/\D/g, '')) || 1
  return spec
}

/** 'metric' | 'imperial' from the units option (in and f are imperial). */
export function unitSystem(opts = {}) {
  const u = String(opts.units || '').toLowerCase()
  return u === 'in' || u === 'f' ? 'imperial' : 'metric'
}

/** The units toggle for a dataset, or null when its values have no
 *  convertible unit (humidity %, NDVI, ignition probability, SPI). */
export function unitChoicesFor(dataset) {
  const u = DATASETS[dataset]?.units
  if (u === 'mm') return [{ value: 'mm', label: 'mm', system: 'metric' }, { value: 'in', label: 'in', system: 'imperial' }]
  if (u === '°C') return [{ value: 'c', label: '°C', system: 'metric' }, { value: 'f', label: '°F', system: 'imperial' }]
  return null
}

/** The option value the toggle should show as selected. */
export function selectedUnit(dataset, opts = {}) {
  const choices = unitChoicesFor(dataset)
  if (!choices) return null
  const sys = unitSystem(opts)
  return choices.find((c) => c.system === sys).value
}

/** The units option to carry into another dataset: the same system, spelled
 *  the way that dataset spells it; untouched for unitless datasets so the
 *  preference survives a trip through SPI. */
export function unitsForDataset(dataset, opts = {}) {
  const choices = unitChoicesFor(dataset)
  if (!choices) return opts.units
  return unitSystem(opts) === 'imperial' ? choices[1].value : undefined
}

const IMPERIAL = {
  mm: { unit: 'in', conv: (v) => v / 25.4, dp: 2 },
  '°C': { unit: '°F', conv: (v) => (v * 9) / 5 + 32, dp: 1 },
}

/** The unit the legend and readouts are written in. */
export function displayUnit(dataset, opts = {}) {
  const native = DATASETS[dataset]?.units ?? ''
  if (unitSystem(opts) === 'imperial' && IMPERIAL[native]) return IMPERIAL[native].unit
  return native
}

/** Convert one value for display (the data itself is never converted). */
export function toDisplay(value, dataset, opts = {}) {
  if (value == null || !Number.isFinite(value)) return value
  const native = DATASETS[dataset]?.units ?? ''
  const rule = unitSystem(opts) === 'imperial' ? IMPERIAL[native] : null
  if (!rule) return value
  return Number(rule.conv(value).toFixed(rule.dp))
}

/** A readout like "12.3 mm" / "0.48 in" / "0.52". */
export function formatValue(value, dataset, opts = {}) {
  if (value == null || !Number.isFinite(value)) return null
  const v = toDisplay(value, dataset, opts)
  const unit = displayUnit(dataset, opts)
  let digits = 1
  if (unit === 'in' || unit === '') digits = 2
  else if (unit === '%' || Math.abs(v) >= 100) digits = 0
  const text = v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
  return unit === '%' ? `${text}%` : (unit ? `${text} ${unit}` : text)
}

/** The ramp in effect: ?ramp= when it names a known ramp, else the portal's
 *  default for the dataset. */
export function rampNameFor(v) {
  const r = v.opts?.ramp
  if (r && NAMED_RAMPS[r]) return r
  return defaultRampFor(v.dataset)
}

export function defaultRampFor(dataset) {
  return DEFAULT_COLORMAP_BY_DATATYPE[DATASETS[dataset]?.api?.datatype] || 'viridis_r'
}

/** The ramp select's options, the dataset's default marked as HCDP's. */
export function rampOptionsFor(dataset) {
  const def = defaultRampFor(dataset)
  const opts = COLORMAP_OPTIONS.map((o) => (o.value === def ? { ...o, label: `${o.label} (HCDP default)` } : o))
  return [...opts.filter((o) => o.value === def), ...opts.filter((o) => o.value !== def)]
}

/** True when the extreme 0–250 mm scale applies (daily rainfall only). */
export function hasExtremeScale(v) {
  return Boolean(portalDataset(specFor(v))?.extreme)
}

/** The legend domain: the portal's fixed range, or its extreme range when
 *  ?scale=extreme and the product has one. */
export function domainFor(v) {
  const ds = portalDataset(specFor(v))
  if (!ds) return { min: 0, max: 1 }
  const range = v.opts?.scale === 'extreme' && ds.extreme ? ds.extreme : ds.range
  return { min: range[0], max: range[1] }
}

/** Legend header and its five labels, in display units. */
export function legendFor(v) {
  const spec = specFor(v)
  const ds = portalDataset(spec)
  const unit = displayUnit(v.dataset, v.opts)
  const header = portalLegendHeader(spec, unit)
  const { min, max } = domainFor(v)
  const lo = toDisplay(min, v.dataset, v.opts)
  const hi = toDisplay(max, v.dataset, v.opts)
  const labels = portalLegendLabels([lo, hi], ds ? ds.rangeAbsolute : [true, true])
  return { header, labels }
}

/** The portal's name for the product ("Daily Rainfall", "3-Month SPI …"). */
export function portalLabelFor(v) {
  return portalDataset(specFor(v))?.label || DATASETS[v.dataset]?.label || v.dataset
}

// T9D in the AI interface: one honest line on where each product comes from.
const SOURCE_LINES = {
  rainfall: 'HCDP gridded rainfall, 250 m — monthly: Frazier et al. 2016; daily: Longman et al. 2019',
  temperature: 'HCDP gridded air temperature, 250 m — Longman et al. 2019',
  spi: 'Standardized Precipitation Index (McKee et al. 1993) from HCDP monthly rainfall',
  ndvi_modis: 'MODIS NDVI vegetation greenness (Tucker 1979 index)',
  ignition_probability: 'HCDP wildfire ignition probability model',
  relative_humidity: 'HCDP gridded near-surface relative humidity',
}

export function sourceLineFor(v) {
  const dt = DATASETS[v.dataset]?.api?.datatype
  if (dt === 'rainfall') {
    return v.period === 'day'
      ? 'HCDP gridded rainfall, 250 m — daily: Longman et al. 2019'
      : 'HCDP gridded rainfall, 250 m — monthly: Frazier et al. 2016'
  }
  return SOURCE_LINES[dt] || 'Hawaiʻi Climate Data Portal gridded data'
}

/** The units line of the title card. */
export function unitsLineFor(v) {
  const unit = displayUnit(v.dataset, v.opts)
  const dt = DATASETS[v.dataset]?.api?.datatype
  if (unit === 'mm') return 'Units: millimetres (mm)'
  if (unit === 'in') return 'Units: inches (in)'
  if (unit === '°C') return 'Units: degrees Celsius (°C)'
  if (unit === '°F') return 'Units: degrees Fahrenheit (°F)'
  if (unit === '%') return 'Units: percent (%)'
  if (dt === 'ignition_probability') return 'Units: probability, 0 to 1'
  return 'Units: none (an index)'
}

// ── dates ───────────────────────────────────────────────────────────────────

const DAY_RE = /(\d{4})-(\d{2})-(\d{2})/
const MONTH_RE = /(\d{4})-(\d{2})/

/** YYYY-MM-DD (or YYYY-MM) out of anything date-like the API may send:
 *  "2026-09-23T10:00:00.000Z" (HST midnight), "2026-09-23", "2026-09". */
function dateFrom(value) {
  // Epoch milliseconds (after 1973), never a small number like {min: 0}.
  if (typeof value === 'number' && Number.isFinite(value) && value > 1e11) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  if (typeof value !== 'string') return null
  const m = DAY_RE.exec(value)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const mm = MONTH_RE.exec(value)
  return mm ? `${mm[1]}-${mm[2]}` : null
}

const START_KEYS = ['start', 'min', 'first', 'from', 'begin', 'startDate', 'start_date', 'earliest']
const END_KEYS = ['end', 'max', 'last', 'to', 'until', 'endDate', 'end_date', 'latest']

function collectDates(node, out, depth = 0) {
  if (depth > 5 || node == null) return
  const d = dateFrom(node)
  if (d) { out.push(d); return }
  if (Array.isArray(node)) { for (const x of node) collectDates(x, out, depth + 1); return }
  if (typeof node === 'object') for (const x of Object.values(node)) collectDates(x, out, depth + 1)
}

function findKeyed(node, keys, depth = 0) {
  if (depth > 5 || node == null || typeof node !== 'object' || Array.isArray(node)) return null
  for (const k of keys) {
    if (k in node) {
      const d = dateFrom(node[k])
      if (d) return d
    }
  }
  for (const x of Object.values(node)) {
    const hit = findKeyed(x, keys, depth + 1)
    if (hit) return hit
  }
  return null
}

/**
 * The available range out of the /api/dates JSON, whatever its shape. The
 * HCDP API answers with a two-item list of HST-midnight timestamps
 * (["1990-01-01T10:00:00.000Z", "2026-09-23T10:00:00.000Z"]); {start, end},
 * {min, max} or nested objects work too. Returns {start, end} in the
 * period's format (YYYY-MM for month), or null when nothing date-like is in it.
 */
export function parseDateRange(json, period = 'day') {
  let start = findKeyed(json, START_KEYS)
  let end = findKeyed(json, END_KEYS)
  if (!start || !end) {
    const all = []
    collectDates(json, all)
    if (!all.length) return null
    all.sort()
    start = start || all[0]
    end = end || all[all.length - 1]
  }
  if (start > end) [start, end] = [end, start]
  if (period === 'month') return { start: start.slice(0, 7), end: end.slice(0, 7) }
  // A month-only answer for a daily product: the whole months.
  if (start.length === 7) start = `${start}-01`
  if (end.length === 7) end = lastDayOf(end)
  return { start, end }
}

const pad = (n) => String(n).padStart(2, '0')

export function lastDayOf(month) {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`
}

/** One day or month forward (+1) or back (−1). */
export function shiftDate(date, period, delta) {
  if (period === 'month') {
    const [y, m] = date.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + delta, 1))
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
  }
  const [y, m, dd] = date.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, dd + delta))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** The same day (or month) a year earlier; 29 February becomes the 28th. */
export function yearBefore(date) {
  const y = String(Number(date.slice(0, 4)) - 1).padStart(4, '0')
  const rest = date.slice(4)
  return rest === '-02-29' ? `${y}-02-28` : `${y}${rest}`
}

/** Clamp a date into a range (lexicographic works for ISO dates). */
export function clampDate(date, range) {
  if (!range) return date
  if (date < range.start) return range.start
  if (date > range.end) return range.end
  return date
}

export function inRange(date, range) {
  return !range || (date >= range.start && date <= range.end)
}

/** The date for another period: a month keeps its days' month; a day is the
 *  last day of the month (clamped to what is published). */
export function dateForPeriod(date, toPeriod, range = null) {
  if (toPeriod === 'month') return clampDate(date.slice(0, 7), range)
  const day = date.length === 10 ? date : lastDayOf(date.slice(0, 7))
  return clampDate(day, range)
}

/** A real calendar date (rejects 2026-02-30). */
export function isRealDate(date, period) {
  if (period === 'month') return /^\d{4}-(0[1-9]|1[0-2])$/.test(date)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '')
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

/** Today in Hawaiʻi (HST, UTC−10, no daylight time) as YYYY-MM-DD. */
export function hawaiiToday(now = new Date()) {
  return new Date(now.getTime() - 10 * 3600 * 1000).toISOString().slice(0, 10)
}

export function hawaiiYesterday(now = new Date()) {
  return shiftDate(hawaiiToday(now), 'day', -1)
}

export function hawaiiLastMonth(now = new Date()) {
  return shiftDate(hawaiiToday(now).slice(0, 7), 'month', -1)
}

/** "Sep 23, 2026" / "Aug 2026" for short range hints. */
export function shortDate(date) {
  if (!date) return ''
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  return d
    ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

// ── building the next URL ───────────────────────────────────────────────────

/** formatViewerPath for the view `v` with some fields changed. `opts` merges;
 *  a key set to undefined drops that option. */
export function pathWith(v, patch = {}) {
  const opts = { ...(v.opts || {}), ...(patch.opts || {}) }
  for (const k of Object.keys(opts)) if (opts[k] === undefined || opts[k] === null || opts[k] === false) delete opts[k]
  return formatViewerPath({
    dataset: patch.dataset ?? v.dataset,
    period: patch.period ?? v.period,
    date: patch.date ?? v.date,
    extent: patch.extent ?? v.extent,
    opts,
  })
}

/** ?compare= must name a date in the same period format as the map. */
export function compareDateFor(v) {
  const c = v.opts?.compare
  if (!c) return null
  return isRealDate(c, v.period) ? c : null
}

// Island bounds (the AI interface's ISLAND_BOUNDS, keyed by viewer extent) —
// only used to cap the extent's zoom so the whole island fits small screens.
export const EXTENT_BOUNDS = {
  statewide: [[18.9, -160.3], [22.3, -154.7]],
  hawaii: [[18.9, -156.1], [20.25, -154.75]],
  maui: [[20.55, -156.7], [21.05, -155.95]],
  molokai: [[21.03, -157.35], [21.25, -156.68]],
  lanai: [[20.7, -157.1], [20.95, -156.8]],
  oahu: [[21.22, -158.3], [21.75, -157.62]],
  kauai: [[21.85, -159.8], [22.25, -159.25]],
}

export function extentView(extent) {
  const e = EXTENTS[extent] || EXTENTS.statewide
  return { lat: e.center[0], lng: e.center[1], z: e.zoom }
}
