// The time series of the selected station (?station=SKN) or grid cell
// (?pin=lat,lng): a header (station name, SKN, island, elevation, network —
// or the cell's coordinates), a uPlot line chart in display units with nulls
// as gaps and a dashed marker at the map's date, the statistics of the
// points in view (count, min, max, mean, standard deviation — recomputed at
// most every 500 ms while zooming, tagged with where the numbers come from),
// zooming by drag-select or wheel (which writes ?ts=, replace, through the
// page-wide limiter), the window buttons (?ts=), "Zoom to the map's month /
// year", the series period toggle (?tsp=) when the dataset has both periods,
// a CSV download built in the browser, and a close that is the inverse of
// the selection's push. Loaded lazily by ViewerPage, so uPlot only downloads
// once something is selected.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { Download, Loader2, RotateCw, X, ZoomIn } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { useTheme } from '../components/ThemeProvider'
import { cn } from '../lib/utils'
import { DATASETS } from './urlGrammar'
import { LABEL, Segmented } from './map/Controls'
import { useDateRange } from './map/dateRanges'
import { islandName, timeseriesUrl, useJson } from './map/stationData'
import { clampDate, dateForPeriod, displayUnit, inRange, isRealDate, lastDayOf, shiftDate, shiftMonths, shortDate, toDisplay } from './map/viewerModel'

const FIELD = 'h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-2 font-mono text-[13px] text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** How often the statistics of the points in view are recomputed while zooming. */
export const STATS_THROTTLE_MS = 500

// ── dates ───────────────────────────────────────────────────────────────────

/** Epoch seconds (UTC midnight) of "YYYY-MM-DD" or "YYYY-MM" (the 1st). */
export function epochOf(date) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(date || ''))
  if (!m) return null
  return Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1) / 1000
}

/** The date (in the series period's spelling) an epoch second falls in. */
export function dateOfEpoch(sec, period) {
  const iso = new Date(sec * 1e3).toISOString()
  return period === 'day' ? iso.slice(0, 10) : iso.slice(0, 7)
}

/** The preset windows, ending at the map's date (inside the record). */
export function presetWindows(anchor, period, whole) {
  const end = whole ? clampDate(anchor, whole) : anchor
  const clamp = (start) => ({ start: whole ? clampDate(start, whole) : start, end })
  if (period === 'day') return { month: clamp(shiftMonths(end, 'day', -1)), year: clamp(shiftMonths(end, 'day', -12)) }
  return { year: clamp(shiftDate(end, 'month', -11)) }
}

/** The map's period one step up (hcdp_v2's "Zoom to Month / Year"): the month
 *  around the map's day for a daily series, the year around its month for a
 *  monthly one — clamped to the record. */
export function periodWindow(anchor, period, whole) {
  const clamp = (d) => (whole ? clampDate(d, whole) : d)
  if (period === 'day') {
    const month = anchor.slice(0, 7)
    return { start: clamp(`${month}-01`), end: clamp(lastDayOf(month)) }
  }
  const year = anchor.slice(0, 4)
  return { start: clamp(`${year}-01`), end: clamp(`${year}-12`) }
}

const sameWindow = (a, b) => Boolean(a && b && a.start === b.start && a.end === b.end)

/** A zoomed x-range (epoch seconds) → the ?ts= window it asks for, in the
 *  period's spelling, inside the record; null when it is the whole record. */
export function zoomWindow(minSec, maxSec, period, whole) {
  if (!Number.isFinite(minSec) || !Number.isFinite(maxSec)) return null
  let start = dateOfEpoch(Math.min(minSec, maxSec), period)
  let end = dateOfEpoch(Math.max(minSec, maxSec), period)
  if (whole) { start = clampDate(start, whole); end = clampDate(end, whole) }
  if (start > end) start = end
  if (whole && start === whole.start && end === whole.end) return null
  return { start, end }
}

// ── statistics ──────────────────────────────────────────────────────────────

/** Count, min, max, mean and (population) standard deviation of the values
 *  whose x lies in [min, max] (the whole series when `win` is null), as
 *  hcdp_v2's viewport statistics compute them. */
