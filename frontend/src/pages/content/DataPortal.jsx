import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Map as MapIcon, Code2, GraduationCap, Download, ArrowRight, Quote, Eye } from 'lucide-react'
import { DATASETS, formatViewerPath, describeViewer } from '../../viewer/urlGrammar'
import { portalDataset } from '../../viewer/portalDatasets.reference'
import { HCDP } from '../../site/nav'
import { PORTAL_APP } from '../../site/original'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageShell, Section, FactList } from './PageShell'
import ExternalLink from './ExternalLink'
import ExportForm from './ExportForm'
import AISummary from '../../assistant/AISummary'
import { prefersReducedMotion } from '../../assistant/AssistantProvider'
import AccessDataLine from '../../download/AccessDataLine'
import { dataRelated, lastCompleteMonth, yesterday } from './contentUtils'

const PORTAL_PAGE = `${HCDP}/data-portal/`

// ===========================================================================
// Access Data — https://www.hawaii.edu/climate-data-portal/data-portal/
// ===========================================================================

const PERIOD_LABEL = { month: 'Monthly', day: 'Daily' }
const BY_COUNTY = 'Statewide or by county'

// The portal's datasets (its dataset selector, github.com/HCDP/hcdp prod).
// Names and units come from portalDatasets.reference.js; time steps from the
// viewer's DATASETS; first years from the portal's own descriptions and the
// How to Cite page. "—" where the portal states no first year.
const DATASET_ROWS = [
  { id: 'rainfall', spec: { datatype: 'rainfall' }, viewer: 'rainfall', coverage: BY_COUNTY, first: '1990', note: 'Station data partial filled or unfilled.' },
  { id: 'legacy-rainfall', name: 'Legacy Rainfall', units: 'mm', periods: ['Monthly'], coverage: 'Statewide', first: '1920', note: 'Older production methods, 1920–2012.' },
  { id: 'temperature-max', spec: { datatype: 'temperature', aggregation: 'max' }, viewer: 'temperature-max', coverage: BY_COUNTY, first: '1990' },
  { id: 'temperature-min', spec: { datatype: 'temperature', aggregation: 'min' }, viewer: 'temperature-min', coverage: BY_COUNTY, first: '1990' },
  { id: 'temperature-mean', spec: { datatype: 'temperature', aggregation: 'mean' }, viewer: 'temperature-mean', coverage: BY_COUNTY, first: '1990' },
  { id: 'humidity', spec: { datatype: 'relative_humidity' }, viewer: 'humidity', coverage: BY_COUNTY, first: null },
  { id: 'ndvi', spec: { datatype: 'ndvi_modis' }, viewer: 'ndvi', coverage: BY_COUNTY, first: null, note: 'Vegetation greenness.' },
  { id: 'ignition', spec: { datatype: 'ignition_probability' }, viewer: 'ignition', coverage: BY_COUNTY, first: null, note: 'Chance of a large (8+ acre) fire igniting; also predicted 1–3 days ahead.' },
  { id: 'spi', name: 'Standardized Precipitation Index (SPI)', spec: { datatype: 'spi', timescale: 3 }, viewer: 'spi-3', coverage: 'Statewide', first: null, note: 'Drought index; 1- to 60-month timescales.' },
  { id: 'projections', name: 'Rainfall and Temperature Projections', periods: ['Present day', 'Mid-century', 'Late century'], coverage: 'Statewide', first: null, note: 'Downscaled future projections (dynamical or statistical; RCP 4.5 and 8.5).' },
  { id: 'climatologies', name: 'Mean Rainfall and Air Temperature', periods: ['Monthly', 'Seasonal', 'Decadal', '30-year'], coverage: 'Statewide (legacy mean rainfall also by county)', first: null, note: 'Climatologies: contemporary 1991–2020, legacy 1920–2012.' },
]

function rowView(row, now) {
  if (!row.viewer) return null
  const periods = DATASETS[row.viewer].periods
  return periods.includes('month')
    ? { dataset: row.viewer, period: 'month', date: lastCompleteMonth(now), extent: 'statewide' }
    : { dataset: row.viewer, period: 'day', date: yesterday(now), extent: 'statewide' }
}

function rowName(row) {
  if (row.name) return row.name
  return portalDataset({ ...row.spec, period: 'month' })?.datatypeLabel || row.id
}

