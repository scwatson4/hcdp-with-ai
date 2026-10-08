// The stations with a value for the map's date, as a list: the HCDP v2
// rewrite's station filters and table, reduced to what fits a rail. Filters
// (island, name or SKN, elevation, value — each with an "exclude" switch, as
// in hcdp_v2) and the sort are UI chrome: they live here, never in the URL.
// Choosing a row selects the station (the same push as a marker click) and
// pans the map to it; the details are the time-series panel's header.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Loader2, Search, X } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible'
import { Switch } from '../components/ui/switch'
import { cn } from '../lib/utils'
import { LABEL } from './map/Controls'
import { islandName, stationsOf } from './map/stationData'
import { displayUnit, formatValue, fromDisplay } from './map/viewerModel'

const FIELD = 'h-9 w-full min-w-0 rounded-md border border-border bg-card px-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11'
/** Past this many rows the table shows the first MAX_ROWS and asks for a narrower filter. */
export const MAX_ROWS = 500

export const EMPTY_FILTERS = {
  islands: [], islandsNegate: false,
  text: '', textNegate: false,
  elevMin: '', elevMax: '', elevNegate: false,
  valueMin: '', valueMax: '', valueNegate: false,
}
export const SORT_KEYS = ['name', 'skn', 'island', 'elevation', 'value']

/** The day's station values joined with the station list (elevation, network, observer) by SKN. */
export function joinStations(values, meta) {
  const byMeta = new Map(stationsOf(meta).map((s) => [String(s.skn), s]))
  return stationsOf(values).map((s) => {
    const m = byMeta.get(String(s.skn)) || {}
    return {
      skn: String(s.skn), name: s.name || m.name || '', island: s.island || m.island || null, lat: s.lat ?? m.lat, lng: s.lng ?? m.lng,
      value: s.value == null || !Number.isFinite(s.value) ? null : s.value,
      elevation_m: m.elevation_m == null || !Number.isFinite(m.elevation_m) ? null : m.elevation_m,
      network: m.network || null, observer: m.observer || null,
    }
  })
}

const num = (text) => { const t = String(text ?? '').trim(); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : null }

/** hcdp_v2's range filter (inclusive here) — a missing field never matches, negated or not. */
function inRangeFilter(x, lo, hi, negate) {
  if (lo == null && hi == null) return true
  if (x == null) return false
  const hit = (lo == null || x >= lo) && (hi == null || x <= hi)
  return negate ? !hit : hit
}

/** Whether `filters` keep anything out at all. */
export function filtersActive(f) {
  return f.islands.length > 0 || f.text.trim() !== '' || num(f.elevMin) != null || num(f.elevMax) != null || num(f.valueMin) != null || num(f.valueMax) != null
}

/** The stations the filters let through. Value bounds are typed in display
 *  units and compared in native ones. */
export function filterStations(stations, f, dataset, opts = {}) {
  const text = f.text.trim().toLowerCase()
  const islands = new Set(f.islands)
  const elevLo = num(f.elevMin), elevHi = num(f.elevMax)
  const toNative = (t) => { const n = num(t); return n == null ? null : fromDisplay(n, dataset, opts) }
  let valLo = toNative(f.valueMin), valHi = toNative(f.valueMax)
  if (valLo != null && valHi != null && valLo > valHi) [valLo, valHi] = [valHi, valLo]
  return stations.filter((s) => {
    if (islands.size) {
      const hit = islands.has(String(s.island || ''))
      if (f.islandsNegate ? hit : !hit) return false
    }
    if (text) {
      const hit = s.name.toLowerCase().includes(text) || s.skn.toLowerCase().includes(text)
      if (f.textNegate ? hit : !hit) return false
    }
    if (!inRangeFilter(s.elevation_m, elevLo, elevHi, f.elevNegate)) return false
    if (!inRangeFilter(s.value, valLo, valHi, f.valueNegate)) return false
    return true
  })
}

const sortValue = (s, key) => {
  if (key === 'name') return s.name.toLowerCase() || null
  if (key === 'skn') return Number(s.skn)
  if (key === 'island') return islandName(s.island) || null
  if (key === 'elevation') return s.elevation_m
  return s.value
}

/** Sorted copy; a station without the field goes last whichever way the sort runs. */
export function sortStations(stations, key, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1
  return [...stations].sort((a, b) => {
    const x = sortValue(a, key), y = sortValue(b, key)
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    if (x < y) return -sign
    if (x > y) return sign
    return 0
  })
}

function NegateSwitch({ id, checked, onChange, testid }) {
  return (
    <label htmlFor={id} className="inline-flex items-center gap-1.5 text-xs text-subtle">
      <Switch id={id} checked={checked} onCheckedChange={onChange} data-testid={testid} className="h-4 w-7 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-[14px] [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:[&>span]:h-4 [@media(pointer:coarse)]:[&>span]:w-4 [@media(pointer:coarse)]:[&>span]:data-[state=checked]:translate-x-[18px]" />
      exclude
    </label>
  )
}

