// Export data, natively: the HCDP v2 rewrite's export form (dataset, period,
// date range, extents, the files HCDP packages, station CSVs) with two ways
// out — "Download now" through POST /api/export/instant (a zip streamed from
// HCDP, up to 150 files) and "Email me the package" through
// POST /api/export/email. What the form offers comes from
// GET /api/export/options, so the backend's recipe table (export.py, a
// mirror of hcdp_v2's dataset configs) is the single source. The email is
// sent with the request and never stored. Everything the form does not
// cover (SPI, NDVI, ignition, projections, climatologies) is a plain link to
// the original app.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Download, Loader2, Mail } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LABEL, Segmented, Select } from '../../viewer/map/Controls'
import { useDateRange } from '../../viewer/map/dateRanges'
import { useJson } from '../../viewer/map/stationData'
import { clampDate, shiftDate, shiftMonths, shortDate } from '../../viewer/map/viewerModel'
import ExternalLink from './ExternalLink'

export const EXPORT_OPTIONS_URL = '/api/export/options'
const EXTENT_LABELS = { statewide: 'Statewide', hawaii: 'Hawaiʻi', maui: 'Maui', oahu: 'Honolulu (Oʻahu)', kauai: 'Kauaʻi' }
const UNIT_LABELS = { mm: 'mm', c: '°C' }
const FIELD = 'h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [@media(pointer:coarse)]:h-11'
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Inclusive count of days or months from start to end (export.py periods_between). */
export function periodsBetween(start, end, period) {
  if (!start || !end || start > end) return 0
  if (period === 'day') return Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1
  const [y1, m1] = start.split('-').map(Number), [y2, m2] = end.split('-').map(Number)
  return (y2 * 12 + m2) - (y1 * 12 + m1) + 1
}

/** hcdp_v2's file count: periods × (extents × grid files + station files). */
export function estimateFiles({ start, end, period, extents, files, stationFiles }) {
  return periodsBetween(start, end, period) * (extents.length * files.length + stationFiles.length)
}

/** The grid files to tick when the visitor ticks `files`: each file's requirements come along (hcdp_v2). */
export function withRequired(files, gridFiles) {
  const out = [...files]
  for (const id of files) for (const req of gridFiles.find((f) => f.id === id)?.requires || []) if (!out.includes(req)) out.push(req)
  return gridFiles.map((f) => f.id).filter((id) => out.includes(id))
}

/** hcdp_v2's default window: one month of days, or one year of months, ending at the newest published date. */
export function defaultWindow(range, period) {
  if (!range) return { start: '', end: '' }
  const start = period === 'day' ? shiftMonths(range.end, 'day', -1) : shiftDate(range.end, 'month', -11)
  return { start: clampDate(start, range), end: range.end }
}

export const isEmail = (s) => EMAIL_RE.test(String(s || '').trim()) && String(s).trim().length <= 254

/** The request body for either export endpoint. */
export function requestBody(state) {
  const body = { dataset: state.dataset, period: state.period, start: state.start, end: state.end, extents: state.files.length ? state.extents : [], files: state.files, station_files: state.stationFiles }
  if (state.email.trim()) body.email = state.email.trim()
  return body
}

function filenameFrom(disposition, fallback) {
  const m = /filename="?([^";]+)"?/i.exec(disposition || '')
  return m ? m[1] : fallback
}