export function viewportStats(xs, ys, win = null) {
  let n = 0, min = Infinity, max = -Infinity, sum = 0
  const inWin = (x) => !win || (x >= win.min && x <= win.max)
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i]
    if (y == null || !Number.isFinite(y) || !inWin(xs[i])) continue
    n++; sum += y
    if (y < min) min = y
    if (y > max) max = y
  }
  if (!n) return { count: 0, min: null, max: null, mean: null, stddev: null }
  const mean = sum / n
  let sq = 0
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i]
    if (y == null || !Number.isFinite(y) || !inWin(xs[i])) continue
    sq += (y - mean) ** 2
  }
  return { count: n, min, max, mean, stddev: Math.sqrt(sq / n) }
}

/** Run `fn` at most once per `ms`: at once after a quiet spell, else once at
 *  the end of the window with the latest arguments (zooming calls it a lot). */
export function makeThrottle(ms) {
  let last = -Infinity, timer = null, pending = null
  const run = (fn, args) => { last = Date.now(); fn(...args) }
  const call = (fn, ...args) => {
    pending = [fn, args]
    if (timer) return
    const wait = ms - (Date.now() - last)
    if (wait <= 0) { const p = pending; pending = null; run(p[0], p[1]); return }
    timer = setTimeout(() => { timer = null; const p = pending; pending = null; if (p) run(p[0], p[1]) }, wait)
  }
  call.cancel = () => { clearTimeout(timer); timer = null; pending = null }
  return call
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/** "date,value" lines in display units; a missing value is an empty cell. */
export function buildCsv(points, dataset, opts = {}) {
  const lines = ['date,value']
  for (const p of points || []) {
    const [d, val] = p
    lines.push(`${String(d).slice(0, 10)},${val == null || !Number.isFinite(val) ? '' : toDisplay(val, dataset, opts)}`)
  }
  return `${lines.join('\n')}\n`
}

export function csvFilename(selection, dataset, period) {
  if (selection.kind === 'station') return `station_${selection.skn}_${dataset}_${period}.csv`
  return `cell_${selection.lat.toFixed(4)}_${selection.lng.toFixed(4)}_${dataset}_${period}.csv`
}

function saveText(text, filename) {
  if (typeof URL.createObjectURL !== 'function') return false
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

// ── the chart ───────────────────────────────────────────────────────────────

/** A theme token as a colour the canvas understands. */
function token(name, alpha = null, fallback = '#888') {
  if (typeof getComputedStyle !== 'function') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw) return fallback
  return `hsl(${raw}${alpha != null ? ` / ${alpha}` : ''})`
}

const FONT = '11px Roboto, "Segoe UI", system-ui, sans-serif'
const WHEEL_FACTOR = 0.75

/** The x-range after one wheel step about the cursor (zoom in on wheel up,
 *  out on wheel down), kept inside the data's extent; null when nothing
 *  changes (already the whole extent and zooming out). */
export function wheelZoom(scale, extent, cursorX, deltaY) {
  const { min, max } = scale
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null
  const factor = deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR
  const anchor = Number.isFinite(cursorX) ? Math.max(min, Math.min(max, cursorX)) : (min + max) / 2
  let nmin = anchor - (anchor - min) * factor
  let nmax = anchor + (max - anchor) * factor
  nmin = Math.max(extent.min, nmin)
  nmax = Math.min(extent.max, nmax)
  if (nmax - nmin < 1) return null
  if (nmin === min && nmax === max) return null
  return { min: nmin, max: nmax }
}

/** The dashed vertical marker at the map's date, drawn on the canvas with its label. */
function drawMarker(u, marker, colour) {
  const { x, label } = marker
  const sx = u.scales?.x
  if (!sx || x < sx.min || x > sx.max) return
  const ctx = u.ctx
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
  const px = u.valToPos(x, 'x', true)
  const { top, height } = u.bbox
  ctx.save()
  ctx.strokeStyle = colour
  ctx.fillStyle = colour
  ctx.lineWidth = 1.5 * dpr
  ctx.setLineDash([4 * dpr, 4 * dpr])
  ctx.beginPath()
  ctx.moveTo(px, top)
  ctx.lineTo(px, top + height)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.font = `${11 * dpr}px Roboto, "Segoe UI", system-ui, sans-serif`
  ctx.textBaseline = 'top'
  const w = ctx.measureText(label).width
  const left = px + 4 * dpr + w > u.bbox.left + u.bbox.width ? px - w - 4 * dpr : px + 4 * dpr
  ctx.fillText(label, left, top + 2 * dpr)
  ctx.restore()
}

/** One uPlot line: x = date, y = value in display units, nulls as gaps, a
 *  marker at the map's date. Rebuilt when the data, the units or the theme
 *  change; resized with its box. Hover reports the point under the cursor
 *  upward; the x-window (after any zoom) is reported through onWindow, a
 *  drag-select or wheel zoom through onZoom (epoch seconds). */
function Chart({ xs, ys, label, unit, period, floorZero, marker, onHover, onWindow, onZoom }) {
  const box = useRef(null)
  const plot = useRef(null)
  const cb = useRef({ onHover, onWindow, onZoom })
  cb.current = { onHover, onWindow, onZoom }
  const { theme } = useTheme()

  useEffect(() => {
    const el = box.current
    if (!el || !xs.length) return undefined
    const accent = token('--accent', null, '#2563eb')
    const text = token('--muted-foreground', null, '#6b7280')
    const grid = token('--border', 0.8, '#e5e7eb')
    const card = token('--card', null, '#fff')
    const ember = token('--warning', null, '#b35400')
    const width = Math.max(200, el.clientWidth || 320)
    const extent = { min: xs[0], max: xs[xs.length - 1] }
    const opts = {
      width,
      height: 200,
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), 'Etc/UTC'),
      padding: [10, 10, 0, 0],
      legend: { show: false },
      // Drag along x selects a window to zoom into (uPlot sets the scale; the hook writes ?ts=).
      cursor: { drag: { x: true, y: false }, points: { size: 7 } },
      scales: {
        x: { time: true },
        y: floorZero ? { range: (u, min, max) => [Math.min(0, min), max <= 0 ? 1 : max * 1.05] } : {},
      },
      series: [
        {},
        {
          label, stroke: accent, width: 1.5, spanGaps: false,
          points: { show: xs.length <= 60, size: 5, stroke: accent, fill: card },
        },
      ],
      axes: [
        { stroke: text, font: FONT, size: 26, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 } },
        {
          stroke: text, font: FONT, size: 46, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 },
          values: (u, vals) => vals.map((n) => (Math.abs(n) >= 100 ? n.toFixed(0) : String(Number(n.toFixed(2))))),
        },
      ],
      // Ours, not uPlot's: what the tests (and the marker hook) read.
      hcdp: { marker, extent },
      hooks: {
        setCursor: [(u) => {
          const i = u.cursor.idx
          cb.current.onHover?.(i == null ? null : { t: u.data[0][i], v: u.data[1][i] })
        }],
        // A drag-select along x: the window it covers, before uPlot applies it.
        setSelect: [(u) => {
          const sel = u.select
          if (!sel || !(sel.width > 0)) return
          const a = u.posToVal(sel.left, 'x'), b = u.posToVal(sel.left + sel.width, 'x')
          cb.current.onZoom?.(Math.min(a, b), Math.max(a, b))
        }],
        // Any change of the x scale (a zoom, a reset): the statistics follow.
        setScale: [(u, key) => {
          if (key !== 'x') return
          const s = u.scales.x
          cb.current.onWindow?.(Number.isFinite(s.min) && Number.isFinite(s.max) ? { min: s.min, max: s.max } : null)
        }],
        draw: [(u) => { if (marker && u.ctx && u.bbox) drawMarker(u, marker, ember) }],
        // Wheel over the plot zooms about the cursor (page scroll is only taken when the chart can zoom).
        ready: [(u) => {
          const over = u.over
          if (!over || typeof over.addEventListener !== 'function') return
          const onWheel = (e) => {
            const rect = over.getBoundingClientRect()
            const cursorX = u.posToVal(e.clientX - rect.left, 'x')
            const next = wheelZoom(u.scales.x, extent, cursorX, e.deltaY)
            if (!next) return
            e.preventDefault()
            u.setScale('x', next)
            cb.current.onZoom?.(next.min, next.max)
          }
          over.addEventListener('wheel', onWheel, { passive: false })
        }],
      },
    }
    const chart = new uPlot(opts, [xs, ys], el)
    plot.current = chart
    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        const w = el.clientWidth
        if (w > 0 && plot.current) plot.current.setSize({ width: w, height: 200 })
      })
      ro.observe(el)
    }
    return () => {
      ro?.disconnect()
      chart.destroy()
      plot.current = null
    }
  }, [xs, ys, label, unit, period, floorZero, theme, marker])

  return <div ref={box} className="hcdp-chart w-full" data-testid="timeseries-chart" />
}

