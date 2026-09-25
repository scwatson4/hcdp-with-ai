// The shareable climate viewer behind
//   /viewer/{dataset}/{period}/{date}/{extent}[?ramp&scale&units&stations&lat&lng&z&compare]
// The URL is the state: every control navigates to a new address (push for
// dataset, period, date and place; replace for display options and map
// moves), and loading any address restores everything. /viewer alone is
// the launcher; an address the grammar rejects gets a friendly page.

import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { DATASETS, describeViewer, formatViewerPath, parseViewerPath } from './urlGrammar'
import { NAMED_RAMPS, makeColorFn, rampPosition, valueAtLatLng } from './map/ramps'
import {
  clampDate, compareDateFor, dateForPeriod, defaultRampFor, domainFor, formatValue, hasExtremeScale,
  isRealDate, legendFor, pathWith, rampNameFor, rasterRequestUrl, sourceLineFor, unitsForDataset, unitsLineFor,
} from './map/viewerModel'
import { useRaster } from './map/rasterCache'
import { getDateRange, getDateRangeSoon, useDateRange } from './map/dateRanges'
import { Controls, CompareControl, ShareActions } from './map/Controls'
import { Compass, Legend, TitleCard, ValueReadout } from './map/MapFurniture'
import { GrammarError, MapStatus } from './map/ErrorStates'
import Launcher from './map/Launcher'

const ClimateMap = lazy(() => import('./map/ClimateMap'))

const EYEBROW = 'font-mono text-[11px] font-medium uppercase tracking-wide text-subtle'

export default function ViewerPage() {
  const { pathname, search } = useLocation()
  const v = useMemo(() => parseViewerPath(pathname, search), [pathname, search])
  if (/^\/viewer\/?$/i.test(pathname)) return <Launcher />
  if (!v || v.error) return <GrammarError error={v?.error || 'incomplete'} pathname={pathname} search={search} />
  // The grammar reads 2026-02-30 as a date; the calendar does not.
  if (!isRealDate(v.date, v.period)) return <GrammarError error={`no such date ${v.date}`} pathname={pathname} search={search} />
  return <Viewer v={v} />
}

/** Whether a dataset/period keeps ?scale=extreme (daily rainfall only). */
const keepsScale = (v, dataset, period) => (hasExtremeScale({ ...v, dataset, period }) ? v.opts.scale : undefined)

