// The map furniture the HCDP portal draws over every map, as the AI
// interface copies it (RasterSpecMap.jsx; CSS in styles/globals.css):
// the white title card top-right, the translucent legend bottom-right, the
// compass rose bottom-left above Leaflet's scale bar.

import compassUrl from './nautical.svg'
import { rampGradient } from './ramps'

/** Title card: what the map shows, its units and where the data comes from. */
export function TitleCard({ title, unitsLine, sourceLine, extra = null }) {
  return (
    <div className="pointer-events-none absolute right-2 top-2 z-[1000] max-w-[72%]" data-testid="viewer-title-card">
      <div className="hcdp-title-card">
        <div className="hcdp-title-card__label" data-testid="viewer-title">{title}</div>
        <hr />
        <p className="m-0 text-[0.93em] font-medium leading-tight" data-testid="viewer-units">{unitsLine}</p>
        <div className="hcdp-title-card__extra" data-testid="viewer-source">Source: {sourceLine}</div>
        {extra && <div className="hcdp-title-card__extra">{extra}</div>}
      </div>
    </div>
  )
}

/** The portal's legend: header, a 25×120 vertical bar with high values at
 *  the top, five labels with the portal's "+" / "-" open-end marks. */
export function Legend({ header, labels, ramp, tick = null }) {
  return (
    <div className="hcdp-legend pointer-events-none absolute bottom-2 right-2 z-[1000]" data-testid="legend" role="img" aria-label={`Legend: ${header}, from ${labels[labels.length - 1]} to ${labels[0]}`}>
      <div className="hcdp-legend__title">{header}</div>
      <div className="hcdp-legend__scale">
        <div className="hcdp-legend__bar-wrap">
          <div className="hcdp-legend__bar" data-testid="legend-gradient" style={{ background: rampGradient(ramp) }}>
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

/** The value under the pointer, between the corner furniture. */
export function ValueReadout({ text }) {
  if (!text) return null
  return (
    <div className="pointer-events-none absolute bottom-12 left-1/2 z-[1000] max-w-[calc(100%-240px)] min-w-[6.5rem] -translate-x-1/2 truncate rounded border border-border bg-card/95 px-2 py-1 text-center font-mono text-[11px] text-foreground shadow-sm" data-testid="value-readout" aria-live="off">
      {text}
    </div>
  )
}
