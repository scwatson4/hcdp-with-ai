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
import { ChevronDown, Loader2, Maximize, Share2, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { DATASETS, DEFAULT_BASEMAP, DEFAULT_OPACITY, EXTENTS, LAYER_KEYS, canonicalize, describeViewer, foreignQuery, formatViewerPath, hasStations, parseViewerPath } from './urlGrammar'
import { scheduleUrlWrite } from './urlWrites'
import { readUnitsPreference, writeUnitsPreference } from './unitsPreference'
import { CLIMATE_STATIONS_URL, findStation, stationValuesUrl, stationsOf, useJson } from './map/stationData'
import { NAMED_RAMPS, makeColorFn, rampPosition, valueAtLatLng } from './map/ramps'
import {
  clampDate, compareDateFor, dateForPeriod, defaultRampFor, domainFor, formatValue, hasExtremeScale,
  isExperimental, isIgnition, isLogScale, isRampReversed, isRealDate, legendFor, pathWith, rampNameFor, rasterRequestUrl, shortDate, sourceLineFor,
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
import AISummary from '../assistant/AISummary'
import { useViewFollowups } from '../assistant/useViewFollowups'
import { useAssistantOptional } from '../assistant/AssistantProvider'
import { ASK_SHEET, openAskSheetFromTap } from '../assistant/askSheetState'
import { liveState, useOverlayHistory } from '../components/overlayHistory'
import { useClaimShell } from '../components/shellMode'
import { OriginalVersionLink } from '../components/OriginalLink'
import Toast, { useToast } from '../components/Toast'
import MiniAsk from '../assistant/MiniAsk'

const ClimateMap = lazy(() => import('./map/ClimateMap'))
const TimeSeriesPanel = lazy(() => import('./TimeSeriesPanel'))
const StationList = lazy(() => import('./StationList'))

const EYEBROW = 'font-mono text-[12px] font-medium uppercase tracking-wide text-subtle'
// M1 C: the phone viewer's Controls sheet is an overlay with its own history entry (Back closes it).
export const CONTROLS_SHEET = 'controls'
// QB-T3 B: the desktop viewer's full-screen map is one too (Back, Esc or ✕ exits).
export const FULL_MAP = 'full'

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
  const { pathname, search, hash, state } = useLocation()
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
  // (the rewrite keeps the entry's history state: an overlay open on it — the phone's Controls sheet — stays open)
  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(() => {
    if (rewrite) navigate(rewrite + (hash || ''), { replace: true, state: liveState() ?? stateRef.current ?? null })
  }, [rewrite, hash, navigate])
  if (launcher) return <Launcher />
  if (!v || v.error) return <GrammarError error={v?.error || 'incomplete'} pathname={pathname} search={search} />
  // The grammar reads 2026-02-30 as a date; the calendar does not.
  if (!isRealDate(v.date, v.period)) return <GrammarError error={`no such date ${v.date}`} pathname={pathname} search={search} />
  return <Viewer v={v} />
}

/** The full-screen map's entry is "the same address" while only the camera moved (it moves by itself as the map resizes). */
export function sameMapIgnoringCamera(a, b) {
  const strip = (s) => { const [p, q = ''] = String(s).split('#')[0].split('?'); const u = new URLSearchParams(q); for (const k of ['lat', 'lng', 'z']) u.delete(k); const r = u.toString(); return r ? `${p}?${r}` : p }
  return strip(a) === strip(b)
}

/** Whether a dataset/period keeps ?scale=extreme (daily rainfall only). */
const keepsScale = (v, dataset, period) => (hasExtremeScale({ ...v, dataset, period }) ? v.opts.scale : undefined)

function Viewer({ v }) {
  const navigate = useNavigate()
  const latest = useRef(v)
  latest.current = v
  // The history state rides along with every write, so an overlay open over the map (the phone's Controls sheet, the
  // full-screen map) stays open while its controls move the map.
  const routeState = useRef(null)
  routeState.current = useLocation().state
  const seq = useRef(0)
  // N4 A (13 Oct): a rail change (dataset, period, date, extent) refreshes the docked bar's follow-up asks for the new view.
  useViewFollowups(v)

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
    navigate(path, { replace, state: liveState() ?? routeState.current ?? null })
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
  // Below 768 px the viewer is a full-screen map with its controls in a bottom sheet (further down);
  // on wide screens the rail has two tabs of its own, Map and Stations.
  const narrow = useNarrowScreen()
  // M1 C (14 Oct): the phone viewer holds the shell in 'phone-map' (no docked bar, no footer, the page never scrolls).
  useClaimShell('phone-map', narrow)
  const controlsSheet = useOverlayHistory(CONTROLS_SHEET)
  const askSheet = useOverlayHistory(ASK_SHEET)
  const { toast, show: showToast } = useToast()
  const assistant = useAssistantOptional()
  // QB-T3 B (14 Oct): on wide screens a ⛶ on the map enters a full-screen map (the shell's header and docked bar give
  // way, the map fills the viewport) with its own history entry; Esc, the ✕ in the same place, or Back exits. The
  // assistant is the mini Ask AI box at the bottom-left, folding into an Ask AI pill.
  const fullMap = useOverlayHistory(FULL_MAP, { sameAddress: sameMapIgnoringCamera })
  const fullOn = fullMap.isOpen && !narrow
  useClaimShell('map-full', fullOn)
  const [miniFolded, setMiniFolded] = useState(false)
  useEffect(() => { if (!fullOn) setMiniFolded(false) }, [fullOn])
  useEffect(() => {
    if (!fullOn) return undefined
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) fullMap.close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullOn, fullMap])
  const toggleFull = useCallback(() => { if (fullMap.isOpen) fullMap.close(); else fullMap.open() }, [fullMap])
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

  // The phone sheet's tabs: a fresh selection opens the Stations tab (which shows the selected station's record) and,
  // on a phone, opens the Controls sheet on it at half height; closing it leaves the tab on the list. A station or pin
  // in the address opens the sheet on arrival too (a tick later, after the load-time rewrite).
  const [snap, setSnap] = useState('half')
  const hadSelection = useRef(Boolean(selection))
  const openControls = useCallback((which = null) => {
    if (which) setTab(which)
    setSnap('half')
    controlsSheet.open()
  }, [controlsSheet])
  useEffect(() => {
    if (selection && !hadSelection.current) { setTab('stations'); if (userSelected.current && narrow) openControls('stations') }
    hadSelection.current = Boolean(selection)
  }, [selection]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!narrow || !selection) return undefined
    const t = setTimeout(() => openControls('stations'), 0)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pane = (date, r, fn, extra) => (
    <MapPane
      v={v} date={date} raster={r} colorFn={fn} ramp={ramp} domain={domain} reverse={reverse} log={log} dateRange={dateRange}
      opacity={mapOpacity} layers={layers} selected={selected} onSelectStation={onSelectStation} onSelectPoint={onSelectPoint}
      syncBus={compareDate ? busRef.current : null} phone={narrow} {...extra}
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

  // Map heights (items 14 and 17): on desktop the map fills the viewport below the sticky block (header +
  // docked bar, measured by App.jsx into --hcdp-sticky-h) less the page's 1 rem of padding above and below,
  // never under 480 px, and the map column is sticky so the rail scrolls under it; on phones (M1 C) the map
  // fills the screen under the header — two maps of a comparison share it, one above the other.
  const single = narrow || fullOn ? 'h-full' : 'h-[68vh] min-h-[360px] sm:h-[min(72vh,640px)] lg:h-[calc(100dvh-var(--hcdp-sticky-h,10.5rem)-2rem)] lg:min-h-[480px]'
  const half = narrow || fullOn ? 'min-h-0' : 'h-[48vh] min-h-[300px] sm:h-[min(72vh,640px)] lg:h-[calc(100dvh-var(--hcdp-sticky-h,10.5rem)-2rem)] lg:min-h-[480px]'
  const fullProps = narrow ? {} : { onFull: toggleFull, full: fullOn }
  const maps = compareDate ? (
    <div className={cn('grid', narrow ? 'h-full grid-rows-2 gap-1' : fullOn ? 'h-full grid-cols-2 gap-1' : 'grid-cols-1 gap-3 sm:grid-cols-2')} data-testid="compare-view">
      <div className={half}>{pane(v.date, raster, colorFn, { onViewChange, leader: true, showLegend: false, top: true, ...fullProps, ...stationProps(stationValues) })}</div>
      <div className={half}>{pane(compareDate, compareRaster, compareColorFn, { showCompass: false, second: true, ...stationProps(compareStationValues) })}</div>
    </div>
  ) : (
    <div className={single}>{pane(v.date, raster, colorFn, { onViewChange, ...fullProps, ...stationProps(stationValues) })}</div>
  )

  if (narrow) {
    const grid = 'grid grid-cols-2 gap-x-3 gap-y-4'
    const copied = () => showToast('Link copied')
    const tabs = [
      {
        id: 'dataset', label: 'Dataset',
        content: (
          <div className={grid}>
            <DatasetField v={v} onChange={onDataset} />
            <PeriodUnitsFields v={v} onPeriod={onPeriod} onUnits={onUnits} />
            <PlaceField v={v} onChange={onExtent} />
            <div className="col-span-2"><AnalyzeWithAI v={v} path={sharePath} /></div>
            <div className="col-span-2"><ShareActions path={sharePath} title={title} onCopied={copied} /></div>
            {/* M1 C: "Original HCDP version" and the viewer's own words live here on a phone */}
            <div className="col-span-2"><OriginalVersionLink row /></div>
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
    // Share: the system share sheet where there is one, else the canonical link copied and confirmed in a toast.
    const share = async () => {
      const url = (typeof window !== 'undefined' ? window.location.origin : '') + sharePath
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') { try { await navigator.share({ title, url }) } catch { /* dismissed */ } return }
      try { await navigator.clipboard.writeText(url); showToast('Link copied') } catch { openControls('dataset') }   // refused: the sheet's Copy link has the manual field
    }
    const askFrom = (e) => {
      const r = e?.currentTarget?.getBoundingClientRect?.()
      openAskSheetFromTap(askSheet.open, { focus: false, from: r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null })
    }
    const overview = assistant?.summary && assistant.summary.path === pathname
    return (
      <TooltipProvider delayDuration={300}>
        {/* M1 C (14 Oct): a full-screen map like a maps app — the map fills the screen under the header and the page never
            scrolls; reading chips float at the top (dataset · date · place: a tap opens the sheet where that is set), the
            floating bar holds Controls (the bottom sheet with the rail's controls, 44 px rows and 16 px fields), Share and
            the Ask AI pill (the M2 A sheet); "Original HCDP version" and the viewer's own words live in the sheet; the
            legend is a strip and the zoom control sits bottom-right, clear of the chips; Copy link confirms in a toast. */}
        <div className="fixed inset-x-0 bottom-0 z-30 overflow-hidden bg-inset" style={{ top: 'var(--hcdp-sticky-h, 3rem)', '--hcdp-fab-clear': 'calc(68px + env(safe-area-inset-bottom, 0px))' }} data-testid="viewer" data-layout="phone-map">
          <section className="absolute inset-0" aria-label="Map">{maps}</section>
          <ReadingChips v={v} onOpen={openControls} />
          {overview && (
            /* the AI overview of a page the assistant opened floats under the chips (✕ dismisses it) */
            <div className="absolute inset-x-2 top-[3.75rem] z-[1001] max-h-[45%] overflow-y-auto overscroll-contain rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur" data-testid="phone-overview">
              <AISummary />
            </div>
          )}
          <div role="toolbar" aria-label="Map tools" data-testid="viewer-fab" className="absolute inset-x-3 z-[1002] flex items-center gap-2" style={{ bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}>
            <button type="button" onClick={() => openControls()} aria-expanded={controlsSheet.isOpen} data-testid="fab-controls"
              className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-[#1b1b1b] px-4 text-[15px] font-semibold text-white shadow-lg hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Controls
            </button>
            <button type="button" onClick={share} aria-label="Share this map" data-testid="fab-share"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-border bg-card text-foreground shadow-lg hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Share2 className="h-5 w-5" aria-hidden="true" />
            </button>
            {/* pill-in-the-bar: the same "Ask AI" pill as the full-screen desktop map's, here the bar's third button */}
            <button type="button" onClick={askFrom} data-testid="fab-ask"
              className="hcdp-rainbow-border h-12 shrink-0 rounded-full px-5 text-[15px] font-semibold text-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Ask AI
            </button>
          </div>
          <BottomSheet title={title} tabs={tabs} tab={tab} onTabChange={setTab} snap={snap} onSnapChange={setSnap} open={controlsSheet.isOpen} onClose={controlsSheet.close} ariaLabel="Map controls" />
          <Toast toast={toast} className="z-[1200]" style={{ bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' }} />
        </div>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-8 pt-4" data-testid="viewer" data-layout="rail">
      <div className={cn('flex flex-col gap-4 lg:grid lg:items-start lg:gap-5', selection ? 'lg:grid-cols-[18rem_minmax(0,1fr)_20rem]' : 'lg:grid-cols-[18rem_minmax(0,1fr)]')}>
        <aside className="min-w-0 space-y-4" aria-label="Map settings">
          {/* 13 Oct: the assistant's AI summary tops the rail when it brought the visitor here. */}
          <AISummary />
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
                    'lg:max-h-[calc(100dvh-var(--hcdp-sticky-h,10.5rem)-6rem)] lg:overflow-y-auto',
                  )}
                </TabsContent>
              </Tabs>
            )
          })()}
        </aside>
        {/* Item 14: on desktop the map stays put under the sticky block while the rail scrolls. QB-T3 B: full screen, the
            column covers the viewport (the rail stays mounted underneath, so its overview waits for the normal page). */}
        <section className={cn('min-w-0', fullOn ? 'fixed inset-0 z-[60] bg-inset' : 'lg:sticky lg:top-[calc(var(--hcdp-sticky-h,10.5rem)+1rem)]')} aria-label="Map" data-testid="map-column"
          data-full={fullOn ? 'true' : undefined} style={fullOn ? { '--hcdp-mini-clear': miniFolded ? '68px' : '150px' } : undefined}>
          {maps}
          {fullOn && assistant && <MiniAsk folded={miniFolded} onFold={() => setMiniFolded(true)} onUnfold={() => setMiniFolded(false)} />}
        </section>
        {/* The time series: a 20 rem column beside the map on wide screens, below it otherwise. */}
        {selection && <div className="min-w-0" data-testid="timeseries-dock">{panel('lg:max-h-[calc(100dvh-var(--hcdp-sticky-h,10.5rem)-2rem)] lg:overflow-y-auto')}</div>}
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
  onViewChange = null, syncBus = null, leader = false, showLegend = true, showCompass = true, phone = false, top = false, second = false,
  onFull = null, full = false,
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
  // M1 C: on a phone the pane runs edge to edge under the reading chips and over the floating bar (whose height,
  // --hcdp-fab-clear, lifts the legend strip, the scale bar and the zoom control — not on the upper map of a comparison).
  return (
    <div className={cn('hcdp-pane relative isolate h-full w-full overflow-hidden bg-inset', phone ? '' : 'rounded-lg border border-border')} role="region" aria-label={`Map: ${title}`} data-testid="map-pane"
      data-phone={phone ? 'true' : undefined} style={phone && top ? { '--hcdp-fab-clear': '0px' } : undefined}>
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
      {/* on a phone the reading chips carry the title (the second map of a comparison keeps a one-line card) */}
      {!phone && <TitleCard title={title} caution={isIgnition(v) ? IGNITION_CAUTION : null} />}
      {phone && second && <TitleCard title={title} compact />}
      {/* QB-T3 B: the full-screen toggle, under Leaflet's zoom control like the portal's other map buttons (44 px on touch);
          the same place shows ✕ to come back */}
      {onFull && (
        <button type="button" onClick={onFull} aria-label={full ? 'Exit full screen' : 'Full-screen map'} title={full ? 'Exit full screen (Esc)' : 'Full-screen map'} aria-pressed={full} data-testid="map-fullscreen"
          className="absolute left-[10px] top-[80px] z-[1000] grid h-[34px] w-[34px] place-items-center rounded-[4px] border-2 border-black/20 bg-white bg-clip-padding text-[#333] hover:bg-[#f4f4f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:top-[108px] [@media(pointer:coarse)]:h-12 [@media(pointer:coarse)]:w-12">
          {full ? <X className="h-4 w-4" aria-hidden="true" /> : <Maximize className="h-4 w-4" aria-hidden="true" />}
        </button>
      )}
      <CornerStack className={phone ? (second ? 'top-12' : 'top-[3.75rem]') : onFull ? 'top-[122px] [@media(pointer:coarse)]:top-[164px]' : undefined}>
        {isExperimental(v) && <ExperimentalBadge />}
        {phone && !second && isIgnition(v) && <MapPill quiet testid="viewer-caution">{IGNITION_CAUTION}</MapPill>}
        {stationStatus === 'loading' && (
          <MapPill testid="stations-loading"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> stations…</MapPill>
        )}
        {stationStatus === 'notfound' && <MapPill quiet testid="stations-none">no station values for this date</MapPill>}
        {stationStatus === 'error' && <MapPill quiet testid="stations-error">station values did not load</MapPill>}
      </CornerStack>
      {showLegend && <Legend header={legend.header} labels={legend.labels} ramp={ramp} reverse={reverse} tick={tick} layout={phone ? 'strip' : 'vertical'} />}
      {showCompass && !phone && <Compass />}
      <ValueReadout text={readout} phone={phone} />
      <MapStatus v={shown} raster={raster} dateRange={dateRange} />
    </div>
  )
})

/** M1 C: the phone viewer's reading chips — dataset · date · place, floating at the top of the map; a tap opens the
 *  Controls sheet where that is set (the date on the Date tab, the others on the Dataset tab). 44 px tall. */
function ReadingChips({ v, onOpen }) {
  const chips = [
    { key: 'dataset', label: DATASETS[v.dataset]?.label || v.dataset, tab: 'dataset', what: 'dataset' },
    { key: 'date', label: shortDate(v.date), tab: 'date', what: 'date' },
    { key: 'place', label: EXTENTS[v.extent]?.label || v.extent, tab: 'dataset', what: 'place' },
  ]
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[1001] flex gap-2 overflow-x-auto px-3 pb-1 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="reading-chips">
      {chips.map((c) => (
        <button key={c.key} type="button" onClick={() => onOpen(c.tab)} data-testid="reading-chip" data-chip={c.key} aria-label={`${c.label} — change the ${c.what}`}
          className="pointer-events-auto inline-flex h-11 shrink-0 items-center gap-1 rounded-full border border-black/10 bg-white/95 pl-4 pr-3 text-[14px] font-medium text-[#111] shadow-md backdrop-blur hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {c.label}<ChevronDown className="h-4 w-4 text-[#555]" aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
