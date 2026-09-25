// What the viewer says when it cannot show a map: an address it cannot
// read (a page of its own), and — over the map area, so nothing jumps —
// loading, "no map for that date", and "the map service did not answer".

import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarX2, Loader2, RotateCw } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { DATASETS, EXTENTS, describeViewer, formatViewerPath, parseViewerPath } from '../urlGrammar'
import { pathWith, shortDate } from './viewerModel'

export const GRAMMAR_EXAMPLES = [
  { dataset: 'rainfall', period: 'day', date: '2026-09-07', extent: 'kauai', opts: {} },
  { dataset: 'spi-3', period: 'month', date: '2026-08', extent: 'statewide', opts: {} },
  { dataset: 'temperature-max', period: 'month', date: '2026-08', extent: 'oahu', opts: {} },
]

const code = 'rounded bg-inset px-1 py-0.5 font-mono text-[0.85em]'

/** The parser's reason, in words for a visitor. */
export function friendlyReason(error = '') {
  const e = String(error)
  if (e === 'incomplete') return 'This viewer link is missing part of its address. A complete link names a dataset, a period, a date and a place, in that order.'
  if (e.startsWith('unknown dataset')) return `There is no dataset called ${e.replace('unknown dataset ', '')}. The viewer knows ${Object.keys(DATASETS).join(', ')}.`
  if (e.startsWith('unknown period')) return `${e.replace('unknown period ', 'The period ')} is not one the viewer knows: use month or day.`
  if (e.startsWith('unknown extent')) return `There is no place called ${e.replace('unknown extent ', '')} in the viewer. Use ${Object.keys(EXTENTS).join(', ')}.`
  if (e === 'unreadable date') return 'The date in this link could not be read. Write it as YYYY-MM-DD for a day or YYYY-MM for a month.'
  if (e.startsWith('no such date ')) return `The calendar has no ${e.slice('no such date '.length)}: check the day and the month.`
  if (e.includes('full date')) return 'A daily map needs a full date, written YYYY-MM-DD.'
  if (e.includes('takes YYYY-MM')) return 'A monthly map takes a month, written YYYY-MM.'
  if (e.includes('not available by')) return `${e.charAt(0).toUpperCase()}${e.slice(1)}.`
  return 'This viewer link could not be read.'
}

/** A corrected link when the only problem is day vs month. */
export function suggestionFor(pathname) {
  for (const [from, to] of [['/day/', '/month/'], ['/month/', '/day/']]) {
    if (!pathname.includes(from)) continue
    const candidate = pathname.replace(from, to)
    const v = parseViewerPath(candidate)
    if (v && !v.error) return v
  }
  return null
}

export function GrammarError({ error, pathname, search = '' }) {
  const fix = suggestionFor(pathname)
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12" data-testid="viewer-grammar-error">
      <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-subtle">Climate viewer</p>
      <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">That map address did not work</h1>
      <p className="mt-3 text-base" data-testid="viewer-error">{friendlyReason(error)}</p>
      <p className="mt-2 break-all text-sm text-subtle">You opened <code className={code}>{pathname}{search}</code></p>
      {fix && (
        <p className="mt-4 text-base">
          Did you mean <Link className="font-medium text-accent underline underline-offset-4" to={formatViewerPath({ ...fix, opts: fix.opts || {} })}>{describeViewer(fix)}</Link>?
        </p>
      )}
      <h2 className="mt-8 font-display text-xl">Addresses that work</h2>
      <ul className="mt-2 space-y-2">
        {GRAMMAR_EXAMPLES.map((v) => {
          const path = formatViewerPath(v)
          return (
            <li key={path}>
              <Link to={path} className="block rounded-lg border border-border bg-card px-3 py-2 hover:border-foreground" data-testid="grammar-example">
                <span className="block font-medium">{describeViewer(v)}</span>
                <code className="block truncate font-mono text-xs text-subtle">{path}</code>
              </Link>
            </li>
          )
        })}
      </ul>
      <p className="mt-6 text-sm text-subtle">
        The pattern is <code className={code}>/viewer/{'{dataset}/{period}/{date}/{place}'}</code>. <Link to="/viewer" className="underline underline-offset-4 hover:text-foreground">How viewer addresses work</Link>.
      </p>
    </div>
  )
}

/** "Rainfall" → "rainfall", but "SPI …" stays. */
function lowerFirst(s) {
  return s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s
}

function Overlay({ children, testid }) {
  return (
    <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-canvas/40 p-4" data-testid={testid}>
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg" role="alert">
        {children}
      </div>
    </div>
  )
}

/** Loading pill and error cards over the map, driven by useRaster. */
export function MapStatus({ v, raster, dateRange }) {
  const { status } = raster
  const label = lowerFirst(DATASETS[v.dataset]?.label || 'climate')
  if (status === 'loading') {
    return (
      <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center" data-testid="map-loading">
        <div className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-accent/60" aria-hidden="true" />
        <div className="flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs text-foreground shadow-sm" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading the {label} map…
        </div>
      </div>
    )
  }
  if (status === 'empty' || status === 'notfound') {
    const range = dateRange?.range
    const before = range && v.date < range.start
    const target = range ? (before ? range.start : range.end) : null
    return (
      <Overlay testid="map-notfound">
        <div className="flex items-start gap-2">
          <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="font-medium">{before ? 'No map for that date' : 'No map for that date yet'}</h2>
            <p className="mt-1 text-sm text-subtle">
              {before
                ? `HCDP's ${label} maps start ${v.period === 'day' ? 'on' : 'in'} ${shortDate(range.start)}.`
                : `HCDP has no ${label} map for ${shortDate(v.date)} yet.${v.period === 'day' ? ' Daily maps are published a day or two after the fact.' : ''}`}
            </p>
            {target && target !== v.date && (
              <Link to={pathWith(v, { date: target })} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent underline underline-offset-4" data-testid="latest-map-link">
                {before ? 'See the first map' : 'See the latest map'}: {describeViewer({ ...v, date: target })}
              </Link>
            )}
            {!range && <p className="mt-2 text-sm text-subtle">Try an earlier date.</p>}
          </div>
        </div>
      </Overlay>
    )
  }
  if (status === 'network' || status === 'error') {
    const network = status === 'network'
    return (
      <Overlay testid="map-error">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="font-medium">{network ? 'The map service did not answer' : 'The map could not be drawn'}</h2>
            <p className="mt-1 text-sm text-subtle">
              {network
                ? 'Check your connection, then try again.'
                : (raster.error?.message ? `The map service said: ${raster.error.message}.` : 'Something went wrong reading this map.')}
            </p>
            <Button type="button" size="sm" variant="outline" className="mt-3" onClick={raster.retry} data-testid="retry">
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
            </Button>
          </div>
        </div>
      </Overlay>
    )
  }
  return null
}
