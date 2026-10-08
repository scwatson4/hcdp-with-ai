// The viewer's controls. Every change is reported upward and turned into a
// new URL there (the URL is the state); nothing here keeps its own copy of
// the view except the half-typed text of the date field.

import { useEffect, useId, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Copy, ExternalLink, Link2, Loader2, Palette, QrCode, Share2, SkipBack, SkipForward, SlidersHorizontal, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { Slider } from '../../components/ui/slider'
import { Switch } from '../../components/ui/switch'
import { cn } from '../../lib/utils'
import { DATASETS, DEFAULT_BASEMAP, DEFAULT_OPACITY, EXTENTS, LAYER_KEYS, hasStations } from '../urlGrammar'
import { handoffUrl } from '../../site/handoff'
import { BASEMAP_OPTIONS } from './basemaps'
import {
  PORTAL_URL, autoDomainFor, clampDate, convertDisplay, domainFor, fromDisplay, hasExtremeScale, inRange, isLogScale, isRampReversed,
  isRealDate, rampOptionsFor, rampNameFor, selectedUnit, shiftDate, shiftMonths, shortDate, toDisplay, displayUnit, unitChoicesFor,
  hawaiiToday, specFor, yearBefore,
} from './viewerModel'
import { portalDataset } from '../portalDatasets.reference'

export const LABEL = 'mb-1 block font-mono text-[11px] font-medium uppercase tracking-wide text-subtle'
const FIELD = 'h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function Select({ id, value, onChange, children, className, ...rest }) {
  return (
    <div className={cn('relative', className)}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(FIELD, 'appearance-none pr-8')} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
    </div>
  )
}

/** A radio group drawn as a segmented control: native radios, so arrow keys
 *  move the choice and screen readers announce "1 of 2". */