function RangeInputs({ id, lo, hi, onLo, onHi, step = 'any', placeholderLo = 'min', placeholderHi = 'max', testid }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <input id={`${id}-min`} type="number" step={step} inputMode="decimal" placeholder={placeholderLo} aria-label={`${placeholderLo}`} value={lo} onChange={(e) => onLo(e.target.value)} className={cn(FIELD, 'font-mono text-[13px]')} data-testid={`${testid}-min`} />
      <input id={`${id}-max`} type="number" step={step} inputMode="decimal" placeholder={placeholderHi} aria-label={`${placeholderHi}`} value={hi} onChange={(e) => onHi(e.target.value)} className={cn(FIELD, 'font-mono text-[13px]')} data-testid={`${testid}-max`} />
    </div>
  )
}

/** The filter block (collapsible): islands with a search box, name or SKN,
 *  elevation, value — each with an exclude switch. */
function StationFilters({ filters, onChange, islands, unit }) {
  const id = useId()
  const [open, setOpen] = useState(() => filtersActive(filters))
  const [islandSearch, setIslandSearch] = useState('')
  const set = (patch) => onChange({ ...filters, ...patch })
  const shownIslands = islands.filter((i) => !islandSearch.trim() || i.name.toLowerCase().includes(islandSearch.trim().toLowerCase()))
  const active = filtersActive(filters)
  return (
    <Collapsible open={open} onOpenChange={setOpen} data-testid="station-filters">
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="-ml-2 px-2 text-subtle [@media(pointer:coarse)]:h-11" aria-expanded={open} data-testid="station-filters-toggle">
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
            Filters{active ? ' (on)' : ''}
          </Button>
        </CollapsibleTrigger>
        {active && (
          <Button type="button" variant="ghost" size="sm" className="px-2 text-subtle [@media(pointer:coarse)]:h-11" onClick={() => onChange({ ...EMPTY_FILTERS })} data-testid="station-filters-clear">
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear
          </Button>
        )}
      </div>
      <CollapsibleContent className="space-y-3 pt-1">
        <fieldset className="min-w-0">
          <div className="mb-1 flex items-center justify-between gap-2">
            <legend className={cn(LABEL, 'mb-0')}>Island</legend>
            <NegateSwitch id={`${id}-islands-not`} checked={filters.islandsNegate} onChange={(c) => set({ islandsNegate: c })} testid="filter-islands-negate" />
          </div>
          {islands.length > 4 && (
            <div className="relative mb-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden="true" />
              <input type="search" value={islandSearch} onChange={(e) => setIslandSearch(e.target.value)} placeholder="Search islands" aria-label="Search islands" className={cn(FIELD, 'pl-7')} data-testid="filter-island-search" />
            </div>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {shownIslands.map((i) => (
              <label key={i.code} className="flex min-h-8 cursor-pointer items-center gap-1.5 text-sm [@media(pointer:coarse)]:min-h-11">
                <input
                  type="checkbox" className="h-4 w-4 rounded border-border accent-accent" checked={filters.islands.includes(i.code)}
                  onChange={(e) => set({ islands: e.target.checked ? [...filters.islands, i.code] : filters.islands.filter((c) => c !== i.code) })}
                  data-testid={`filter-island-${i.code}`}
                />
                {i.name} <span className="font-mono text-[11px] text-subtle">{i.count}</span>
              </label>
            ))}
            {!shownIslands.length && <span className="text-xs text-subtle">No island matches.</span>}
          </div>
        </fieldset>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label htmlFor={`${id}-text`} className={cn(LABEL, 'mb-0')}>Name or SKN</label>
            <NegateSwitch id={`${id}-text-not`} checked={filters.textNegate} onChange={(c) => set({ textNegate: c })} testid="filter-text-negate" />
          </div>
          <input id={`${id}-text`} type="search" value={filters.text} onChange={(e) => set({ text: e.target.value })} placeholder="Hilo, 1020.1 …" className={FIELD} data-testid="filter-text" />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className={cn(LABEL, 'mb-0')} id={`${id}-elev`}>Elevation (m)</span>
            <NegateSwitch id={`${id}-elev-not`} checked={filters.elevNegate} onChange={(c) => set({ elevNegate: c })} testid="filter-elev-negate" />
          </div>
          <RangeInputs id={`${id}-elev`} lo={filters.elevMin} hi={filters.elevMax} onLo={(t) => set({ elevMin: t })} onHi={(t) => set({ elevMax: t })} step="1" placeholderLo="lowest" placeholderHi="highest" testid="filter-elev" />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className={cn(LABEL, 'mb-0')}>Value{unit ? ` (${unit})` : ''}</span>
            <NegateSwitch id={`${id}-value-not`} checked={filters.valueNegate} onChange={(c) => set({ valueNegate: c })} testid="filter-value-negate" />
          </div>
          <RangeInputs id={`${id}-value`} lo={filters.valueMin} hi={filters.valueMax} onLo={(t) => set({ valueMin: t })} onHi={(t) => set({ valueMax: t })} placeholderLo="at least" placeholderHi="at most" testid="filter-value" />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

const COLUMNS = [
  { key: 'name', label: 'Name', className: 'text-left' },
  { key: 'skn', label: 'SKN', className: 'text-left' },
  { key: 'island', label: 'Island', className: 'text-left' },
  { key: 'elevation', label: 'Elev. m', className: 'text-right' },
  { key: 'value', label: 'Value', className: 'text-right' },
]

/**
 * `values` / `meta`: the /api/station-values and /api/climate-stations answers
 * (or null while loading); `status`: the values request's status; `selectedSkn`;
 * `onSelect(station)` selects (a push) and pans. `hint` is shown above the list.
 */
export default function StationList({ v, values, meta, status, selectedSkn = null, onSelect, hint = null, className = '' }) {
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS }))
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' })
  const unit = displayUnit(v.dataset, v.opts)
  const all = useMemo(() => joinStations(values, meta), [values, meta])
  const islands = useMemo(() => {
    const counts = new Map()
    for (const s of all) if (s.island) counts.set(String(s.island), (counts.get(String(s.island)) || 0) + 1)
    return [...counts].map(([code, count]) => ({ code, name: islandName(code), count })).sort((a, b) => a.name.localeCompare(b.name))
  }, [all])
  const rows = useMemo(() => sortStations(filterStations(all, filters, v.dataset, v.opts), sort.key, sort.dir), [all, filters, sort, v.dataset, v.opts])
  const shown = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS) : rows

  // The selected row stays in sight when the selection comes from the map.
  const body = useRef(null)
  useEffect(() => {
    if (!selectedSkn || !body.current) return
    const row = body.current.querySelector(`[data-skn="${String(selectedSkn).replace(/[^0-9.]/g, '')}"]`)   // an SKN is digits and a dot
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedSkn, rows])

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'value' || key === 'elevation' ? 'desc' : 'asc' }))
  const Arrow = ({ k }) => (sort.key !== k ? <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" /> : sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />)
  const choose = (s) => onSelect?.(s)

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)} data-testid="station-list">
      {hint}
      <StationFilters filters={filters} onChange={setFilters} islands={islands} unit={unit} />
      <p className="font-mono text-[11px] text-subtle" aria-live="polite" data-testid="station-count">
        {status === 'loading' || (status === 'ready' && !meta) ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> loading stations…</span>
          : status === 'notfound' ? 'No station values for this date.'
            : status === 'error' ? 'The station values did not load.'
              : `${rows.length.toLocaleString('en-US')} of ${all.length.toLocaleString('en-US')} stations${rows.length > MAX_ROWS ? ` — the first ${MAX_ROWS} are listed; narrow the filters` : ''}`}
      </p>
      {all.length > 0 && (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[19rem] border-collapse text-[12px]" data-testid="station-table">
            <thead>
              <tr className="border-b border-border text-subtle">
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('px-1 py-1 font-normal', c.className)}>
                    <button type="button" onClick={() => toggleSort(c.key)} className={cn('inline-flex min-h-7 items-center gap-0.5 rounded font-mono text-[10px] uppercase tracking-wide hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11', sort.key === c.key && 'text-foreground')} data-testid={`station-sort-${c.key}`}>
                      {c.label} <Arrow k={c.key} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody ref={body}>
              {shown.map((s) => {
                const selected = selectedSkn != null && String(selectedSkn) === s.skn
                return (
                  <tr
                    key={s.skn} data-skn={s.skn} data-testid="station-row" data-selected={selected ? 'true' : undefined}
                    onClick={() => choose(s)}
                    className={cn('cursor-pointer border-b border-border/60 transition-colors hover:bg-muted [@media(pointer:coarse)]:h-11', selected && 'bg-accent-soft font-medium')}
                  >
                    <td className="max-w-[9rem] px-1 py-1.5">
                      {/* The row takes a pointer anywhere; the keyboard and screen readers get this button. */}
                      <button
                        type="button" aria-pressed={selected} onClick={(e) => { e.stopPropagation(); choose(s) }}
                        aria-label={`${s.name || `Station ${s.skn}`}, SKN ${s.skn}${s.value != null ? `, ${formatValue(s.value, v.dataset, v.opts)}` : ''}`}
                        className="block max-w-full truncate rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={s.name} data-testid="station-pick"
                      >
                        {s.name || `Station ${s.skn}`}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-1 py-1.5 font-mono text-[11px]">{s.skn}</td>
                    <td className="whitespace-nowrap px-1 py-1.5">{islandName(s.island) || '—'}</td>
                    <td className="whitespace-nowrap px-1 py-1.5 text-right font-mono text-[11px] tabular-nums">{s.elevation_m != null ? Math.round(s.elevation_m).toLocaleString('en-US') : '—'}</td>
                    <td className="whitespace-nowrap px-1 py-1.5 text-right font-mono text-[11px] tabular-nums">{s.value != null ? formatValue(s.value, v.dataset, v.opts) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
