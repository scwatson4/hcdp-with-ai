// The shareable climate viewer behind
//   /viewer/{dataset}/{period}/{date}/{extent}[?options]   (CONTRACT.md)
// The URL is the state: every control navigates to a new address (push for
// dataset, period, date, place, station and pin — Back undoes a choice;
// replace for display options and map moves — Back never retraces a pan),
// and loading any address restores everything. An address spelled with an
// alias or the first grammar's keys is rewritten to its canonical spelling
// on load (replace). /viewer alone is the launcher; an address the grammar
// rejects gets a friendly page.

import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'
import { DATASETS, DEFAULT_BASEMAP, DEFAULT_OPACITY, EXTENTS, LAYER_KEYS, canonicalize, describeViewer, foreignQuery, formatViewerPath, hasStations, parseViewerPath } from './urlGrammar'
import { scheduleUrlWrite } from './urlWrites'
import { readUnitsPreference, writeUnitsPreference } from './unitsPreference'
import { CLIMATE_STATIONS_URL, findStation, stationValuesUrl, stationsOf, useJson } from './map/stationData'
import { NAMED_RAMPS, makeColorFn, rampPosition, valueAtLatLng } from './map/ramps'
import {
  clampDate, compareDateFor, dateForPeriod, defaultRampFor, domainFor, formatValue, hasExtremeScale,
  isExperimental, isIgnition, isLogScale, isRampReversed, isRealDate, legendFor, pathWith, rampNameFor, rasterRequestUrl, sourceLineFor,
  unitChoicesFor, unitSystem, unitsForDataset, unitsLineFor,
} from './map/viewerModel'
import { TooltipProvider } from '../components/ui/tooltip'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { useRaster } from './map/rasterCache'
import { getDateRange, getDateRangeSoon, useDateRange } from './map/dateRanges'
import { AnalyzeWithAI, ColourFields, Controls, CompareControl, DatasetField, DatePicker, LayerControls, PeriodUnitsFields, PlaceField, ScaleControls, ShareActions } from './map/Controls'
import BottomSheet from '../components/BottomSheet'
import { useNarrowScreen } from './useMediaQuery'
import { Compass, CornerStack, ExperimentalBadge, IGNITION_CAUTION, Legend, MapPill, TitleCard, ValueReadout } from './map/MapFurniture'
import { GrammarError, MapStatus } from './map/ErrorStates'
import Launcher from './map/Launcher'

const ClimateMap = lazy(() => import('./map/ClimateMap'))
const TimeSeriesPanel = lazy(() => import('./TimeSeriesPanel'))
const StationList = lazy(() => import('./StationList'))

const EYEBROW = 'font-mono text-[11px] font-medium uppercase tracking-wide text-subtle'

/** The one spelling of an address the grammar accepts (with `patch`, if
 *  any, applied to it), with any query keys that are not the grammar's
 *  (another feature's) kept after it, or null when the address is already
 *  spelled that way or is not a viewer map. */
export function canonicalRewrite(pathname, search = '', patch = null) {
  const v = parseViewerPath(pathname, search)
  if (!v || v.error) return null
  const canonical = patch ? pathWith(v, patch) : formatViewerPath(v)
  const foreign = foreignQuery(search)
  const target = canonical + (foreign ? (canonical.includes('?') ? '&' : '?') + foreign : '')
  return target === `${pathname}${search || ''}` ? null : target
}

/** The units key the remembered preference adds to an address that names
 *  none: 'in' or 'f' for an imperial preference on a dataset with units;
 *  null otherwise — and null whenever the address itself says `units=`
 *  (even `units=mm`: a key in the URL always wins). */
export function preferredUnitsFor(v, search = '', preference = readUnitsPreference()) {
  if (!v || v.error || preference !== 'imperial') return null
  if (new URLSearchParams(search).has('units')) return null
  return unitChoicesFor(v.dataset) ? unitsForDataset(v.dataset, { units: 'in' }) : null
}

