// The time series of the selected station (?station=SKN) or grid cell
// (?pin=lat,lng): a header (station name, SKN, island, elevation — or the
// cell's coordinates), a uPlot line chart in display units with nulls as
// gaps, the window buttons (?ts=, replace), the series period toggle
// (?tsp=) when the dataset has both periods, a CSV download built in the
// browser, and a close that is the inverse of the selection's push.
// Loaded lazily by ViewerPage, so uPlot only downloads once something is
// selected.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { Download, Loader2, RotateCw, X } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useTheme } from '../components/ThemeProvider'
import { cn } from '../lib/utils'
import { DATASETS } from './urlGrammar'
import { LABEL, Segmented } from './map/Controls'
import { useDateRange } from './map/dateRanges'
import { timeseriesUrl, useJson } from './map/stationData'
import { clampDate, dateForPeriod, displayUnit, inRange, isRealDate, shiftDate, shiftMonths, shortDate, toDisplay } from './map/viewerModel'

const FIELD = 'h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-2 font-mono text-[13px] text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

// ── dates ───────────────────────────────────────────────────────────────────

/** Epoch seconds (UTC midnight) of "YYYY-MM-DD" or "YYYY-MM" (the 1st). */
export function epochOf(date) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(date || ''))
  if (!m) return null
  return Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1) / 1000
}

/** The preset windows, ending at the map's date (inside the record). */
export function presetWindows(anchor, period, whole) {
  const end = whole ? clampDate(anchor, whole) : anchor
  const clamp = (start) => ({ start: whole ? clampDate(start, whole) : start, end })
  if (period === 'day') return { month: clamp(shiftMonths(end, 'day', -1)), year: clamp(shiftMonths(end, 'day', -12)) }
  return { year: clamp(shiftDate(end, 'month', -11)) }
}

const sameWindow = (a, b) => Boolean(a && b && a.start === b.start && a.end === b.end)

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

/** One uPlot line: x = date, y = value in display units, nulls as gaps.
 *  Rebuilt when the data, the units or the theme change; resized with its
 *  box. Hover reports the point under the cursor upward. */
function Chart({ xs, ys, label, unit, period, floorZero, onHover }) {
  const box = useRef(null)
  const plot = useRef(null)
  const hover = useRef(onHover)
  hover.current = onHover
  const { theme } = useTheme()

  useEffect(() => {
    const el = box.current
    if (!el || !xs.length) return undefined
    const accent = token('--accent', null, '#2563eb')
    const text = token('--muted-foreground', null, '#6b7280')
    const grid = token('--border', 0.8, '#e5e7eb')
    const card = token('--card', null, '#fff')
    const width = Math.max(200, el.clientWidth || 320)
    const opts = {
      width,
      height: 200,
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), 'Etc/UTC'),
      padding: [10, 10, 0, 0],
      legend: { show: false },
      cursor: { drag: { x: false, y: false }, points: { size: 7 } },
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
      hooks: {
        setCursor: [(u) => {
          const i = u.cursor.idx
          hover.current?.(i == null ? null : { t: u.data[0][i], v: u.data[1][i] })
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
  }, [xs, ys, label, unit, period, floorZero, theme])

  return <div ref={box} className="hcdp-chart w-full" data-testid="timeseries-chart" />
}

// ── the panel ───────────────────────────────────────────────────────────────

const NON_NEGATIVE = new Set(['rainfall', 'relative_humidity', 'ndvi_modis', 'ignition_probability'])

/**
 * `selection`: { kind: 'station', skn, station: {name, island, elevation_m, lat, lng} | null }
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
  const points = record.data?.points || null

  const { xs, ys, count, lo, hi } = useMemo(() => {
    const X = [], Y = []
    let n = 0, min = Infinity, max = -Infinity
    for (const p of points || []) {
      const t = epochOf(p[0])
      if (t == null) continue
      const val = p[1] == null || !Number.isFinite(p[1]) ? null : toDisplay(p[1], v.dataset, v.opts)
      X.push(t); Y.push(val)
      if (val != null) { n++; if (val < min) min = val; if (val > max) max = val }
    }
    return { xs: X, ys: Y, count: n, lo: n ? min : null, hi: n ? max : null }
  }, [points, v.dataset, v.opts.units]) // eslint-disable-line react-hooks/exhaustive-deps

  const [hover, setHover] = useState(null)
  useEffect(() => { setHover(null) }, [xs])

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
    ? [`SKN ${selection.skn}`, station?.island, station?.elevation_m != null ? `${Math.round(station.elevation_m)} m` : null].filter(Boolean).join(' · ')
    : 'A grid cell of the gridded product — a virtual station'
  const seriesLabel = `${ds?.label || v.dataset}, ${tsp === 'day' ? 'daily' : 'monthly'}`
  const ariaLabel = `${heading}: ${seriesLabel} time series`

  const download = () => {
    if (!points) return
    saveText(buildCsv(points, v.dataset, v.opts), csvFilename(selection, v.dataset, tsp))
  }

  const status = !window_ ? (whole.status === 'error' ? 'error' : 'loading') : record.status
  const hoverText = hover && hover.t != null
    ? `${shortDate(new Date(hover.t * 1e3).toISOString().slice(0, tsp === 'day' ? 10 : 7))} · ${hover.v == null ? 'no value' : `${hover.v.toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`}`
    : null
  const summary = count
    ? `${count.toLocaleString('en-US')} ${tsp === 'day' ? 'days' : 'months'} · ${lo.toLocaleString('en-US', { maximumFractionDigits: 2 })} to ${hi.toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`
    : null

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
          {hoverText || summary || (window_ ? `${shortDate(window_.start)} to ${shortDate(window_.end)}` : '')}
        </p>
      </div>

      <div className="relative min-h-[200px]" aria-busy={status === 'loading'}>
        {status === 'ready' && xs.length > 0 && (
          <Chart xs={xs} ys={ys} label={seriesLabel} unit={unit} period={tsp} floorZero={NON_NEGATIVE.has(ds?.api?.datatype)} onHover={setHover} />
        )}
        {status === 'ready' && xs.length === 0 && <p className="text-sm text-subtle" data-testid="timeseries-empty">No values in this window.</p>}
        {status === 'loading' && (
          <p className="flex items-center gap-2 text-sm text-subtle" role="status" data-testid="timeseries-loading">
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

      <Segmented legend="Window" name="ts-window" value={custom ? 'custom' : activePreset} options={presetOptions} onChange={choosePreset} testid="ts-window" />
      {custom && <CustomWindow period={tsp} value={window_} whole={whole.range} onChange={onRange} />}
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
