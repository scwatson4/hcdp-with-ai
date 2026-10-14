// The map furniture the HCDP portal draws over every map, as the AI
// interface copies it (RasterSpecMap.jsx; CSS in styles/globals.css):
// the white title card top-right, the translucent legend bottom-right, the
// compass rose bottom-left above Leaflet's scale bar.

import { FlaskConical, TriangleAlert } from 'lucide-react'
import compassUrl from './nautical.svg'
import { badgeVariants } from '../../components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'
import { cn } from '../../lib/utils'
import { rampGradient } from './ramps'

export const EXPERIMENTAL_NOTE = 'Daily rainfall and ignition products are experimental'
export const IGNITION_CAUTION = 'Informational only — not an operational fire forecast (CC BY-NC-ND 4.0).'

/** The portal's "Experimental" badge for daily rainfall and the ignition
 *  products: a focusable pill whose tooltip says why. */
export function ExperimentalBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={cn(badgeVariants({ variant: 'warning' }), 'pointer-events-auto cursor-help shadow-sm max-md:min-h-11 max-md:px-3 max-md:text-[13px] [@media(pointer:coarse)]:min-h-11')} data-testid="experimental-badge">
          <FlaskConical className="h-3 w-3" aria-hidden="true" /> Experimental
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[16rem]">{EXPERIMENTAL_NOTE}</TooltipContent>
    </Tooltip>
  )
}

/** The stack under Leaflet's zoom control (top-left): badges and small notes. On a phone (M1 C) the zoom control sits
 *  bottom-right and the stack goes under the reading chips (`className` moves it). */
export function CornerStack({ children, className }) {
  return (
    <div className={cn('pointer-events-none absolute left-2 top-[80px] z-[1000] flex max-w-[60%] flex-col items-start gap-1', className)} data-testid="corner-stack">
      {children}
    </div>
  )
}

/** A small pill like MapStatus's loading pill; `quiet` for a passing note. */
export function MapPill({ children, quiet = false, testid, role = 'status', interactive = false }) {
  return (
    <div
      role={role} data-testid={testid}
      className={cn(
        'flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[12px] shadow-sm',
        quiet ? 'bg-card/80 text-subtle' : 'bg-card/95 text-foreground',
        interactive && 'pointer-events-auto',
      )}
    >
      {children}
    </div>
  )
}

/** Title card: ONLY the title — dataset, date, place (item 16, 2026-10-08); the units and the
 *  source/citation live in the rail's note under the map settings, not on the map;
 *  `caution` adds a one-line note in a second card under it. `compact` (M1 C, the second map of a
 *  comparison on a phone): a one-line card at the top-left, clear of the zoom control (bottom-right there). */
export function TitleCard({ title, extra = null, caution = null, compact = false }) {
  if (compact) {
    return (
      <div className="pointer-events-none absolute left-2 top-2 z-[1000] max-w-[70%]" data-testid="viewer-title-card" data-variant="compact">
        <div className="hcdp-title-card truncate !px-2.5 !py-1.5 !text-left !text-[12px]"><span className="truncate" data-testid="viewer-title">{title}</span></div>
      </div>
    )
  }
  return (
    <div className="pointer-events-none absolute right-2 top-2 z-[1000] flex max-w-[72%] flex-col items-end gap-1" data-testid="viewer-title-card">
      <div className="hcdp-title-card">
        <div className="hcdp-title-card__label" data-testid="viewer-title">{title}</div>
        {extra && <div className="hcdp-title-card__extra">{extra}</div>}
      </div>
      {caution && (
        <p className="hcdp-title-card m-0 flex items-start gap-1.5 !py-1.5 text-left !text-[12px] leading-snug" role="note" data-testid="viewer-caution">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{caution}</span>
        </p>
      )}
    </div>
  )
}

/** The portal's legend: header, a 25×120 vertical bar with high values at
 *  the top, five labels with the portal's "+" / "-" open-end marks; the bar
 *  reads from the other end for a reversed ramp (?ramp=name-r).
 *  M1 C (14 Oct): `strip` — on a phone, a horizontal strip at the bottom-left above the floating bar: the header, a
 *  bar with low values at the left, and the low, middle and high labels (12 px). */
export function Legend({ header, labels, ramp, reverse = false, tick = null, layout = 'vertical' }) {
  if (layout === 'strip') {
    const mid = labels[Math.floor((labels.length - 1) / 2)]
    return (
      <div className="hcdp-legend hcdp-legend--strip pointer-events-none absolute left-2 z-[1000]" data-testid="legend" data-layout="strip" role="img" aria-label={`Legend: ${header}, from ${labels[labels.length - 1]} to ${labels[0]}`}>
        <div className="hcdp-legend__title">{header}</div>
        <div className="hcdp-legend__strip" data-testid="legend-gradient" data-reversed={reverse ? 'true' : undefined} style={{ background: rampGradient(ramp, reverse).replace('to top', 'to right') }}>
          {tick != null && <span className="hcdp-legend__tick-x" data-testid="legend-tick" style={{ left: `${tick * 100}%` }} />}
        </div>
        <div className="hcdp-legend__strip-labels" data-testid="legend-labels" aria-hidden="true"><span>{labels[labels.length - 1]}</span><span>{mid}</span><span>{labels[0]}</span></div>
      </div>
    )
  }
  return (
    <div className="hcdp-legend pointer-events-none absolute bottom-2 right-2 z-[1000]" data-testid="legend" role="img" aria-label={`Legend: ${header}, from ${labels[labels.length - 1]} to ${labels[0]}`}>
      <div className="hcdp-legend__title">{header}</div>
      <div className="hcdp-legend__scale">
        <div className="hcdp-legend__bar-wrap">
          <div className="hcdp-legend__bar" data-testid="legend-gradient" data-reversed={reverse ? 'true' : undefined} style={{ background: rampGradient(ramp, reverse) }}>
            {tick != null && <span className="hcdp-legend__tick" data-testid="legend-tick" style={{ bottom: `${tick * 100}%` }} />}
          </div>
        </div>
        <div className="hcdp-legend__marks" aria-hidden="true">{labels.map((_, i) => <span key={i}>-</span>)}</div>
        <div className="hcdp-legend__labels" data-testid="legend-labels" aria-hidden="true">{labels.map((l, i) => <span key={i}>{l}</span>)}</div>
      </div>
    </div>
  )
}

/** The portal's compass rose (its assets/arrows/nautical.svg). */
export function Compass() {
  return (
    <div className="hcdp-compass" aria-hidden="true" data-testid="compass-rose">
      <img src={compassUrl} alt="" draggable="false" />
    </div>
  )
}

/** The value under the pointer, between the corner furniture (on a phone, above the floating bar). */
export function ValueReadout({ text, phone = false }) {
  if (!text) return null
  return (
    <div className={cn('pointer-events-none absolute left-1/2 z-[1000] min-w-[6.5rem] -translate-x-1/2 truncate rounded border border-border bg-card/95 px-2 py-1 text-center font-mono text-[12px] text-foreground shadow-sm', phone ? 'bottom-[calc(var(--hcdp-fab-clear,0px)+3.75rem)] max-w-[60%]' : 'bottom-12 max-w-[calc(100%-240px)]')} data-testid="value-readout" aria-live="off">
      {text}
    </div>
  )
}