function saveBlob(blob, filename) {
  if (typeof URL.createObjectURL !== 'function') return false
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

async function readDetail(resp) {
  try { const b = await resp.json(); return typeof b?.detail === 'string' ? b.detail : (typeof b?.message === 'string' ? b.message : null) } catch { return null }
}

export default function ExportForm({ originalHref, className = '' }) {
  const id = useId()
  const options = useJson(EXPORT_OPTIONS_URL)
  const datasets = options.data?.datasets || []
  const instantMax = options.data?.instant_max_files ?? 150
  const [dataset, setDataset] = useState('rainfall')
  const product = datasets.find((d) => d.id === dataset) || datasets[0] || null
  const [period, setPeriod] = useState('month')
  const periodOk = product?.periods.includes(period) ? period : (product?.periods[0] || 'month')
  const [dates, setDates] = useState({ start: '', end: '' })
  const [extents, setExtents] = useState(['statewide'])
  const [files, setFiles] = useState(['data_map', 'metadata'])
  const [stationFiles, setStationFiles] = useState([])
  const [email, setEmail] = useState('')
  const [licence, setLicence] = useState(false)
  const [status, setStatus] = useState({ kind: 'idle' })

  // The published range bounds the date fields; the default window follows it until the visitor types a date.
  const range = useDateRange(dataset, periodOk, 'statewide')
  const touched = useRef(null)
  useEffect(() => {
    const key = `${dataset}|${periodOk}`
    if (touched.current === key) return
    if (range.range) setDates(defaultWindow(range.range, periodOk))
    else if (range.status === 'error') { touched.current = key; setDates((d) => (d.start ? d : { start: '', end: '' })) }
  }, [dataset, periodOk, range.range, range.status])
  const setDate = (patch) => { touched.current = `${dataset}|${periodOk}`; setDates((d) => ({ ...d, ...patch })) }

  const gridFiles = product?.grid_files || []
  const fills = product?.station_fills?.[periodOk] || []
  const allowedExtents = product?.extents || ['statewide']
  // Only what this product and period offer counts.
  const shownFiles = withRequired(files.filter((f) => gridFiles.some((g) => g.id === f)), gridFiles)
  const shownFills = stationFiles.filter((f) => fills.some((x) => x.id === f))
  const shownExtents = extents.filter((e) => allowedExtents.includes(e))
  const locked = (fid) => shownFiles.some((f) => f !== fid && (gridFiles.find((g) => g.id === f)?.requires || []).includes(fid))

  const onDataset = (d) => {
    setDataset(d); setStatus({ kind: 'idle' })
    const next = datasets.find((x) => x.id === d)
    const first = next?.grid_files?.[0]?.id
    setFiles(first ? withRequired([first], next.grid_files) : [])
    setStationFiles([]); setExtents(['statewide'])
  }
  const onPeriod = (p) => { setPeriod(p); setStationFiles([]); setStatus({ kind: 'idle' }) }
  const toggleFile = (fid, on) => setFiles(on ? withRequired([...shownFiles, fid], gridFiles) : shownFiles.filter((f) => f !== fid))
  const toggleFill = (fid, on) => setStationFiles(on ? [...shownFills, fid] : shownFills.filter((f) => f !== fid))
  const toggleExtent = (e, on) => setExtents(on ? allowedExtents.filter((x) => x === e || shownExtents.includes(x)) : shownExtents.filter((x) => x !== e))

  const state = { dataset, period: periodOk, start: dates.start, end: dates.end, extents: shownExtents, files: shownFiles, stationFiles: shownFills, email }
  const count = estimateFiles(state)
  const datesOk = Boolean(dates.start && dates.end && dates.start <= dates.end)
  const problems = []
  if (!datesOk) problems.push('Choose a start and an end date, start first.')
  if (!shownFiles.length && !shownFills.length) problems.push('Tick at least one file.')
  if (shownFiles.length && !shownExtents.length) problems.push('Tick at least one extent for the maps.')
  if (!licence) problems.push('Acknowledge the licence.')
  const ready = problems.length === 0 && count > 0
  const tooBig = count > instantMax
  const emailOk = isEmail(email)
  const working = status.kind === 'working'

  const submit = async (how) => {
    setStatus({ kind: 'working', how })
    const body = requestBody(state)
    try {
      const resp = await fetch(how === 'email' ? '/api/export/email' : '/api/export/instant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!resp.ok) { setStatus({ kind: 'error', message: (await readDetail(resp)) || `HCDP's export service answered ${resp.status}. Try again in a moment.` }); return }
      if (how === 'email') {
        const answer = await resp.json().catch(() => ({}))
        setStatus({ kind: 'done', how, message: answer.message || `HCDP will email a download link to ${body.email}.` })
        return
      }
      const blob = await resp.blob()
      const name = filenameFrom(resp.headers.get('content-disposition'), `hcdp_${dataset}_${periodOk}_${dates.start}_${dates.end}.zip`)
      const saved = saveBlob(blob, name)
      setStatus({ kind: 'done', how, message: saved ? `Your download has started: ${name} (${(blob.size / 1048576).toLocaleString('en-US', { maximumFractionDigits: 1 })} MB, about ${count.toLocaleString('en-US')} files).` : 'The package arrived but this browser would not save it.' })
    } catch {
      setStatus({ kind: 'error', message: 'The export service did not answer. Check your connection and try again.' })
    }
  }

  const unit = UNIT_LABELS[product?.units] || product?.units || ''
  const dateType = periodOk === 'day' ? 'date' : 'month'
  const fileType = (t) => options.data?.file_types?.[t]

  if (options.status === 'error') {
    return (
      <Alert variant="warning" data-testid="export-form-error">
        <AlertTitle>The export options did not load.</AlertTitle>
        <AlertDescription>Try again in a moment, or <ExternalLink href={originalHref}>export from the HCDP data portal</ExternalLink>.</AlertDescription>
      </Alert>
    )
  }

  return (
    <form className={cn('space-y-6 rounded-lg border border-border bg-card p-4 sm:p-5', className)} onSubmit={(e) => e.preventDefault()} aria-busy={options.status === 'loading' || working} data-testid="export-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-dataset`} className={LABEL}>Dataset</label>
          <Select id={`${id}-dataset`} value={product?.id || dataset} onChange={onDataset} disabled={!datasets.length} data-testid="export-dataset">
            {(datasets.length ? datasets : [{ id: dataset, label: 'Loading…' }]).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </Select>
        </div>
        <Segmented legend="Period" name={`${id}-period`} value={periodOk} onChange={onPeriod} testid="export-period"
          options={(product?.periods || ['month']).map((p) => ({ value: p, label: p === 'month' ? 'Monthly' : 'Daily' }))} />
        <div>
          <label htmlFor={`${id}-start`} className={LABEL}>From</label>
          <input id={`${id}-start`} type={dateType} className={cn(FIELD, 'font-mono text-[13px]')} value={dates.start} min={range.range?.start} max={dates.end || range.range?.end}
            onChange={(e) => setDate({ start: e.target.value })} data-testid="export-start" />
        </div>
        <div>
          <label htmlFor={`${id}-end`} className={LABEL}>To</label>
          <input id={`${id}-end`} type={dateType} className={cn(FIELD, 'font-mono text-[13px]')} value={dates.end} min={dates.start || range.range?.start} max={range.range?.end}
            onChange={(e) => setDate({ end: e.target.value })} data-testid="export-end" />
        </div>
      </div>
      <p className="-mt-3 text-xs text-subtle" data-testid="export-range-hint">
        {range.range ? `HCDP has ${product?.label.toLowerCase() || 'this'} by ${periodOk} from ${shortDate(range.range.start)} to ${shortDate(range.range.end)}.` : range.status === 'loading' ? 'Looking up the published dates…' : 'The published dates could not be looked up; any dates can be asked for.'}
      </p>

      {gridFiles.length > 0 && (
        <fieldset>
          <legend className={LABEL}>Gridded maps{unit ? ` (${unit})` : ''}</legend>
          <ul className="grid gap-1 sm:grid-cols-2">
            {gridFiles.map((f) => {
              const on = shownFiles.includes(f.id)
              const isLocked = on && locked(f.id)
              return (
                <li key={f.id}>
                  <label className={cn('flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border border-border px-2.5 py-2 hover:bg-muted', on && 'bg-accent-soft')}>
                    <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-accent" checked={on} disabled={isLocked} onChange={(e) => toggleFile(f.id, e.target.checked)} data-testid={`export-file-${f.id}`} />
                    <span className="min-w-0 text-sm">
                      <span className="flex flex-wrap items-center gap-1.5 font-medium">{f.label} <Badge variant="muted" className="font-mono text-[10px]" title={fileType(f.type)?.description}>{fileType(f.type)?.ext || f.type}</Badge></span>
                      <span className="block text-xs text-subtle">{f.description}{isLocked ? ' Comes with every map.' : ''}</span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="mt-3">
            <span className={LABEL}>Extent of the maps</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Extent of the maps">
              {allowedExtents.map((e) => {
                const on = shownExtents.includes(e)
                return (
                  <label key={e} className={cn('inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 text-sm hover:bg-muted [@media(pointer:coarse)]:min-h-11', on && 'border-foreground bg-accent-soft')}>
                    <input type="checkbox" className="h-3.5 w-3.5 rounded border-border accent-accent" checked={on} onChange={(ev) => toggleExtent(e, ev.target.checked)} disabled={!shownFiles.length} data-testid={`export-extent-${e}`} />
                    {EXTENT_LABELS[e] || e}
                  </label>
                )
              })}
            </div>
          </div>
        </fieldset>
      )}

      {product && (
        <fieldset>
          <legend className={LABEL}>Station data (CSV, statewide)</legend>
          {fills.length ? (
            <ul className="grid gap-1 sm:grid-cols-2">
              {fills.map((f) => (
                <li key={f.id}>
                  <label className={cn('flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border border-border px-2.5 py-2 hover:bg-muted', shownFills.includes(f.id) && 'bg-accent-soft')}>
                    <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-accent" checked={shownFills.includes(f.id)} onChange={(e) => toggleFill(f.id, e.target.checked)} data-testid={`export-station-${f.id}`} />
                    <span className="min-w-0 text-sm">
                      <span className="flex flex-wrap items-center gap-1.5 font-medium">{f.label} <Badge variant="muted" className="font-mono text-[10px]">.csv</Badge></span>
                      <span className="block text-xs text-subtle">{f.description}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-subtle" data-testid="export-no-stations">HCDP has no station data for {product.label.toLowerCase()} by {periodOk}.</p>}
        </fieldset>
      )}

      <div className="rounded-md bg-inset px-3 py-2 text-sm" data-testid="export-estimate">
        <span className="font-medium">About {count.toLocaleString('en-US')} files.</span>{' '}
        <span className="text-subtle">
          {tooBig ? `More than the ${instantMax} HCDP zips for a direct download — have the package emailed.` : `Up to ${instantMax} files download at once; larger packages are emailed.`}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-email`} className={LABEL}>Email {tooBig ? '(needed for this package)' : '(for the emailed package; optional otherwise)'}</label>
          <input id={`${id}-email`} type="email" autoComplete="email" inputMode="email" className={FIELD} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ikaika@hawaii.edu" data-testid="export-email" />
          <p className="mt-1 text-xs text-subtle">Sent to HCDP with the request, never stored by this site.</p>
        </div>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-accent" checked={licence} onChange={(e) => setLicence(e.target.checked)} data-testid="export-licence" />
          <span>
            I will use the data under HCDP's <ExternalLink href="https://creativecommons.org/licenses/by-nc-nd/4.0/">CC BY-NC-ND 4.0 licence</ExternalLink> and cite the products
            (<a className="underline decoration-border-strong underline-offset-2 hover:decoration-foreground" href="/about/how-to-cite">How to Cite</a>).
          </span>
        </label>
      </div>

      {problems.length > 0 && <p className="text-xs text-subtle" data-testid="export-problems">{problems.join(' ')}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => submit('instant')} disabled={!ready || tooBig || working} className="[@media(pointer:coarse)]:h-11" data-testid="export-download">
          {working && status.how === 'instant' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />} Download now
        </Button>
        <Button type="button" variant="outline" onClick={() => submit('email')} disabled={!ready || !emailOk || working} className="[@media(pointer:coarse)]:h-11" data-testid="export-email-send">
          {working && status.how === 'email' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />} Email me the package
        </Button>
      </div>

      {status.kind === 'done' && (
        <Alert data-testid="export-result" role="status">
          <AlertTitle>{status.how === 'email' ? 'Request sent' : 'Downloading'}</AlertTitle>
          <AlertDescription>{status.message}</AlertDescription>
        </Alert>
      )}
      {status.kind === 'error' && (
        <Alert variant="destructive" data-testid="export-result">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>{status.message}</AlertDescription>
        </Alert>
      )}
    </form>
  )
}
