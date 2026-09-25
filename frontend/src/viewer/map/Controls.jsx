// The viewer's controls. Every change is reported upward and turned into a
// new URL there (the URL is the state); nothing here keeps its own copy of
// the view except the half-typed text of the date field.

import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Link2, SlidersHorizontal } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/switch'
import { cn } from '../../lib/utils'
import { DATASETS, EXTENTS } from '../urlGrammar'
import {
  PORTAL_URL, clampDate, hasExtremeScale, inRange, isRealDate, rampOptionsFor, rampNameFor,
  selectedUnit, shiftDate, shortDate, toDisplay, displayUnit, unitChoicesFor, hawaiiToday, specFor,
  yearBefore,
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
    <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  )
}

/** Day: a native date field (committed once it holds a real, published
 *  date — at once on Enter or leaving the field, else after a pause, so
 *  typing a year digit by digit does not load four maps). Month: month and
 *  year lists. Both have previous / next buttons. */
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
  const unit = period === 'day' ? 'day' : 'month'
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
        id={id} type="date" className={cn(FIELD, 'min-w-0 flex-1 px-2 font-mono text-[13px]')}
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
      <div className="flex min-w-0 flex-1 gap-1">
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
      <div className="flex items-center gap-1" role={period === 'day' ? undefined : 'group'} aria-labelledby={period === 'day' ? undefined : `${id}-label`}>
        <StepButton label={`${label ? `${label}: previous` : 'Previous'} ${unit}`} disabled={prev >= date} onClick={() => commit(prev)}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </StepButton>
        {field}
        <StepButton label={`${label ? `${label}: next` : 'Next'} ${unit}`} disabled={next <= date} onClick={() => commit(next)}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </StepButton>
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
export function Controls({ v, range, onDataset, onPeriod, onDate, onExtent, onRamp, onUnits, onScale, extra = null }) {
  const ids = { dataset: useId(), extent: useId(), ramp: useId(), more: useId() }
  const [more, setMore] = useState(() => Boolean(v.opts?.ramp || v.opts?.scale || v.opts?.compare))
  const ds = DATASETS[v.dataset]
  const units = unitChoicesFor(v.dataset)
  const portal = portalDataset(specFor(v))
  const periods = ds.periods.map((p) => ({ value: p, label: p === 'month' ? 'Monthly' : 'Daily' }))
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3 lg:gap-y-4" data-testid="viewer-controls">
      <div className="col-span-2">
        <label htmlFor={ids.dataset} className={LABEL}>Dataset</label>
        <Select id={ids.dataset} value={v.dataset} onChange={onDataset} data-testid="dataset-select">
          {Object.entries(DATASETS).map(([key, d]) => <option key={key} value={key}>{d.label}</option>)}
        </Select>
      </div>
      <Segmented legend="Period" name="viewer-period" value={v.period} options={periods} onChange={onPeriod} className={units ? '' : 'col-span-2'} testid="period-toggle" />
      {units && (
        <Segmented legend="Units" name="viewer-units" value={selectedUnit(v.dataset, v.opts)} options={units} onChange={onUnits} testid="units-toggle" />
      )}
      <div className="col-span-2">
        <DatePicker period={v.period} date={v.date} range={range} onChange={onDate} />
      </div>
      <div className="col-span-2">
        <label htmlFor={ids.extent} className={LABEL}>Place</label>
        <Select id={ids.extent} value={v.extent} onChange={onExtent} data-testid="extent-select">
          {Object.entries(EXTENTS).map(([key, e]) => <option key={key} value={key}>{e.label}</option>)}
        </Select>
      </div>
      <Button
        type="button" variant="ghost" size="sm" className="col-span-2 justify-between px-2 text-subtle lg:hidden"
        aria-expanded={more} aria-controls={ids.more} onClick={() => setMore((m) => !m)} data-testid="more-options"
      >
        <span className="inline-flex items-center gap-1.5"><SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> Colours, scale and comparison</span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', more && 'rotate-180')} aria-hidden="true" />
      </Button>
      <div id={ids.more} className={cn('col-span-2 grid-cols-2 gap-x-3 gap-y-3 lg:grid lg:gap-y-4', more ? 'grid' : 'hidden')} data-testid="display-options">
        <div className="col-span-2">
          <label htmlFor={ids.ramp} className={LABEL}>Colours</label>
          <Select id={ids.ramp} value={rampNameFor(v)} onChange={onRamp} data-testid="ramp-select">
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
        {extra && <div className="col-span-2">{extra}</div>}
      </div>
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

/** Copy link (clipboard, or the address shown to copy by hand) and the way
 *  out to the real portal. */
export function ShareActions({ url }) {
  const [state, setState] = useState('idle') // 'idle' | 'copied' | 'manual'
  const timer = useRef(null)
  const fieldRef = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => { if (state === 'manual') fieldRef.current?.select() }, [state])

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
      await navigator.clipboard.writeText(url)
      setState('copied')
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setState('idle'), 2500)
    } catch {
      setState('manual')
    }
  }

  return (
    <div className="space-y-2" data-testid="share-actions">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={copy} className="flex-1" data-testid="copy-link">
          {state === 'copied' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
          {state === 'copied' ? 'Link copied' : 'Copy link'}
        </Button>
        <Button asChild variant="outline" className="flex-1">
          <a href={PORTAL_URL} target="_blank" rel="noopener noreferrer" data-testid="portal-link">
            Open in the HCDP data portal <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Button>
      </div>
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