export default function ViewerPage() {
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()
  const v = useMemo(() => parseViewerPath(pathname, search), [pathname, search])
  const launcher = /^\/viewer\/?$/i.test(pathname)
  // Load-time canonical rewrite: aliases, month names, the first grammar's
  // ?stations=1, keys out of order — and the remembered unit system when
  // the address names none. A replace, so Back is not affected, and the
  // parsed view is identical (units aside), so nothing below re-mounts.
  // Once an address of this visit has named its units (a pasted link, the
  // toggle, or this rewrite), they are settled: the preference never fills
  // them in again — so `units=mm`, dropped as the default, stays metric.
  const unitsSettled = useRef(false)
  if (new URLSearchParams(search).has('units')) unitsSettled.current = true
  const units = !launcher && !unitsSettled.current ? preferredUnitsFor(v, search) : null
  const rewrite = !launcher && v && !v.error ? canonicalRewrite(pathname, search, units ? { opts: { units } } : null) : null
  useEffect(() => {
    if (rewrite) navigate(rewrite + (hash || ''), { replace: true })
  }, [rewrite, hash, navigate])
  if (launcher) return <Launcher />
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

  // The view the last write in this task produced, before React has rendered
  // it: a second write in the same task (two limiter flushes, two toggles)
  // builds on it instead of on the stale rendered view.
  const written = useRef(null)

  /** Navigate to the current view with `patch` applied (a function patch is
   *  computed from the current view at write time): a push (a choice Back
   *  can undo) unless `replace`. */
  const go = useCallback((patch, replace = false) => {
    const base = written.current || latest.current
    const path = pathWith(base, typeof patch === 'function' ? patch(base) : patch)
    const q = path.indexOf('?')
    const next = q < 0 ? parseViewerPath(path) : parseViewerPath(path.slice(0, q), path.slice(q))
    written.current = next && !next.error ? next : null
    queueMicrotask(() => { written.current = null })
    navigate(path, { replace })
  }, [navigate])
  /** A replace write for one option, through the page-wide limiter (one
   *  history write per 300 ms; a burst on one key keeps only its last). */
  const set = useCallback((key, patch) => scheduleUrlWrite(key, () => go(patch, true)), [go])

  const dateRange = useDateRange(v.dataset, v.period, v.extent)
  const range = dateRange.range
  // The phone sheet's open tab (a station or pin in the address opens on its record).
  const [tab, setTab] = useState(() => (v.opts.station || v.opts.pin ? 'stations' : 'dataset'))
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
  // ?ramp=name-r and ?log=1 shape one colour function; the grid, the station
  // markers and the legend all read it, so they can never disagree.
  const reverse = isRampReversed(v)
  const log = isLogScale(v)
  const colorFn = useMemo(() => makeColorFn(ramp, domain, raster.georaster?.noDataValue, { reverse, log }), [ramp, domain, raster.georaster, reverse, log])
  const compareColorFn = useMemo(() => makeColorFn(ramp, domain, compareRaster.georaster?.noDataValue, { reverse, log }), [ramp, domain, compareRaster.georaster, reverse, log])

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
        // A chosen ramp travels; the old dataset's default does not, unless it is reversed (reverse rides on the ramp key).
        ramp: cur.opts.ramp && (cur.opts.ramp !== defaultRampFor(dataset) || cur.opts.reverse) ? cur.opts.ramp : undefined,
        scale: keepsScale(cur, dataset, period),
        // A locked range is in one product's units and scale: it does not survive a change of product or period.
        range: undefined,
        compare: samePeriod ? cur.opts.compare : undefined,
        // A station means nothing for a gridded-only product; a pin (a grid cell) survives.
        station: hasStations(dataset) ? cur.opts.station : undefined,
        // The time-series window is written in one period's date format.
        ts: samePeriod ? cur.opts.ts : undefined,
      },
    })
  }
  const onPeriod = async (period) => {
    const id = ++seq.current
    const cur = latest.current
    if (period === cur.period) return
    const r = await getDateRangeSoon(cur.dataset, period, cur.extent)
    if (id !== seq.current) return
    go({ period, date: dateForPeriod(cur.date, period, r), opts: { scale: keepsScale(cur, cur.dataset, period), range: undefined, compare: undefined, ts: undefined } })
  }
  const onDate = (date) => { seq.current++; go({ date }) }
  const onExtent = (extent) => { seq.current++; go({ extent, opts: { view: undefined } }) }
  // The ramp key carries the direction too (ramp=name-r), so the dataset's
  // default ramp is only omitted while it runs the portal's way.
  const onRamp = (name) => set('ramp', (cur) => ({ opts: { ramp: name === defaultRampFor(cur.dataset) && !cur.opts.reverse ? undefined : name } }))
  const onReverse = (on) => set('ramp', (cur) => {
    const name = rampNameFor(cur)
    return { opts: { ramp: on || name !== defaultRampFor(cur.dataset) ? name : undefined, reverse: on || undefined } }
  })
  const onLog = (on) => set('log', { opts: { log: on || undefined } })
  const onRange = (range) => set('range', { opts: { range: range || undefined } })
  // The unit system is the one thing remembered per browser (besides the theme).
  const onUnits = (u) => { writeUnitsPreference(unitSystem({ units: u })); set('units', { opts: { units: u === 'in' || u === 'f' ? u : undefined } }) }
  const onScale = (s) => set('scale', { opts: { scale: s === 'extreme' ? 'extreme' : undefined } })
  const onCompare = (date) => set('compare', { opts: { compare: date || undefined } })
  // The camera: 400 ms after the gesture ends (ClimateMap), then the limiter.
  const onViewChange = useCallback((view) => set('camera', { opts: { view } }), [set])
  // Base map, opacity, overlays: replace writes; defaults leave the URL.
  const onBasemap = (b) => set('basemap', { opts: { basemap: b === DEFAULT_BASEMAP ? undefined : b } })
  const onOpacity = (n) => set('opacity', { opts: { opacity: n === DEFAULT_OPACITY ? undefined : n } })
  // One key per overlay, and the list is built at write time, so two quick
  // toggles both land.
  const onLayerToggle = (layer, on) => set(`layers:${layer}`, (cur) => {
    const next = LAYER_KEYS.filter((k) => (k === layer ? on : (cur.opts.layers || []).includes(k)))
    return { opts: { layers: next.length ? next : undefined } }
  })
  // The slider's thumb drives the map at once; the URL follows on release.
  const opacityPct = v.opts.opacity ?? DEFAULT_OPACITY
  const [opacityDraft, setOpacityDraft] = useState(null)
  useEffect(() => { setOpacityDraft(null) }, [opacityPct])
  const mapOpacity = (opacityDraft ?? opacityPct) / 100
  const layers = v.opts.layers || []

  // ── stations and the selection ──────────────────────────────────────────
  // Below 768 px the rail becomes a bottom sheet with tabs (further down);
  // on wide screens the rail has two tabs of its own, Map and Stations.
  const narrow = useNarrowScreen()
  const [railTab, setRailTab] = useState('map')
  const stationsOn = layers.includes('stations') && hasStations(v.dataset)
  // The Stations list (the day's values joined with the station list) is
  // fetched while its tab is open, whether or not the markers are on.
  const listOn = hasStations(v.dataset) && (narrow ? tab === 'stations' : railTab === 'stations')
  const stationValues = useJson(stationsOn || listOn ? stationValuesUrl(v) : null)
  const compareStationValues = useJson(stationsOn && compareDate ? stationValuesUrl({ ...v, date: compareDate }) : null)
  const skn = v.opts.station || null
  // A selected station is placed from the day's values when they are on
  // screen, else from the station list (which also has the elevation).
  const stationMeta = useJson(skn || listOn ? CLIMATE_STATIONS_URL : null)
  const selectedStation = skn ? (findStation(stationMeta.data, skn) || findStation(stationValues.data, skn)) : null
  const pin = v.opts.pin || null
  const selected = useMemo(() => {
    if (skn) return selectedStation ? { kind: 'station', lat: selectedStation.lat, lng: selectedStation.lng } : null
    return pin ? { kind: 'pin', lat: pin.lat, lng: pin.lng } : null
  }, [skn, selectedStation?.lat, selectedStation?.lng, pin?.lat, pin?.lng]) // eslint-disable-line react-hooks/exhaustive-deps
  // Selecting is a choice: push (Back returns to the map without it). A
  // station and a pin exclude each other. The panel takes focus only for a
  // selection the visitor just made, never for one restored from the address.
  const userSelected = useRef(false)
  // From the list (`pan`), the camera moves to the station in the same
  // push, so Back undoes both the choice and the move.
  const onSelectStation = useCallback((s, { pan = false } = {}) => {
    const cur = latest.current
    if (String(cur.opts.station || '') === String(s.skn)) return
    userSelected.current = true
    const view = pan && Number.isFinite(s.lat) && Number.isFinite(s.lng)
      ? { lat: Number(s.lat.toFixed(4)), lng: Number(s.lng.toFixed(4)), z: cur.opts.view?.z ?? EXTENTS[cur.extent].zoom }
      : cur.opts.view
    go({ opts: { station: String(s.skn), pin: undefined, view } })
  }, [go])
  const onPickFromList = useCallback((s) => onSelectStation(s, { pan: true }), [onSelectStation])
  const onSelectPoint = useCallback(({ lat, lng }) => {
    const p = { lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) }
    const cur = latest.current.opts.pin
    if (cur && cur.lat === p.lat && cur.lng === p.lng) return
    userSelected.current = true
    go({ opts: { pin: p, station: undefined } })
  }, [go])
  // Closing is the inverse of selecting: a push too, so Back reopens it.
  const onCloseSeries = useCallback(() => {
    userSelected.current = false
    go({ opts: { station: undefined, pin: undefined, ts: undefined, tsp: undefined } })
  }, [go])
  const onTsRange = useCallback((range) => set('ts', { opts: { ts: range || undefined } }), [set])
  // A window is written in one period's date format: the other period starts over.
  const onTsPeriod = useCallback((p) => set('tsp', (cur) => ({ opts: { tsp: p === cur.period ? undefined : p, ts: undefined } })), [set])
  const selection = useMemo(() => {
    if (skn) return { kind: 'station', skn, station: selectedStation }
    return pin ? { kind: 'pin', lat: pin.lat, lng: pin.lng } : null
  }, [skn, selectedStation, pin?.lat, pin?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  // What "Copy link" copies: the canonical spelling of this address (what
  // the bar shows after the load-time rewrite), never the raw href.
  const { pathname, search } = useLocation()
  const sharePath = canonicalize(pathname, search) || formatViewerPath(v)

  // One sync bus per viewer for the side-by-side maps.
  const busRef = useRef(null)
  if (!busRef.current) busRef.current = { maps: new Set(), leader: null, guard: false }

  // The phone sheet's tabs: a fresh selection opens the Stations tab (which
  // shows the selected station's record); closing it leaves the tab on the list.
  const [snap, setSnap] = useState('peek')
  const hadSelection = useRef(Boolean(selection))
  useEffect(() => {
    if (selection && !hadSelection.current) { setTab('stations'); if (userSelected.current) setSnap((s) => (s === 'peek' ? 'half' : s)) }
    hadSelection.current = Boolean(selection)
  }, [selection])

  const pane = (date, r, fn, extra) => (
    <MapPane
      v={v} date={date} raster={r} colorFn={fn} ramp={ramp} domain={domain} reverse={reverse} log={log} dateRange={dateRange}
      opacity={mapOpacity} layers={layers} selected={selected} onSelectStation={onSelectStation} onSelectPoint={onSelectPoint}
      syncBus={compareDate ? busRef.current : null} flush={narrow} {...extra}
    />
  )
  const panel = (className) => selection && (
    <Suspense fallback={<div className="rounded-lg border border-border bg-card p-4 text-sm text-subtle" data-testid="timeseries-skeleton">Loading the time series…</div>}>
      <TimeSeriesPanel
        v={v} selection={selection} onRange={onTsRange} onPeriod={onTsPeriod} onClose={onCloseSeries}
        focusOnOpen={userSelected.current} className={className}
      />
    </Suspense>
  )
  const stationProps = (sv) => (stationsOn ? { stations: sv.status === 'ready' ? stationsOf(sv.data) : null, stationStatus: sv.status } : {})
  const title = describeViewer(v)
  const stationList = (hint = null, className = '') => (
    <Suspense fallback={<p className="text-sm text-subtle" data-testid="station-list-skeleton">Loading the station list…</p>}>
      <StationList
        v={v} values={stationValues.data} meta={stationMeta.data} status={stationValues.status} selectedSkn={skn}
        onSelect={onPickFromList} hint={hint} className={className}
      />
    </Suspense>
  )
  // Item 16: the units and the source/citation are text beside the map, not on its title card.
  const addressNote = (
    <div className="space-y-1 text-xs text-subtle" data-testid="map-note">
      <p><span data-testid="viewer-units">{unitsLineFor(v)}</span> · <span data-testid="viewer-source">Source: {sourceLineFor(v)}</span></p>
      <p>The address bar always describes this map. <Link to="/viewer" className="underline underline-offset-4 hover:text-foreground">How viewer addresses work</Link></p>
    </div>
  )

  // Map heights: the viewport minus the sticky block (header + the docked ask bar's 3.5 rem row, R1 D) and
  // the bars above the map; the phone layout also leaves room for the sheet's peek.
  const single = narrow ? 'h-[calc(100dvh-16.75rem)] min-h-[300px]' : 'h-[68vh] min-h-[360px] sm:h-[min(72vh,640px)] lg:h-[calc(100dvh-12rem)] lg:min-h-[480px]'
  const half = narrow ? 'h-[40vh] min-h-[220px]' : 'h-[48vh] min-h-[300px] sm:h-[min(72vh,640px)] lg:h-[calc(100dvh-12rem)] lg:min-h-[480px]'
  const maps = compareDate ? (
    <div className={cn('grid grid-cols-1 sm:grid-cols-2', narrow ? 'gap-1' : 'gap-3')} data-testid="compare-view">
      <div className={half}>{pane(v.date, raster, colorFn, { onViewChange, leader: true, showLegend: false, ...stationProps(stationValues) })}</div>
      <div className={half}>{pane(compareDate, compareRaster, compareColorFn, { showCompass: false, ...stationProps(compareStationValues) })}</div>
    </div>
  ) : (
    <div className={single}>{pane(v.date, raster, colorFn, { onViewChange, ...stationProps(stationValues) })}</div>
  )

  if (narrow) {
    const grid = 'grid grid-cols-2 gap-x-3 gap-y-4'
    const tabs = [
      {
        id: 'dataset', label: 'Dataset',
        content: (
          <div className={grid}>
            <DatasetField v={v} onChange={onDataset} />
            <PeriodUnitsFields v={v} onPeriod={onPeriod} onUnits={onUnits} />
            <PlaceField v={v} onChange={onExtent} />
            <div className="col-span-2"><AnalyzeWithAI v={v} path={sharePath} /></div>
            <div className="col-span-2"><ShareActions path={sharePath} title={title} /></div>
            <div className="col-span-2">{addressNote}</div>
          </div>
        ),
      },
      {
        id: 'date', label: 'Date',
        content: (
          <div className="space-y-4">
            <DatePicker period={v.period} date={v.date} range={range} onChange={onDate} />
            <CompareControl v={v} range={range} compareDate={compareDate} onChange={onCompare} />
          </div>
        ),
      },
      {
        id: 'layers', label: 'Layers',
        content: (
          <div className={grid}>
            <ColourFields v={v} onRamp={onRamp} onScale={onScale} />
            <div className="col-span-2"><ScaleControls v={v} onReverse={onReverse} onLog={onLog} onRange={onRange} inline /></div>
            <div className="col-span-2"><LayerControls v={v} onBasemap={onBasemap} onOpacity={onOpacity} onOpacityPreview={setOpacityDraft} onLayerToggle={onLayerToggle} /></div>
          </div>
        ),
      },
      {
        id: 'stations', label: 'Stations',
        content: panel('border-0 p-0') || (hasStations(v.dataset) ? stationList(
          <p className="text-sm text-subtle" data-testid="station-hint">
            Tap a station below or a marker on the map, or press and hold on the map, to see its record here.
            {!layers.includes('stations') ? ' Turn on Stations under Layers to see the markers.' : ''}
          </p>,
        ) : (
          <p className="text-sm text-subtle" data-testid="station-hint">
            Press and hold on the map to see a grid cell's record here. This product has no station values.
          </p>
        )),
      },
    ]
    return (
      <TooltipProvider delayDuration={300}>
        <div className="relative w-full pb-[7.75rem]" data-testid="viewer" data-layout="sheet">
          <section className="min-w-0" aria-label="Map">{maps}</section>
          <BottomSheet title={title} tabs={tabs} tab={tab} onTabChange={setTab} snap={snap} onSnapChange={setSnap} />
        </div>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-8 pt-4" data-testid="viewer" data-layout="rail">
      <div className={cn('flex flex-col gap-4 lg:grid lg:items-start lg:gap-5', selection ? 'lg:grid-cols-[18rem_minmax(0,1fr)_20rem]' : 'lg:grid-cols-[18rem_minmax(0,1fr)]')}>
        <aside className="min-w-0 space-y-4" aria-label="Map settings">
          <header>
            <p className={EYEBROW}>Climate viewer</p>
            <h1 className="mt-0.5 font-display text-xl leading-tight lg:text-2xl" data-testid="viewer-heading">{title}</h1>
          </header>
          {(() => {
            const controls = (
              <div className="space-y-4">
                <Controls
                  v={v} range={range}
                  onDataset={onDataset} onPeriod={onPeriod} onDate={onDate} onExtent={onExtent}
                  onRamp={onRamp} onUnits={onUnits} onScale={onScale} onReverse={onReverse} onLog={onLog} onRange={onRange}
                  layers={<LayerControls v={v} onBasemap={onBasemap} onOpacity={onOpacity} onOpacityPreview={setOpacityDraft} onLayerToggle={onLayerToggle} />}
                  extra={<CompareControl v={v} range={range} compareDate={compareDate} onChange={onCompare} />}
                />
                <AnalyzeWithAI v={v} path={sharePath} />
                <ShareActions path={sharePath} title={title} />
                {addressNote}
              </div>
            )
            if (!hasStations(v.dataset)) return controls
            // Two tabs: the map's settings, and the stations with a value for this date.
            return (
              <Tabs value={railTab} onValueChange={setRailTab}>
                <TabsList className="grid h-auto w-full grid-cols-2 p-0.5" aria-label="Rail sections" data-testid="rail-tabs">
                  <TabsTrigger value="map" className="h-8 font-nav font-semibold [@media(pointer:coarse)]:h-10" data-testid="rail-tab-map">Map</TabsTrigger>
                  <TabsTrigger value="stations" className="h-8 font-nav font-semibold [@media(pointer:coarse)]:h-10" data-testid="rail-tab-stations">Stations</TabsTrigger>
                </TabsList>
                <TabsContent value="map" className="mt-4">{controls}</TabsContent>
                <TabsContent value="stations" className="mt-4" data-testid="rail-stations">
                  {stationList(
                    <p className="text-xs text-subtle">The stations with a value on this date. Choose one to see its record; the map moves to it.</p>,
                    'lg:max-h-[calc(100dvh-16.5rem)] lg:overflow-y-auto',
                  )}
                </TabsContent>
              </Tabs>
            )
          })()}
        </aside>
        <section className="min-w-0" aria-label="Map">{maps}</section>
        {/* The time series: a 20 rem column beside the map on wide screens, below it otherwise. */}
        {selection && <div className="min-w-0" data-testid="timeseries-dock">{panel('lg:max-h-[calc(100dvh-12rem)] lg:overflow-y-auto')}</div>}
      </div>
    </div>
    </TooltipProvider>
  )
}

/** One map with its furniture. Hover state lives here so moving the
 *  pointer never re-renders the controls. */
const MapPane = memo(function MapPane({
  v, date, raster, colorFn, ramp, domain, reverse = false, log = false, dateRange, opacity = DEFAULT_OPACITY / 100, layers = [],
  stations = null, stationStatus = null, selected = null, onSelectStation = null, onSelectPoint = null,
  onViewChange = null, syncBus = null, leader = false, showLegend = true, showCompass = true, flush = false,
}) {
  const [hover, setHover] = useState(null)
  const [pick, setPick] = useState(null)
  // A new map (date, dataset, place) forgets the old pointer position.
  useEffect(() => { setPick(null); setHover(null) }, [raster.url])
  const ready = raster.status === 'ready'
  // No pin on the ocean: a cell without a value has no record to show.
  const georaster = ready ? raster.georaster : null
  const selectPoint = useCallback((p) => {
    if (georaster && valueAtLatLng(georaster, p.lat, p.lng) == null) return
    onSelectPoint?.(p)
  }, [georaster, onSelectPoint])
  const point = hover || pick
  const value = point && ready ? valueAtLatLng(raster.georaster, point.lat, point.lng) : null
  const readout = point && ready ? (value == null ? 'no data here' : formatValue(value, v.dataset, v.opts)) : null
  const tick = value != null ? rampPosition(value, domain.min, domain.max, log) : null
  const shown = { ...v, date }
  const title = describeViewer(shown)
  const legend = legendFor(v)
  return (
    <div className={cn('hcdp-pane relative isolate h-full w-full overflow-hidden bg-inset', flush ? 'border-y border-border' : 'rounded-lg border border-border')} role="region" aria-label={`Map: ${title}`} data-testid="map-pane">
      <Suspense fallback={<div className="absolute inset-0 animate-pulse bg-muted" data-testid="map-skeleton" />}>
        <ClimateMap
          extent={v.extent} view={v.opts.view || null} onViewChange={onViewChange}
          georaster={ready ? raster.georaster : null} colorFn={colorFn}
          basemap={v.opts.basemap || DEFAULT_BASEMAP} opacity={opacity} layers={layers}
          stations={stations} selected={selected} onSelectStation={onSelectStation} onSelectPoint={onSelectPoint ? selectPoint : null}
          formatValue={(val) => formatValue(val, v.dataset, v.opts)}
          onHover={setHover} onPick={setPick} syncBus={syncBus} leader={leader}
        />
      </Suspense>
      <TitleCard title={title} caution={isIgnition(v) ? IGNITION_CAUTION : null} />
      <CornerStack>
        {isExperimental(v) && <ExperimentalBadge />}
        {stationStatus === 'loading' && (
          <MapPill testid="stations-loading"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> stations…</MapPill>
        )}
        {stationStatus === 'notfound' && <MapPill quiet testid="stations-none">no station values for this date</MapPill>}
        {stationStatus === 'error' && <MapPill quiet testid="stations-error">station values did not load</MapPill>}
      </CornerStack>
      {showLegend && <Legend header={legend.header} labels={legend.labels} ramp={ramp} reverse={reverse} tick={tick} />}
      {showCompass && <Compass />}
      <ValueReadout text={readout} />
      <MapStatus v={shown} raster={raster} dateRange={dateRange} />
    </div>
  )
})