function rowUnits(row) {
  if (row.units !== undefined) return row.units
  return row.spec ? portalDataset({ ...row.spec, period: 'month' })?.units || '' : ''
}

function rowPeriods(row) {
  if (row.periods) return row.periods
  return (DATASETS[row.viewer]?.periods || []).map((p) => PERIOD_LABEL[p])
}

function quickMaps(now) {
  const month = lastCompleteMonth(now)
  const day = yesterday(now)
  return [
    { v: { dataset: 'rainfall', period: 'month', date: month, extent: 'statewide' }, note: 'Last complete month' },
    { v: { dataset: 'rainfall', period: 'day', date: day, extent: 'statewide' }, note: 'Yesterday' },
    { v: { dataset: 'spi-3', period: 'month', date: month, extent: 'statewide' }, note: 'Drought, last complete month' },
    { v: { dataset: 'temperature-max', period: 'month', date: month, extent: 'oahu' }, note: 'Last complete month' },
    { v: { dataset: 'temperature-mean', period: 'month', date: month, extent: 'statewide' }, note: 'Last complete month' },
    { v: { dataset: 'spi-12', period: 'month', date: month, extent: 'statewide' }, note: 'Longer-term drought' },
  ]
}

function ExternalButton({ href, children, variant = 'default', size = 'default' }) {
  return (
    <Button asChild variant={variant} size={size}>
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}<span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span>
      </a>
    </Button>
  )
}