// ── the panel ───────────────────────────────────────────────────────────────

const NON_NEGATIVE = new Set(['rainfall', 'relative_humidity', 'ndvi_modis', 'ignition_probability'])

const fmt = (n, unit) => (n == null ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`)

/**
 * `selection`: { kind: 'station', skn, station: {name, island, elevation_m, network, observer, lat, lng} | null }
 *           or { kind: 'pin', lat, lng }.
 * `onRange(window | null)` writes ?ts= (replace); `onPeriod(p)` writes ?tsp=;
 * `onClose()` drops station/pin/ts/tsp (a push, the inverse of selecting).
 */
export default function TimeSeriesPanel({ v, selection, onRange, onPeriod, onClose, focusOnOpen = false, className = '' }) {
  const ds = DATASETS[v.dataset]
  const periods = ds?.periods || [v.period]
  const tsp = v.opts.tsp && periods.includes(v.opts.tsp) ? v.opts.tsp : v.period
  const whole = useDateRange(v.dataset, tsp, v.extent)
  // A window written for the other period's date format does not apply.
  const ts = v.opts.ts && v.opts.ts.start.length === (tsp === 'day' ? 10 : 7) ? v.opts.ts : null
  const anchor = dateForPeriod(v.date, tsp)
  const presets = useMemo(() => presetWindows(anchor, tsp, whole.range), [anchor, tsp, whole.range])
  const window_ = ts || whole.range
  const unit = displayUnit(v.dataset, v.opts)

  const url = window_ ? timeseriesUrl({
    dataset: v.dataset, period: tsp, start: window_.start, end: window_.end,
    station: selection.kind === 'station' ? selection.skn : null,
    lat: selection.kind === 'pin' ? selection.lat : null, lng: selection.kind === 'pin' ? selection.lng : null,
  }) : null
  const record = useJson(url)
  // While a narrower window loads (a zoom), the last record of the same
  // place keeps the chart on screen; another place starts blank.
  const placeKey = `${selection.kind}|${selection.skn ?? ''}|${selection.lat ?? ''}|${selection.lng ?? ''}|${v.dataset}|${tsp}`
  const lastReady = useRef(null)
  if (record.status === 'ready') lastReady.current = { key: placeKey, points: record.data?.points || null }
  const points = record.status === 'ready' ? (record.data?.points || null)
    : (record.status === 'loading' && lastReady.current?.key === placeKey ? lastReady.current.points : null)

  const { xs, ys } = useMemo(() => {
    const X = [], Y = []
    for (const p of points || []) {
      const t = epochOf(p[0])
      if (t == null) continue
      X.push(t); Y.push(p[1] == null || !Number.isFinite(p[1]) ? null : toDisplay(p[1], v.dataset, v.opts))
    }
    return { xs: X, ys: Y }
  }, [points, v.dataset, v.opts.units]) // eslint-disable-line react-hooks/exhaustive-deps

  const [hover, setHover] = useState(null)
  // The x-window in view (epoch seconds), null = all of the data; new data starts at all.
  const [xWindow, setXWindow] = useState(null)
  useEffect(() => { setHover(null); setXWindow(null) }, [xs])
  const throttle = useMemo(() => makeThrottle(STATS_THROTTLE_MS), [])
  useEffect(() => () => throttle.cancel(), [throttle])
  const onWindow = useCallback((win) => throttle(setXWindow, win), [throttle])
  const stats = useMemo(() => viewportStats(xs, ys, xWindow), [xs, ys, xWindow])

  // A zoom (drag-select or wheel) asks for the window it covers: a replace write of ?ts= through the limiter.
  const onZoom = useCallback((minSec, maxSec) => {
    const next = zoomWindow(minSec, maxSec, tsp, whole.range)
    if (next === null ? !ts : sameWindow(next, window_)) return
    onRange(next)
  }, [tsp, whole.range, ts, window_, onRange])

  // Custom shows two date fields; it stays open while the window matches no preset.
  const activePreset = !ts ? 'all' : sameWindow(ts, presets.month) ? 'month' : sameWindow(ts, presets.year) ? 'year' : 'custom'
  const [custom, setCustom] = useState(activePreset === 'custom')
  useEffect(() => { if (activePreset === 'custom') setCustom(true) }, [activePreset])
  const choosePreset = (p) => {
    if (p === 'custom') { setCustom(true); return }
    setCustom(false)
    onRange(p === 'all' ? null : presets[p])
  }
  const presetOptions = [
    ...(tsp === 'day' ? [{ value: 'month', label: 'Month' }] : []),
    { value: 'year', label: 'Year' }, { value: 'all', label: 'All' }, { value: 'custom', label: 'Custom' },
  ]
  const mapPeriod = periodWindow(anchor, tsp, whole.range)
  const zoomToMapPeriod = () => { setCustom(false); onRange(sameWindow(mapPeriod, whole.range) ? null : mapPeriod) }

  // Escape closes; the panel takes focus when the visitor just selected something.
  const root = useRef(null)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => { if (focusOnOpen) root.current?.focus({ preventScroll: true }) }, [focusOnOpen, selection.kind, selection.skn, selection.lat, selection.lng])

  const station = selection.kind === 'station' ? selection.station : null
  const heading = selection.kind === 'station'
    ? (station?.name || `Station ${selection.skn}`)
    : `Grid cell ${selection.lat.toFixed(4)}, ${selection.lng.toFixed(4)}`
  const details = selection.kind === 'station'
    ? [
      `SKN ${selection.skn}`, islandName(station?.island), station?.elevation_m != null ? `${Math.round(station.elevation_m)} m` : null,
      station?.network, station?.observer && station.observer !== station.network ? `observer ${station.observer}` : null,
    ].filter(Boolean).join(' · ')
    : 'A grid cell of the gridded product — a virtual station'
  const seriesLabel = `${ds?.label || v.dataset}, ${tsp === 'day' ? 'daily' : 'monthly'}`
  const ariaLabel = `${heading}: ${seriesLabel} time series`
  const marker = useMemo(() => ({ x: epochOf(anchor), label: `Map date · ${shortDate(anchor)}` }), [anchor])

  const download = () => {
    if (!points) return
    saveText(buildCsv(points, v.dataset, v.opts), csvFilename(selection, v.dataset, tsp))
  }

  const status = !window_ ? (whole.status === 'error' ? 'error' : 'loading') : record.status
  const showChart = xs.length > 0 && (status === 'ready' || status === 'loading')
  const hoverText = hover && hover.t != null
    ? `${shortDate(dateOfEpoch(hover.t, tsp))} · ${hover.v == null ? 'no value' : fmt(hover.v, unit)}`
    : null
  const extentText = xs.length ? `${shortDate(dateOfEpoch(xs[0], tsp))} to ${shortDate(dateOfEpoch(xs[xs.length - 1], tsp))}` : (window_ ? `${shortDate(window_.start)} to ${shortDate(window_.end)}` : '')
  const provenance = selection.kind === 'station' ? 'computed from HCDP station data' : 'computed from HCDP gridded data'
  const stepWord = tsp === 'day' ? 'days' : 'months'

  return (
    <aside
      ref={root} tabIndex={-1} role="complementary" aria-label={ariaLabel}
      className={cn('flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      data-testid="timeseries-panel"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-subtle">{selection.kind === 'station' ? 'Station' : 'Grid cell'}</p>
          <h2 className="truncate font-display text-lg leading-tight" data-testid="timeseries-heading">{heading}</h2>
          <p className="text-xs text-subtle" data-testid="timeseries-details">{details}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="-mr-1 -mt-1 h-9 w-9 shrink-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label="Close the time series" title="Close (Esc)" onClick={onClose} data-testid="timeseries-close">
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </header>

      <div>
        <p className="text-sm font-medium">{seriesLabel}</p>
        <p className="h-5 truncate font-mono text-[11px] text-subtle" aria-live="off" data-testid="timeseries-readout">
          {hoverText || extentText}
        </p>
      </div>

      <div className="relative min-h-[200px]" aria-busy={status === 'loading'}>
        {showChart && (
          <Chart
            xs={xs} ys={ys} label={seriesLabel} unit={unit} period={tsp} floorZero={NON_NEGATIVE.has(ds?.api?.datatype)} marker={marker}
            onHover={setHover} onWindow={onWindow} onZoom={onZoom}
          />
        )}
        {status === 'ready' && xs.length === 0 && <p className="text-sm text-subtle" data-testid="timeseries-empty">No values in this window.</p>}
        {status === 'loading' && (
          <p className={cn('flex items-center gap-2 text-sm text-subtle', showChart && 'absolute right-2 top-1 rounded-full border border-border bg-card/90 px-2 py-0.5 text-[11px]')} role="status" data-testid="timeseries-loading">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading the record…
          </p>
        )}
        {status === 'notfound' && <p className="text-sm text-subtle" data-testid="timeseries-notfound">HCDP has no record for this {selection.kind === 'station' ? 'station and dataset' : 'cell'}.</p>}
        {status === 'error' && (
          <div className="text-sm" role="alert" data-testid="timeseries-error">
            <p className="text-subtle">The record did not load.</p>
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={record.retry}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
            </Button>
          </div>
        )}
      </div>

      {showChart && (
        <div data-testid="timeseries-stats">
          <dl className="grid grid-cols-5 gap-x-1 text-center">
            {[['in view', `${stats.count.toLocaleString('en-US')} ${stepWord}`], ['min', fmt(stats.min, unit)], ['max', fmt(stats.max, unit)], ['mean', fmt(stats.mean, unit)], ['std dev', fmt(stats.stddev, unit)]].map(([k, val]) => (
              <div key={k} className="min-w-0">
                <dt className="font-mono text-[10px] uppercase tracking-wide text-subtle">{k}</dt>
                <dd className="truncate font-mono text-[11px] tabular-nums" title={val} data-testid={`stat-${k.replace(/\s+/g, '-')}`}>{val}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-subtle">
            <Badge variant="muted" className="px-1.5 py-0 text-[10px] font-normal" data-testid="stats-provenance">{provenance}</Badge>
            <span>for the dates in view — drag or scroll on the chart to zoom.</span>
          </p>
        </div>
      )}

      <Segmented legend="Window" name="ts-window" value={custom ? 'custom' : activePreset} options={presetOptions} onChange={choosePreset} testid="ts-window" />
      {custom && <CustomWindow period={tsp} value={window_} whole={whole.range} onChange={onRange} />}
      <Button type="button" variant="outline" size="sm" className="justify-center [@media(pointer:coarse)]:h-11" onClick={zoomToMapPeriod} disabled={!whole.range} data-testid="ts-zoom-period" title={`${shortDate(mapPeriod.start)} to ${shortDate(mapPeriod.end)}`}>
        <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" /> Zoom to the map's {tsp === 'day' ? 'month' : 'year'}
      </Button>
      {periods.length > 1 && (
        <Segmented
          legend="Series" name="ts-period" value={tsp} onChange={onPeriod} testid="ts-period"
          options={periods.map((p) => ({ value: p, label: p === 'day' ? 'Daily' : 'Monthly' }))}
        />
      )}

      <Button type="button" variant="outline" size="sm" className="justify-center [@media(pointer:coarse)]:h-11" onClick={download} disabled={!points || !points.length} data-testid="timeseries-csv">
        <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download CSV
      </Button>
    </aside>
  )
}

/** Two date (or month) fields for a window of one's own; each real date
 *  inside the record is written at once. */
function CustomWindow({ period, value, whole, onChange }) {
  const id = useId()
  const [start, setStart] = useState(value?.start || '')
  const [end, setEnd] = useState(value?.end || '')
  useEffect(() => { setStart(value?.start || ''); setEnd(value?.end || '') }, [value?.start, value?.end])
  const commit = (s, e) => {
    if (!isRealDate(s, period) || !isRealDate(e, period)) return
    if (!inRange(s, whole) || !inRange(e, whole)) return
    onChange(s <= e ? { start: s, end: e } : { start: e, end: s })
  }
  const type = period === 'day' ? 'date' : 'month'
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="ts-custom">
      <div>
        <label htmlFor={`${id}-start`} className={LABEL}>From</label>
        <input id={`${id}-start`} type={type} className={cn(FIELD, 'w-full')} value={start} min={whole?.start} max={whole?.end}
          onChange={(e) => { setStart(e.target.value); commit(e.target.value, end) }} data-testid="ts-start" />
      </div>
      <div>
        <label htmlFor={`${id}-end`} className={LABEL}>To</label>
        <input id={`${id}-end`} type={type} className={cn(FIELD, 'w-full')} value={end} min={whole?.start} max={whole?.end}
          onChange={(e) => { setEnd(e.target.value); commit(start, e.target.value) }} data-testid="ts-end" />
      </div>
    </div>
  )
}
