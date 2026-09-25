// /viewer with nothing after it: what the viewer is, how its addresses
// work, and ready-made links for the questions people ask most.

import { Link } from 'react-router-dom'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { Card } from '../../components/ui/card'
import { DATASETS, EXTENTS, describeViewer, formatViewerPath } from '../urlGrammar'
import { useDateRange } from './dateRanges'
import { PORTAL_URL, hawaiiLastMonth, hawaiiYesterday, shortDate } from './viewerModel'

const code = 'rounded bg-inset px-1 py-0.5 font-mono text-[0.85em]'

/** A question → a map. */
function Example({ question, view, note = null, lateUntil = null }) {
  const late = Boolean(lateUntil)
  const v = late ? { ...view, date: lateUntil } : view
  const path = formatViewerPath({ opts: {}, ...v })
  return (
    <li>
      <Link to={path} className="group block h-full" data-testid="launcher-example">
        <Card className="flex h-full flex-col gap-1 p-4 transition-colors group-hover:border-foreground">
          <span className="font-display text-lg leading-snug">{question}</span>
          <span className="text-sm text-subtle">{describeViewer(v)}</span>
          {late && <span className="text-xs text-subtle">Not published yet — this opens the latest map, {shortDate(lateUntil)}.</span>}
          {note && <span className="text-xs text-subtle">{note}</span>}
          <span className="mt-auto flex items-center justify-between gap-2 pt-2">
            <code className="min-w-0 truncate font-mono text-[11px] text-subtle">{path}</code>
            <ArrowRight className="h-4 w-4 shrink-0 text-accent transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        </Card>
      </Link>
    </li>
  )
}

/** "Yesterday" and "last month" examples fall back to the latest published
 *  map when the one asked for is not out yet, and say so. */
function RelativeExample(props) {
  const { view } = props
  const { range } = useDateRange(view.dataset, view.period, view.extent)
  return <Example {...props} lateUntil={range && view.date > range.end ? range.end : null} />
}

export default function Launcher({ now = new Date() }) {
  const yesterday = hawaiiYesterday(now)
  const lastMonth = hawaiiLastMonth(now)
  const datasets = Object.keys(DATASETS)
  const places = Object.keys(EXTENTS)
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10" data-testid="viewer-launcher">
      <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-subtle">Climate viewer</p>
      <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">A map for every day and month, with an address you can share</h1>
      <p className="mt-3 max-w-3xl text-subtle">
        The viewer draws HCDP's gridded maps of Hawaiʻi — rainfall, temperature, relative humidity, vegetation greenness,
        wildfire ignition probability and the drought index — with the portal's colours and scales, one day or one month at a time.
        Whatever you pick shows up in the address bar, so a copied link opens exactly the same map for anyone.
      </p>

      <section className="mt-8" aria-labelledby="viewer-examples">
        <h2 id="viewer-examples" className="font-display text-2xl">Start from a question</h2>
        <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <RelativeExample question="Yesterday's rainfall, statewide" view={{ dataset: 'rainfall', period: 'day', date: yesterday, extent: 'statewide' }} />
          <RelativeExample question="Last month's drought index" view={{ dataset: 'spi-3', period: 'month', date: lastMonth, extent: 'statewide' }} note="The 3-month Standardized Precipitation Index: below zero is drier than usual." />
          <Example question="Hurricane Lowell's peak day on Kauaʻi" view={{ dataset: 'rainfall', period: 'day', date: '2026-09-07', extent: 'kauai', opts: { scale: 'extreme' } }} note="On the portal's storm scale, 0–250 mm." />
          <RelativeExample question="Last month's maximum temperature on Oʻahu" view={{ dataset: 'temperature-max', period: 'month', date: lastMonth, extent: 'oahu' }} />
        </ul>
      </section>

      <section className="mt-10" aria-labelledby="viewer-grammar">
        <h2 id="viewer-grammar" className="font-display text-2xl">How the address works</h2>
        <p className="mt-3 max-w-3xl leading-relaxed" data-testid="viewer-grammar">
          Every map lives at <code className={code}>/viewer/{'{dataset}/{period}/{date}/{place}'}</code>.
          The <em>dataset</em> is what was measured
          ({datasets.map((d, i) => <span key={d}><code className={code}>{d}</code>{i < datasets.length - 1 ? ', ' : ''}</span>)});
          the <em>period</em> is <code className={code}>month</code> or <code className={code}>day</code>;
          the <em>date</em> is <code className={code}>YYYY-MM</code> for a month or <code className={code}>YYYY-MM-DD</code> for a day
          (<code className={code}>october/21/2025</code> works too);
          and the <em>place</em> is {places.map((p, i) => <span key={p}><code className={code}>{p}</code>{i < places.length - 2 ? ', ' : i === places.length - 2 ? ' or ' : ''}</span>)}.
          Options after a <code className={code}>?</code> change how the map is drawn, never the data:
          {' '}<code className={code}>units=in</code> or <code className={code}>units=f</code> for inches and °F,
          {' '}<code className={code}>ramp=turbo</code> for another colour scheme,
          {' '}<code className={code}>scale=extreme</code> for the 0–250 mm storm scale on daily rainfall,
          and <code className={code}>lat</code>, <code className={code}>lng</code> and <code className={code}>z</code> for an exact view, like a Google Maps link.
        </p>
      </section>

      <section className="mt-10 rounded-lg border border-border bg-surface p-4 sm:p-5">
        <h2 className="font-display text-xl">Need the numbers?</h2>
        <p className="mt-1 max-w-3xl text-sm text-subtle">
          The viewer shows maps. To download grids and station data, or to explore every product, use the HCDP data portal.
        </p>
        <a href={PORTAL_URL} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline">
          Open in the HCDP data portal <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span>
        </a>
      </section>
    </div>
  )
}