export function AccessData() {
  const now = useMemo(() => new Date(), [])
  const maps = useMemo(() => quickMaps(now), [now])
  // 13 Oct (D1 D): the AI line at the top of the page ticks the Export form from a sentence and scrolls it into view.
  const [prefill, setPrefill] = useState(null)
  const onPrefill = useCallback((p) => {
    setPrefill(p)
    window.setTimeout(() => document.getElementById('export')?.scrollIntoView?.({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }), 60)
  }, [])
  return (
    <PageShell
      title="Access Data"
      icon={MapIcon}
      summary={false}
      top={<AccessDataLine onPrefill={onPrefill} className="mb-7" />}
      source={PORTAL_PAGE}
      lead={<p>The HCDP data portal maps and downloads Hawaiʻi's gridded climate products (rainfall back to 1920, temperature, drought, humidity, vegetation and fire risk) together with the station data behind them.</p>}
      actions={(
        <>
          <ExternalButton href={PORTAL_PAGE} size="lg" variant="outline">Open the HCDP data portal</ExternalButton>
          <Button asChild size="lg"><Link to={formatViewerPath({ dataset: 'rainfall', period: 'month', date: lastCompleteMonth(now), extent: 'statewide' })}>Open the climate viewer</Link></Button>
        </>
      )}
      related={dataRelated('/data')}
    >
      <Section id="offers" title="What the portal offers">
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2"><Eye className="h-4 w-4 text-accent" aria-hidden="true" /><h3 className="font-display text-lg">Visualize data</h3></div>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>Pick a dataset, a time step (monthly or daily) and a date, and see the gridded map with the station values on it.</li>
              <li>Switch the base layer (satellite or street), the map opacity and the colour scheme.</li>
              <li>Select a station for its metadata and a time series (current month, current year or all values).</li>
              <li>Download the map or the time series as an image.</li>
            </ul>
          </Card>
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2"><Download className="h-4 w-4 text-accent" aria-hidden="true" /><h3 className="font-display text-lg">Export data</h3></div>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>Pick a dataset, a time step and a date range.</li>
              <li>Tick the files you need: gridded maps (GeoTIFF), standard error and anomaly maps, metadata and error metrics (text), station data (CSV).</li>
              <li>Enter an email address; large requests are sent by email.</li>
            </ul>
          </Card>
        </div>
        <FactList
          className="mt-5"
          items={[
            ['Extent', 'Statewide, or one county: Hawaiʻi, Maui, Honolulu (Oʻahu), Kauaʻi.'],
            ['Units', 'Millimetres or inches; °C or °F.'],
            ['Station data', 'Partial filled (quality-controlled, some missing values estimated; the gridded maps use it) or unfilled (values as the stations reported them, before QA/QC).'],
          ]}
        />
      </Section>

      <Section id="datasets" title="Datasets" lead={<p>What you can map and download on the portal. “—”: the portal gives no first year for this product; its date picker shows the dates available.</p>}>
        <div className="relative overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-left text-sm" data-testid="datasets-table">
            <thead className="bg-surface text-xs uppercase tracking-wide text-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Dataset</th>
                <th scope="col" className="px-3 py-2 font-medium">Periods</th>
                <th scope="col" className="px-3 py-2 font-medium">Coverage</th>
                <th scope="col" className="px-3 py-2 font-medium">First year</th>
                <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Open in the viewer</span></th>
              </tr>
            </thead>
            <tbody>
              {DATASET_ROWS.map((row) => {
                const v = rowView(row, now)
                const units = rowUnits(row)
                return (
                  <tr key={row.id} className="border-t border-border align-top">
                    <th scope="row" className="px-3 py-2 font-medium">
                      {rowName(row)}{units ? <span className="font-normal text-subtle"> ({units})</span> : null}
                      {row.note && <p className="mt-0.5 text-xs font-normal text-subtle">{row.note}</p>}
                    </th>
                    <td className="px-3 py-2">{rowPeriods(row).join(', ')}</td>
                    <td className="px-3 py-2">{row.coverage}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.first || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {v ? <Link to={formatViewerPath(v)} className="whitespace-nowrap text-accent hover:underline" aria-label={`Map ${describeViewer(v)} in the viewer`}>Map it →</Link> : <span className="text-xs text-subtle">portal</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-subtle">Rainfall 1990 onward is the contemporary product; 1920–2012 is the legacy product. Future periods: mid-century 2040–2069; late century 2070–2099 (statistical) or 2080–2099 (dynamical).</p>
      </Section>

      <Section id="quick-maps" title="Quick maps" lead={<p>Open a map in this site's climate viewer. Every address describes exactly what it shows, so you can share it.</p>}>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="quick-maps">
          {maps.map(({ v, note }) => {
            const path = formatViewerPath(v)
            return (
              <li key={path}>
                <Link to={path} className="group block h-full rounded-lg border border-border bg-card p-3 hover:border-foreground">
                  <span className="block text-xs text-subtle">{note}</span>
                  <span className="mt-0.5 block font-medium">{describeViewer(v)}</span>
                  <span className="mt-2 block break-all font-mono text-[11px] text-subtle">{path}</span>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent">Open map <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
                </Link>
              </li>
            )
          })}
        </ul>
      </Section>

      <Section id="export" title="Export data" lead={<p>Rainfall and temperature as HCDP packages them: gridded maps (GeoTIFF), their standard-error and anomaly maps, metadata and error metrics, and the station data as CSV, for the dates and extents you choose. Small packages download at once; larger ones are zipped by HCDP and a link is emailed to you.</p>}>
        {/* 13 Oct: on this page the assistant's AI summary sits above the Export form (and the page scrolls to it on arrival). */}
        <AISummary scrollIntoView className="mb-5" />
        <ExportForm originalHref={`${PORTAL_APP}/?datatype=rainfall&period=month`} prefill={prefill} />
        <p className="mt-3 text-sm text-subtle" data-testid="export-original-link">
          Drought index (SPI), vegetation (NDVI), ignition probability, climate projections and the climatologies are exported from the{' '}
          <ExternalLink href={`${PORTAL_APP}/?datatype=spi&period=month`}>original HCDP data portal app</ExternalLink>.
        </p>
      </Section>

      <Section id="more" title="More ways in">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { to: '/data/api', icon: Code2, title: 'HCDP / Hawaiʻi Mesonet API', blurb: 'Download data by writing code.' },
            { to: '/data/tutorials', icon: GraduationCap, title: 'Tutorials', blurb: 'Make a map, explore station data, export data.' },
            { to: '/about/how-to-cite', icon: Quote, title: 'How to Cite', blurb: 'Citations for every product.' },
          ].map((c) => (
            <Link key={c.to} to={c.to} className="group rounded-lg border border-border bg-card p-3 hover:border-foreground">
              <c.icon className="mb-2 h-4 w-4 text-accent" aria-hidden="true" />
              <span className="block font-medium">{c.title}</span>
              <span className="block text-sm text-subtle">{c.blurb}</span>
            </Link>
          ))}
        </div>
      </Section>
    </PageShell>
  )
}

// The API and Tutorials pages are HCDP's own now, mirrored live (src/portal, CONTRACT.md "Mirrored pages", 14 Oct).