function Viewer({ v }) {
  const navigate = useNavigate()
  const latest = useRef(v)
  latest.current = v
  const seq = useRef(0)

  /** Navigate to the current view with `patch` applied. */
  const go = useCallback((patch, replace = false) => {
    navigate(pathWith(latest.current, patch), { replace })
  }, [navigate])

  const dateRange = useDateRange(v.dataset, v.period, v.extent)
  const range = dateRange.range
  const raster = useRaster(rasterRequestUrl(v))
  const compareDate = compareDateFor(v)
  const compareRaster = useRaster(compareDate ? rasterRequestUrl({ ...v, date: compareDate }) : null)

  // The other period's range, so the period toggle can land on a published date at once.
  useEffect(() => {
    for (const p of DATASETS[v.dataset].periods) if (p !== v.period) getDateRange(v.dataset, p, v.extent).catch(() => {})
  }, [v.dataset, v.period, v.extent])

  useEffect(() => {
    const before = document.title
    document.title = `${describeViewer(v)} · HCDP climate viewer`
    return () => { document.title = before }
  }, [v.dataset, v.period, v.date, v.extent]) // eslint-disable-line react-hooks/exhaustive-deps

  const ramp = NAMED_RAMPS[rampNameFor(v)]
  const { min, max } = domainFor(v)
  const domain = useMemo(() => ({ min, max }), [min, max])
  const colorFn = useMemo(() => makeColorFn(ramp, domain, raster.georaster?.noDataValue), [ramp, domain, raster.georaster])
  const compareColorFn = useMemo(() => makeColorFn(ramp, domain, compareRaster.georaster?.noDataValue), [ramp, domain, compareRaster.georaster])

  // ── control handlers ────────────────────────────────────────────────────
  const onDataset = async (dataset) => {
    const id = ++seq.current
    const cur = latest.current
    const periods = DATASETS[dataset].periods
    const period = periods.includes(cur.period) ? cur.period : periods[0]
    const r = await getDateRangeSoon(dataset, period, cur.extent)
    if (id !== seq.current) return
    const samePeriod = period === cur.period
    go({
      dataset, period,
      date: samePeriod ? clampDate(cur.date, r) : dateForPeriod(cur.date, period, r),
      opts: {
        units: unitsForDataset(dataset, cur.opts),
        ramp: cur.opts.ramp && cur.opts.ramp !== defaultRampFor(dataset) ? cur.opts.ramp : undefined,
        scale: keepsScale(cur, dataset, period),
        compare: samePeriod ? cur.opts.compare : undefined,
      },
    })
  }
  const onPeriod = async (period) => {
    const id = ++seq.current
    const cur = latest.current
    if (period === cur.period) return
    const r = await getDateRangeSoon(cur.dataset, period, cur.extent)
    if (id !== seq.current) return
    go({ period, date: dateForPeriod(cur.date, period, r), opts: { scale: keepsScale(cur, cur.dataset, period), compare: undefined } })
  }
  const onDate = (date) => { seq.current++; go({ date }) }
  const onExtent = (extent) => { seq.current++; go({ extent, opts: { view: undefined } }) }
  const onRamp = (name) => go({ opts: { ramp: name === defaultRampFor(latest.current.dataset) ? undefined : name } }, true)
  const onUnits = (u) => go({ opts: { units: u === 'in' || u === 'f' ? u : undefined } }, true)
  const onScale = (s) => go({ opts: { scale: s === 'extreme' ? 'extreme' : undefined } }, true)
  const onCompare = (date) => go({ opts: { compare: date || undefined } }, true)
  const onViewChange = useCallback((view) => go({ opts: { view } }, true), [go])

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const shareUrl = origin + formatViewerPath(v)

  // One sync bus per viewer for the side-by-side maps.
  const busRef = useRef(null)
  if (!busRef.current) busRef.current = { maps: new Set(), leader: null, guard: false }

  const pane = (date, r, fn, extra) => (
    <MapPane
      v={v} date={date} raster={r} colorFn={fn} ramp={ramp} domain={domain} dateRange={dateRange}
      syncBus={compareDate ? busRef.current : null} {...extra}
    />
  )

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-8 pt-4" data-testid="viewer">
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-5">
        <aside className="min-w-0 space-y-4" aria-label="Map settings">
          <header>
            <p className={EYEBROW}>Climate viewer</p>
            <h1 className="mt-0.5 font-display text-xl leading-tight lg:text-2xl" data-testid="viewer-heading">{describeViewer(v)}</h1>
          </header>
          <Controls
            v={v} range={range}
            onDataset={onDataset} onPeriod={onPeriod} onDate={onDate} onExtent={onExtent}
            onRamp={onRamp} onUnits={onUnits} onScale={onScale}
            extra={<CompareControl v={v} range={range} compareDate={compareDate} onChange={onCompare} />}
          />
          <ShareActions url={shareUrl} />
          {v.opts.stations && (
            <p className="text-xs text-subtle" data-testid="stations-note">
              This link asks for station markers; they are not in this preview yet, so the map shows the gridded values only.
            </p>
          )}
          <p className="text-xs text-subtle">
            The address bar always describes this map. <Link to="/viewer" className="underline underline-offset-4 hover:text-foreground">How viewer addresses work</Link>
          </p>
        </aside>
        <section className="min-w-0" aria-label="Map">
          {compareDate ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="compare-view">
              <div className="h-[48vh] min-h-[300px] sm:h-[min(72vh,640px)] lg:h-[calc(100dvh-8.5rem)] lg:min-h-[480px]">
                {pane(v.date, raster, colorFn, { onViewChange, leader: true, showLegend: false })}
              </div>
              <div className="h-[48vh] min-h-[300px] sm:h-[min(72vh,640px)] lg:h-[calc(100dvh-8.5rem)] lg:min-h-[480px]">
                {pane(compareDate, compareRaster, compareColorFn, { showCompass: false })}
              </div>
            </div>
          ) : (
            <div className="h-[68vh] min-h-[360px] sm:h-[min(72vh,640px)] lg:h-[calc(100dvh-8.5rem)] lg:min-h-[480px]">
              {pane(v.date, raster, colorFn, { onViewChange })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/** One map with its furniture. Hover state lives here so moving the
 *  pointer never re-renders the controls. */
const MapPane = memo(function MapPane({ v, date, raster, colorFn, ramp, domain, dateRange, onViewChange = null, syncBus = null, leader = false, showLegend = true, showCompass = true }) {
  const [hover, setHover] = useState(null)
  const [pick, setPick] = useState(null)
  // A new map (date, dataset, place) forgets the old pointer position.
  useEffect(() => { setPick(null); setHover(null) }, [raster.url])
  const ready = raster.status === 'ready'
  const point = hover || pick
  const value = point && ready ? valueAtLatLng(raster.georaster, point.lat, point.lng) : null
  const readout = point && ready ? (value == null ? 'no data here' : formatValue(value, v.dataset, v.opts)) : null
  const tick = value != null ? rampPosition(value, domain.min, domain.max) : null
  const shown = { ...v, date }
  const title = describeViewer(shown)
  const legend = legendFor(v)
  return (
    <div className="hcdp-pane relative isolate h-full w-full overflow-hidden rounded-lg border border-border bg-inset" role="region" aria-label={`Map: ${title}`} data-testid="map-pane">
      <Suspense fallback={<div className="absolute inset-0 animate-pulse bg-muted" data-testid="map-skeleton" />}>
        <ClimateMap
          extent={v.extent} view={v.opts.view || null} onViewChange={onViewChange}
          georaster={ready ? raster.georaster : null} colorFn={colorFn}
          onHover={setHover} onPick={setPick} syncBus={syncBus} leader={leader}
        />
      </Suspense>
      <TitleCard title={title} unitsLine={unitsLineFor(v)} sourceLine={sourceLineFor(v)} />
      {showLegend && <Legend header={legend.header} labels={legend.labels} ramp={ramp} tick={tick} />}
      {showCompass && <Compass />}
      <ValueReadout text={readout} />
      <MapStatus v={shown} raster={raster} dateRange={dateRange} />
    </div>
  )
})