export function Segmented({ legend, name, value, options, onChange, className, testid }) {
  return (
    <fieldset className={cn('min-w-0', className)} data-testid={testid}>
      <legend className={LABEL}>{legend}</legend>
      <div className="flex rounded-md border border-border bg-muted p-0.5">
        {options.map((o) => (
          <label key={o.value} className="min-w-0 flex-1">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="peer sr-only" />
            <span className="block cursor-pointer truncate rounded-[5px] px-2 py-1.5 text-center text-xs font-medium text-subtle transition-colors hover:text-foreground peer-checked:bg-card peer-checked:text-foreground peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function StepButton({ label, disabled, onClick, children }) {
  return (
    <Button
      type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      aria-label={label} title={label} disabled={disabled} onClick={onClick}
    >
      {children}
    </Button>
  )
}

/** Day: a native date field (committed once it holds a real, published
 *  date — at once on Enter or leaving the field, else after a pause, so
 *  typing a year digit by digit does not load four maps). Month: month and
 *  year lists. Under either, the portal's six steps: first, a big step back
 *  (a month for daily maps, a year for monthly), one back, one on, a big
 *  step on, last — all inside the published range. */
export function DatePicker({ period, date, range, onChange, label = null, testid = 'date-picker' }) {
  const id = useId()
  const [draft, setDraft] = useState(date)
  const [warn, setWarn] = useState(null)
  const timer = useRef(null)
  useEffect(() => { setDraft(date); setWarn(null) }, [date])
  useEffect(() => () => clearTimeout(timer.current), [])

  // Steps land inside the published range (from a date past its end,
  // "previous" goes to the latest map).
  const prev = clampDate(shiftDate(date, period, -1), range)
  const next = clampDate(shiftDate(date, period, 1), range)
  const big = period === 'day' ? 1 : 12
  const prevBig = clampDate(shiftMonths(date, period, -big), range)
  const nextBig = clampDate(shiftMonths(date, period, big), range)
  const unit = period === 'day' ? 'day' : 'month'
  const bigUnit = period === 'day' ? 'month' : 'year'
  const name = (what) => (label ? `${label}: ${what}` : what.charAt(0).toUpperCase() + what.slice(1))
  const hint = range ? `Maps from ${shortDate(range.start)} to ${shortDate(range.end)}` : null

  const commit = (val) => {
    clearTimeout(timer.current)
    if (!val || !isRealDate(val, period)) { setDraft(date); return }
    if (range && !inRange(val, range)) { setWarn(`No map for ${shortDate(val)}. ${hint}.`); setDraft(date); return }
    setWarn(null)
    if (val !== date) onChange(val)
  }

  let field
  if (period === 'day') {
    field = (
      <input
        id={id} type="date" className={cn(FIELD, 'min-w-0 px-2 font-mono text-[13px]')}
        value={draft} min={range?.start} max={range?.end}
        onChange={(e) => {
          const val = e.target.value
          setDraft(val)
          clearTimeout(timer.current)
          if (val && isRealDate(val, 'day') && inRange(val, range)) timer.current = setTimeout(() => commit(val), 450)
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(draft) } }}
        aria-describedby={`${id}-hint`}
        data-testid={`${testid}-input`}
      />
    )
  } else {
    const [y, m] = date.split('-')
    const lastYear = Number((range?.end || hawaiiToday()).slice(0, 4))
    const firstYear = Number((range?.start || '1920').slice(0, 4))
    const years = []
    for (let yy = lastYear; yy >= firstYear; yy--) years.push(String(yy))
    if (!years.includes(y)) years.unshift(y)
    field = (
      <div className="flex min-w-0 gap-1">
        <Select id={id} value={m} onChange={(mm) => commit(clampDate(`${y}-${mm}`, range))} className="min-w-0 flex-[3]" aria-label={label ? `${label}: month` : 'Month'} data-testid={`${testid}-month`}>
          {MONTHS.map((name, i) => {
            const mm = String(i + 1).padStart(2, '0')
            return <option key={mm} value={mm} disabled={Boolean(range) && !inRange(`${y}-${mm}`, range)}>{name}</option>
          })}
        </Select>
        <Select value={y} onChange={(yy) => commit(clampDate(`${yy}-${m}`, range))} className="min-w-0 flex-[2]" aria-label={label ? `${label}: year` : 'Year'} data-testid={`${testid}-year`}>
          {years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
        </Select>
      </div>
    )
  }

  return (
    <div className="min-w-0" data-testid={testid}>
      {period === 'day'
        ? <label htmlFor={id} className={LABEL}>{label || 'Date'}</label>
        : <span id={`${id}-label`} className={LABEL}>{label || 'Month'}</span>}
      <div className="space-y-1.5" role={period === 'day' ? undefined : 'group'} aria-labelledby={period === 'day' ? undefined : `${id}-label`}>
        {field}
        <div className="flex items-center justify-between gap-1" data-testid={`${testid}-steps`}>
          <StepButton label={name(`first ${unit}`)} disabled={!range || range.start >= date} onClick={() => commit(range.start)}>
            <SkipBack className="h-4 w-4" aria-hidden="true" />
          </StepButton>
          <StepButton label={name(`previous ${bigUnit}`)} disabled={prevBig >= date} onClick={() => commit(prevBig)}>
            <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
          </StepButton>
          <StepButton label={name(`previous ${unit}`)} disabled={prev >= date} onClick={() => commit(prev)}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </StepButton>
          <StepButton label={name(`next ${unit}`)} disabled={next <= date} onClick={() => commit(next)}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </StepButton>
          <StepButton label={name(`next ${bigUnit}`)} disabled={nextBig <= date} onClick={() => commit(nextBig)}>
            <ChevronsRight className="h-4 w-4" aria-hidden="true" />
          </StepButton>
          <StepButton label={name(`last ${unit}`)} disabled={!range || range.end <= date} onClick={() => commit(range.end)}>
            <SkipForward className="h-4 w-4" aria-hidden="true" />
          </StepButton>
        </div>
      </div>
      <p id={`${id}-hint`} className={cn('mt-1 text-xs', warn ? 'text-destructive' : 'text-subtle')} aria-live="polite" data-testid={`${testid}-hint`}>
        {warn || hint || ' '}
      </p>
    </div>
  )
}

function scaleLabel(v, range) {
  const unit = displayUnit(v.dataset, v.opts)
  const hi = toDisplay(range[1], v.dataset, v.opts)
  return `0–${hi.toLocaleString('en-US')} ${unit}`
}

/** All controls, stacked on phones and in the left rail on desktop. On
 *  phones the display options (colours, scale, comparison) fold away behind
 *  one button so the map starts higher; they open by themselves when the
 *  link already sets one. */
export function Controls({ v, range, onDataset, onPeriod, onDate, onExtent, onRamp, onUnits, onScale, onReverse = null, onLog = null, onRange = null, layers = null, extra = null }) {
  const moreId = useId()
  const [more, setMore] = useState(() => Boolean(v.opts?.ramp || v.opts?.scale || v.opts?.range || v.opts?.log || v.opts?.compare || v.opts?.basemap || v.opts?.opacity != null || v.opts?.layers))
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3 lg:gap-y-4" data-testid="viewer-controls">
      <DatasetField v={v} onChange={onDataset} />
      <PeriodUnitsFields v={v} onPeriod={onPeriod} onUnits={onUnits} />
      <div className="col-span-2">
        <DatePicker period={v.period} date={v.date} range={range} onChange={onDate} />
      </div>
      <PlaceField v={v} onChange={onExtent} />
      <Button
        type="button" variant="ghost" size="sm" className="col-span-2 justify-between px-2 text-subtle lg:hidden"
        aria-expanded={more} aria-controls={moreId} onClick={() => setMore((m) => !m)} data-testid="more-options"
      >
        <span className="inline-flex items-center gap-1.5"><SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> Colours, layers and comparison</span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', more && 'rotate-180')} aria-hidden="true" />
      </Button>
      <div id={moreId} className={cn('col-span-2 grid-cols-2 gap-x-3 gap-y-3 lg:grid lg:gap-y-4', more ? 'grid' : 'hidden')} data-testid="display-options">
        <ColourFields v={v} onRamp={onRamp} onScale={onScale} />
        {onRange && <div className="col-span-2"><ScaleControls v={v} onReverse={onReverse} onLog={onLog} onRange={onRange} /></div>}
        {layers && <div className="col-span-2">{layers}</div>}
        {extra && <div className="col-span-2">{extra}</div>}
      </div>
    </div>
  )
}

// The rail's fields one by one (grid children of a two-column grid), so the
// phone sheet can deal them out to its tabs.

export function DatasetField({ v, onChange }) {
  const id = useId()
  return (
    <div className="col-span-2">
      <label htmlFor={id} className={LABEL}>Dataset</label>
      <Select id={id} value={v.dataset} onChange={onChange} data-testid="dataset-select">
        {Object.entries(DATASETS).map(([key, d]) => <option key={key} value={key}>{d.label}</option>)}
      </Select>
    </div>
  )
}

export function PeriodUnitsFields({ v, onPeriod, onUnits }) {
  const units = unitChoicesFor(v.dataset)
  const periods = DATASETS[v.dataset].periods.map((p) => ({ value: p, label: p === 'month' ? 'Monthly' : 'Daily' }))
  return (
    <>
      <Segmented legend="Period" name="viewer-period" value={v.period} options={periods} onChange={onPeriod} className={units ? '' : 'col-span-2'} testid="period-toggle" />
      {units && (
        <Segmented legend="Units" name="viewer-units" value={selectedUnit(v.dataset, v.opts)} options={units} onChange={onUnits} testid="units-toggle" />
      )}
    </>
  )
}

export function PlaceField({ v, onChange }) {
  const id = useId()
  return (
    <div className="col-span-2">
      <label htmlFor={id} className={LABEL}>Place</label>
      <Select id={id} value={v.extent} onChange={onChange} data-testid="extent-select">
        {Object.entries(EXTENTS).map(([key, e]) => <option key={key} value={key}>{e.label}</option>)}
      </Select>
    </div>
  )
}

/** Colour ramp and, for daily rainfall, the portal / storm scale. */
export function ColourFields({ v, onRamp, onScale }) {
  const id = useId()
  const portal = portalDataset(specFor(v))
  return (
    <>
      <div className="col-span-2">
        <label htmlFor={id} className={LABEL}>Colours</label>
        <Select id={id} value={rampNameFor(v)} onChange={onRamp} data-testid="ramp-select">
          {rampOptionsFor(v.dataset).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>
      {hasExtremeScale(v) && portal && (
        <Segmented
          legend="Colour scale" name="viewer-scale" className="col-span-2" testid="scale-toggle"
          value={v.opts?.scale === 'extreme' ? 'extreme' : 'portal'}
          options={[
            { value: 'portal', label: `HCDP ${scaleLabel(v, portal.range)}` },
            { value: 'extreme', label: `Storm ${scaleLabel(v, portal.extreme)}` },
          ]}
          onChange={onScale}
        />
      )}
    </>
  )
}

// ── the colour scale's modifiers (?ramp=-r, ?log=1, ?range=) ─────────────────

const fmtNum = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })

/** One line on the scale in effect: "0–20 mm", "0–100 mm · locked · log · reversed". */
export function scaleSummary(v) {
  const { min, max } = domainFor(v)
  const unit = displayUnit(v.dataset, v.opts)
  const lo = fmtNum(convertDisplay(min, v.dataset, v.opts)), hi = fmtNum(convertDisplay(max, v.dataset, v.opts))
  const parts = [`${lo}–${hi}${unit ? ` ${unit}` : ''}`]
  if (v.opts?.range) parts.push('locked')
  if (isLogScale(v)) parts.push('log')
  if (isRampReversed(v)) parts.push('reversed')
  return parts.join(' · ')
}

/** Two numbers in display units → a native-unit legend range, or null when
 *  they do not make one (not numbers, or low ≥ high). */
export function rangeFromInputs(lowText, highText, v) {
  const low = Number(String(lowText).trim()), high = Number(String(highText).trim())
  if (String(lowText).trim() === '' || String(highText).trim() === '' || !Number.isFinite(low) || !Number.isFinite(high)) return null
  const min = Number(fromDisplay(low, v.dataset, v.opts).toFixed(2))
  const max = Number(fromDisplay(high, v.dataset, v.opts).toFixed(2))
  return min < max ? { min, max } : null
}

/** The HCDP v2 portal's scale-configuration dialog, reduced to what the URL
 *  carries: reverse the ramp (?ramp=name-r), pseudo-log scaling (?log=1) and
 *  a locked legend range (?range=lo..hi, edited in display units, written in
 *  the dataset's). A popover behind one button in the rail; `inline` in the
 *  phone sheet, where there is room. Every change is a replace write. */
export function ScaleControls({ v, onReverse, onLog, onRange, inline = false }) {
  const id = useId()
  const unit = displayUnit(v.dataset, v.opts)
  const locked = Boolean(v.opts?.range)
  const shown = domainFor(v)
  const auto = autoDomainFor(v)
  const text = (n) => String(Number(convertDisplay(n, v.dataset, v.opts).toFixed(2)))
  const [low, setLow] = useState(() => text(shown.min))
  const [high, setHigh] = useState(() => text(shown.max))
  const [warn, setWarn] = useState(null)
  // The URL (or the units) changed under the fields: show what is in effect.
  useEffect(() => { setLow(text(shown.min)); setHigh(text(shown.max)); setWarn(null) }, [shown.min, shown.max, v.opts?.units, v.dataset]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (lo, hi) => {
    const range = rangeFromInputs(lo, hi, v)
    if (!range) { setWarn('Two numbers, low below high.'); return }
    setWarn(null)
    if (range.min === shown.min && range.max === shown.max && locked) return
    onRange(range)
  }
  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(low, high) } }
  const reset = () => { setWarn(null); onRange(null) }

  const fields = (
    <div className="space-y-3" data-testid="scale-controls">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${id}-reverse`} className="text-sm">Reverse the colours</label>
        <Switch id={`${id}-reverse`} checked={isRampReversed(v)} onCheckedChange={onReverse} data-testid="reverse-switch" className="[@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-11" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <label htmlFor={`${id}-log`} className="text-sm">Pseudo-log scale</label>
          <p className="text-xs text-subtle">Spreads out the small values: sign(v)·ln(1+|v|).</p>
        </div>
        <Switch id={`${id}-log`} checked={isLogScale(v)} onCheckedChange={onLog} data-testid="log-switch" className="[@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-11" />
      </div>
      <fieldset className="min-w-0" data-testid="range-fields">
        <legend className={LABEL}>Legend range{unit ? ` (${unit})` : ''}</legend>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={`${id}-low`} className="mb-0.5 block text-xs text-subtle">Low</label>
            <input
              id={`${id}-low`} type="number" step="any" inputMode="decimal" value={low}
              onChange={(e) => setLow(e.target.value)} onBlur={() => commit(low, high)} onKeyDown={onKey}
              className={cn(FIELD, 'font-mono text-[13px] [@media(pointer:coarse)]:h-11')} data-testid="range-low"
            />
          </div>
          <div>
            <label htmlFor={`${id}-high`} className="mb-0.5 block text-xs text-subtle">High</label>
            <input
              id={`${id}-high`} type="number" step="any" inputMode="decimal" value={high}
              onChange={(e) => setHigh(e.target.value)} onBlur={() => commit(low, high)} onKeyDown={onKey}
              className={cn(FIELD, 'font-mono text-[13px] [@media(pointer:coarse)]:h-11')} data-testid="range-high"
            />
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className={cn('min-w-0 text-xs', warn ? 'text-destructive' : 'text-subtle')} aria-live="polite" data-testid="range-hint">
            {warn || (locked ? `Locked. HCDP's scale is ${text(auto.min)}–${text(auto.max)}${unit ? ` ${unit}` : ''}.` : "Auto: HCDP's scale for this product.")}
          </p>
          <Button type="button" variant="outline" size="sm" className="shrink-0 [@media(pointer:coarse)]:h-11" onClick={reset} disabled={!locked} data-testid="range-reset">
            Reset to auto
          </Button>
        </div>
      </fieldset>
    </div>
  )

  if (inline) {
    return (
      <div className="space-y-2">
        <p className={LABEL}>Colours and scale</p>
        {fields}
      </div>
    )
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between gap-2 [@media(pointer:coarse)]:h-11" data-testid="scale-button" aria-label={`Colours and scale: ${scaleSummary(v)}`}>
          <span className="inline-flex shrink-0 items-center gap-1.5"><Palette className="h-3.5 w-3.5" aria-hidden="true" /> Colours and scale</span>
          <span className="min-w-0 truncate font-mono text-[11px] font-normal text-subtle" data-testid="scale-summary">{scaleSummary(v)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[18rem]" data-testid="scale-popover">
        <p className={cn(LABEL, 'mb-2')}>Colours and scale</p>
        {fields}
      </PopoverContent>
    </Popover>
  )
}

/** ?basemap=: one of the portal's base maps (plus a light grey one). */
export function BasemapSelect({ value, onChange }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className={LABEL}>Base map</label>
      <Select id={id} value={value || DEFAULT_BASEMAP} onChange={onChange} data-testid="basemap-select">
        {BASEMAP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </div>
  )
}

/** ?opacity=: the data layer's opacity. The map follows the thumb while it
 *  moves (onPreview); the URL is written once, on release (onChange). */
export function OpacitySlider({ value, onChange, onPreview = null }) {
  const id = useId()
  const [draft, setDraft] = useState(null)
  useEffect(() => { setDraft(null) }, [value]) // the URL caught up
  const shown = draft ?? value ?? DEFAULT_OPACITY
  return (
    <div data-testid="opacity-control">
      <div className="mb-1 flex items-baseline justify-between">
        <label htmlFor={id} className={cn(LABEL, 'mb-0')}>Opacity</label>
        <output htmlFor={id} className="font-mono text-[11px] tabular-nums text-subtle" data-testid="opacity-value">{shown} %</output>
      </div>
      <Slider
        id={id} min={0} max={100} step={5} value={[shown]} aria-label="Data layer opacity"
        className="py-2 [@media(pointer:coarse)]:py-3.5"
        onValueChange={([n]) => { setDraft(n); onPreview?.(n) }}
        onValueCommit={([n]) => onChange(n)}
        data-testid="opacity-slider"
      />
    </div>
  )
}

const LAYER_LABELS = { stations: 'Stations', outline: 'Island outlines' }

/** ?layers=: the overlays. Native checkboxes in a fieldset: one tap each,
 *  arrow keys and screen readers for free. Reports one toggle at a time
 *  (the page builds the list, so two quick toggles both land). */
export function LayerToggles({ dataset, value = [], onToggle }) {
  const keys = LAYER_KEYS.filter((k) => k !== 'stations' || hasStations(dataset))
  return (
    <fieldset className="min-w-0" data-testid="layer-toggles">
      <legend className={LABEL}>Layers</legend>
      <div className="flex flex-col gap-0.5">
        {keys.map((key) => (
          <label key={key} className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-1 text-sm hover:bg-muted [@media(pointer:coarse)]:min-h-11">
            <input
              type="checkbox" className="h-4 w-4 shrink-0 rounded border-border accent-accent"
              checked={value.includes(key)} onChange={(e) => onToggle(key, e.target.checked)}
              data-testid={`layer-${key}`}
            />
            {LAYER_LABELS[key]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Base map, opacity and overlays together (the rail's "Layers" block and
 *  the phone sheet's Layers tab). */
export function LayerControls({ v, onBasemap, onOpacity, onOpacityPreview = null, onLayerToggle }) {
  return (
    <div className="grid grid-cols-1 gap-3" data-testid="layer-controls">
      <BasemapSelect value={v.opts?.basemap} onChange={onBasemap} />
      <OpacitySlider value={v.opts?.opacity ?? DEFAULT_OPACITY} onChange={onOpacity} onPreview={onOpacityPreview} />
      <LayerToggles dataset={v.dataset} value={v.opts?.layers || []} onToggle={onLayerToggle} />
    </div>
  )
}

/** ?compare=: the same map for a second date, side by side. Turning it on
 *  starts from the same day or month a year earlier. */
export function CompareControl({ v, range, compareDate, onChange }) {
  const id = useId()
  const on = Boolean(compareDate)
  const unusable = Boolean(v.opts?.compare) && !on
  return (
    <div className="space-y-2" data-testid="compare-control">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm">Compare with another {v.period === 'day' ? 'day' : 'month'}</label>
        <Switch id={id} checked={on} onCheckedChange={(c) => onChange(c ? clampDate(yearBefore(v.date), range) : null)} data-testid="compare-switch" />
      </div>
      {on && <DatePicker period={v.period} date={compareDate} range={range} onChange={onChange} label="Compare with" testid="compare-picker" />}
      {unusable && (
        <p className="text-xs text-subtle">The comparison date in this link ({v.opts.compare}) does not fit a {v.period === 'day' ? 'daily' : 'monthly'} map, so it is not shown.</p>
      )}
    </div>
  )
}

/** The question the AI data analysis tool is asked about this map, from the view's own words. */
export function analyzeQuestion(v) {
  const label = DATASETS[v.dataset]?.label || v.dataset
  const place = EXTENTS[v.extent]?.label || v.extent
  return `Analyze the ${label} map for ${v.date} (${place})`
}

/** The rail's door to the AI data analysis tool (T1 D): a rainbow-outlined button that opens the
 *  AI interface in a new tab with this map's question and, as `ctx`, the canonical address of the
 *  view (`path`: what Copy link copies). Both come from props, so the link follows every change. */
export function AnalyzeWithAI({ v, path }) {
  const href = handoffUrl({ question: analyzeQuestion(v), viewerPath: path })
  return (
    <Button asChild variant="ghost" className="hcdp-rainbow-border w-full hover:shadow-md [@media(pointer:coarse)]:h-11">
      <a href={href} target="_blank" rel="noopener noreferrer" data-testid="analyze-ai">
        <Sparkles className="h-4 w-4" aria-hidden="true" /> Analyze this map with AI <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </Button>
  )
}

/** Write to the clipboard; false when the browser refuses. */
async function copyText(text) {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch { return false }
}

/** Copy link (the canonical address — never the raw href), the system share
 *  sheet where there is one, a QR code with a short link, and the way out to
 *  the real portal. */
export function ShareActions({ path, title }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const url = origin + path
  const [state, setState] = useState('idle') // 'idle' | 'copied' | 'manual'
  const timer = useRef(null)
  const fieldRef = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => { if (state === 'manual') fieldRef.current?.select() }, [state])
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const copy = async () => {
    if (await copyText(url)) {
      setState('copied')
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setState('idle'), 2500)
    } else {
      setState('manual')
    }
  }
  const share = async () => {
    try { await navigator.share({ title, url }) } catch { /* dismissed */ }
  }

  return (
    <div className="space-y-2" data-testid="share-actions">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={copy} className="min-w-0 flex-1 [@media(pointer:coarse)]:h-11" data-testid="copy-link">
          {state === 'copied' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
          {state === 'copied' ? 'Link copied' : 'Copy link'}
        </Button>
        {canShare && (
          <Button type="button" variant="outline" onClick={share} className="min-w-0 flex-1 [@media(pointer:coarse)]:h-11" data-testid="share-link">
            <Share2 className="h-4 w-4" aria-hidden="true" /> Share…
          </Button>
        )}
        <ShortLinkPopover path={path} url={url} />
      </div>
      <Button asChild variant="outline" className="w-full [@media(pointer:coarse)]:h-11">
        <a href={PORTAL_URL} target="_blank" rel="noopener noreferrer" data-testid="portal-link">
          Open in the HCDP data portal <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </Button>
      <p className="sr-only" aria-live="polite">{state === 'copied' ? 'Link copied to the clipboard.' : ''}</p>
      {state === 'manual' && (
        <div data-testid="copy-fallback">
          <label htmlFor="viewer-share-url" className={LABEL}>Copy this link</label>
          <input
            id="viewer-share-url" ref={fieldRef} readOnly value={url}
            onFocus={(e) => e.target.select()}
            className={cn(FIELD, 'font-mono text-xs')}
          />
          <p className="mt-1 text-xs text-subtle">Your browser did not let the page copy it. Select the address above and copy it.</p>
        </div>
      )}
    </div>
  )
}

// Short links already made this visit, by canonical path.
const shortLinks = new Map()

/** POST /api/shorten {path} → {id, url}; rejects when the service does not answer. */
export async function shortenPath(path) {
  if (shortLinks.has(path)) return shortLinks.get(path)
  const resp = await fetch('/api/shorten', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })
  if (!resp.ok) throw new Error(`shorten: HTTP ${resp.status}`)
  const body = await resp.json()
  if (!body?.url) throw new Error('shorten: no url in the answer')
  shortLinks.set(path, body.url)
  return body.url
}

/** A QR code of `text` as an SVG data URL (error correction M) — crisp at
 *  any size, so it prints well. */
export async function qrDataUrl(text) {
  const svg = await QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** "QR / short link": the short address (copyable) and a QR code of it;
 *  when the shortener fails, the long link does the same job. */
function ShortLinkPopover({ path, url }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState({ path: null, status: 'idle', short: null, qr: null })
  const [copied, setCopied] = useState(false)
  const id = useId()

  // Asked once per path while open; an answer for a path no longer shown is dropped.
  const requested = useRef(null)
  useEffect(() => {
    if (!open || requested.current === path) return
    requested.current = path
    setState({ path, status: 'loading', short: null, qr: null })
    ;(async () => {
      let short = null
      try { short = await shortenPath(path) } catch { short = null }
      let qr = null
      try { qr = await qrDataUrl(short || url) } catch { qr = null }
      if (requested.current === path) setState({ path, status: short ? 'short' : 'long', short, qr })
    })()
  }, [open, path, url])

  const link = state.short || url
  const copy = async () => {
    setCopied(await copyText(link))
    setTimeout(() => setCopied(false), 2200)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="min-w-0 flex-1 [@media(pointer:coarse)]:h-11" data-testid="qr-link" aria-label="QR code and short link">
          <QrCode className="h-4 w-4" aria-hidden="true" /> QR / short link
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[17.5rem]" data-testid="qr-popover">
        <p className={LABEL}>{state.status === 'long' ? 'Link' : 'Short link'}</p>
        <div className="flex items-center gap-1">
          <input
            id={id} readOnly value={state.status === 'loading' ? '' : link} placeholder={state.status === 'loading' ? 'Making a short link…' : ''}
            aria-label={state.status === 'long' ? 'Link to this map' : 'Short link to this map'} onFocus={(e) => e.target.select()}
            className={cn(FIELD, 'min-w-0 flex-1 font-mono text-xs')} data-testid="short-link"
          />
          <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={copy} aria-label={copied ? 'Copied' : 'Copy the link'} title="Copy" disabled={state.status === 'loading'} data-testid="short-link-copy">
            {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </div>
        {state.status === 'long' && <p className="mt-1 text-xs text-subtle" data-testid="short-link-fallback">The short-link service did not answer; this is the full address.</p>}
        <div className="mt-3 flex items-center justify-center rounded-md bg-white p-2" aria-busy={state.status === 'loading'}>
          {state.qr
            ? <img src={state.qr} width={176} height={176} alt={`QR code that opens ${link}`} className="h-44 w-44" data-testid="qr-code" />
            : <div className="flex h-44 w-44 items-center justify-center text-subtle">{state.status === 'loading' ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <span className="text-xs">No QR code</span>}</div>}
        </div>
        <p className="mt-2 text-xs text-subtle">Scan to open this map. Print this page to put the code on a handout — the code is a vector, so it stays sharp at any size.</p>
      </PopoverContent>
    </Popover>
  )
}
