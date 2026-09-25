import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Map as MapIcon, Code2, GraduationCap, Download, Layers, ArrowRight, KeyRound, Quote, Eye } from 'lucide-react'
import { DATASETS, formatViewerPath, describeViewer } from '../../viewer/urlGrammar'
import { portalDataset } from '../../viewer/portalDatasets.reference'
import { HCDP } from '../../site/nav'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageShell, Section, FactList } from './PageShell'
import ExternalLink from './ExternalLink'
import EmbedFrame from './EmbedFrame'
import { CodeBlock, CopyBlock } from './CopyButton'
import { dataRelated, lastCompleteMonth, yesterday } from './contentUtils'

const PORTAL_PAGE = `${HCDP}/data-portal/`
// The portal's Access Data page is a full-window frame of this app.
const PORTAL_APP = 'https://rainfall.ikewai.org'

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
  return (
    <PageShell
      title="Access Data"
      icon={MapIcon}
      source={PORTAL_PAGE}
      lead={<p>The HCDP data portal maps and downloads Hawaiʻi's gridded climate products (rainfall back to 1920, temperature, drought, humidity, vegetation and fire risk) together with the station data behind them.</p>}
      actions={(
        <>
          <ExternalButton href={PORTAL_PAGE} size="lg">Open the HCDP data portal</ExternalButton>
          <Button asChild variant="outline" size="lg"><a href="#quick-maps">Quick maps in this site's viewer</a></Button>
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

      <Section id="portal" title="The data portal" lead={<p>The portal's Visualize and Export tools, embedded from the portal itself.</p>}>
        <EmbedFrame src={PORTAL_APP} title="HCDP data portal (Visualize and Export Data)" fallbackHref={PORTAL_PAGE} fallbackLabel="open the data portal" />
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

// ===========================================================================
// HCDP / Hawaiʻi Mesonet API — the portal page plus the API documentation
// (https://hcdp.github.io/hcdp_api_docs/, spec in github.com/HCDP/hcdp_api_docs).
// ===========================================================================

const API_PAGE = `${HCDP}/hcdp-hawaii-mesonet-api/`
const API_DOCS = 'https://hcdp.github.io/hcdp_api_docs/'
const TOKEN_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSezcHP7aGTKsJldx0HSOBrw4hTgT9R3M-aR72BDZDbsrOJGkQ/viewform?embedded=true'
const API_BASE = 'https://api.hcdp.ikewai.org'

const ENDPOINTS = [
  { group: 'HCDP API', rows: [
    ['GET', '/raster', 'A gridded map as a GeoTIFF file.'],
    ['GET', '/raster/timeseries', 'Date/value pairs (JSON) for one grid cell, chosen by row and col, index, or lat and lng.'],
    ['POST', '/genzip/email', 'Zips the requested files and emails them to you (202 when accepted).'],
    ['POST', '/genzip/instant/content', 'Zips the requested files and returns the zip.'],
    ['POST', '/genzip/instant/link', 'Zips the requested files and returns a link to it through the files API.'],
    ['POST', '/genzip/instant/splitlink', 'Returns ordered links to parts of the zip, to download and join in order.'],
    ['GET', '/files/production/list', 'Files API links for the files a request describes (the contents of a genzip zip).'],
    ['GET', '/files/production/retrieve', 'The data of one requested file, or 404 if it is not found.'],
    ['GET', '/stations', 'Station metadata and station values, selected with a MongoDB-style query in q.'],
  ] },
  { group: 'Hawaiʻi Mesonet API', rows: [
    ['GET', '/mesonet/db/measurements', 'Station measurements: JSON records, or index and data arrays with row_mode.'],
    ['GET', '/mesonet/db/stations', 'The station list.'],
    ['GET', '/mesonet/db/variables', 'The variable list.'],
    ['GET', '/mesonet/db/stationMonitor', 'Per-station monitoring values: latest readings and 24-hour statistics.'],
    ['POST', '/mesonet/db/measurements/email', 'Emails the requested data as a wide-format CSV (timestamp, station ID, variables…); 202 when accepted.'],
  ] },
]

const PARAMETERS = [
  ['datatype', 'rainfall, temperature, relative_humidity, spi, ndvi_modis, ignition_probability'],
  ['production', 'rainfall only: new (contemporary methods, 1990–present) or legacy (monthly only, 1920–2012)'],
  ['aggregation', 'temperature only: min, max or mean'],
  ['timescale', 'spi only: timescale001, 003, 006, 009, 012, 024, 036, 048 or 060 (months)'],
  ['period', 'month or day'],
  ['extent', 'statewide, bi (Hawaiʻi County), mn (Maui County), oa (Honolulu County), ka (Kauaʻi County); counties for location=hawaii only'],
  ['location', 'hawaii (default) or american_samoa'],
  ['date', 'ISO 8601: YYYY-MM, YYYY-MM-DD, or a date and time with Z or an offset such as -10:00'],
  ['files', 'genzip: data_map, se, anom, anom_se, metadata, station_data'],
]

const EXAMPLES = [
  { what: 'A monthly rainfall map for Hawaiʻi County, February 2022', method: 'GET', url: `${API_BASE}/raster?date=2022-02&extent=bi&datatype=rainfall&production=new&period=month` },
  { what: 'Monthly rainfall at one grid cell, January 2020 to June 2023', method: 'GET', url: `${API_BASE}/raster/timeseries?start=2020-01&end=2023-06&row=324&col=822&extent=statewide&datatype=rainfall&production=new&period=month` },
  { what: 'The same time series, by latitude and longitude', method: 'GET', url: `${API_BASE}/raster/timeseries?start=2020-01&end=2023-06&lat=21.539576&lng=-157.965820&extent=statewide&datatype=rainfall&production=new&period=month` },
  { what: 'Unfilled daily maximum temperature for every station, 8 March 2022', method: 'GET', url: `${API_BASE}/stations?q={'name':'hcdp_station_value','value.date':'2022-03-08','value.period':'day','value.fill':'raw','value.datatype':'temperature','value.aggregation':'max'}&limit=10000&offset=0` },
  { what: 'Monthly rainfall maps and metadata, January 2019 to May 2022, zipped and emailed', method: 'POST', url: `${API_BASE}/genzip/email`, body: '{"email":"<email>","data":[{"datatype":"rainfall","production":"new","period":"month","extent":"statewide","range":{"start":"2019-01","end":"2022-05"},"files":["data_map","metadata"]}]}' },
  { what: 'Two variables (RH_1_Min, Tair_2_Max) from three Hawaiʻi Mesonet stations, from 1 November 2023', method: 'GET', url: `${API_BASE}/mesonet/db/measurements?location=hawaii&station_ids=0145,0141,0115&var_ids=RH_1_Min,Tair_2_Max&start_date=2023-11-01T00%3A00%3A00-10%3A00&join_metadata=true` },
  { what: 'All Hawaiʻi Mesonet stations', method: 'GET', url: `${API_BASE}/mesonet/db/stations` },
  { what: 'All Hawaiʻi Mesonet variables', method: 'GET', url: `${API_BASE}/mesonet/db/variables` },
]

const CURL_EXAMPLE = `# A monthly rainfall map (GeoTIFF) for Hawaiʻi County, February 2022
curl -H "Authorization: Bearer YOUR_TOKEN" -o rainfall_2022-02_bi.tif \\
  "${API_BASE}/raster?date=2022-02&extent=bi&datatype=rainfall&production=new&period=month"

# Hawaiʻi Mesonet readings from three stations, from 1 November 2023
curl -H "Authorization: Bearer YOUR_TOKEN" \\
  "${API_BASE}/mesonet/db/measurements?location=hawaii&station_ids=0145,0141,0115&var_ids=RH_1_Min,Tair_2_Max&start_date=2023-11-01T00%3A00%3A00-10%3A00&join_metadata=true"`

const PYTHON_EXAMPLE = `import requests

BASE = "${API_BASE}"
HEADERS = {"Authorization": "Bearer YOUR_TOKEN"}

# A monthly rainfall map (GeoTIFF) for Hawaiʻi County, February 2022
r = requests.get(f"{BASE}/raster", headers=HEADERS, timeout=60, params={
    "datatype": "rainfall", "production": "new", "period": "month",
    "extent": "bi", "date": "2022-02",
})
r.raise_for_status()
with open("rainfall_2022-02_bi.tif", "wb") as f:
    f.write(r.content)

# Monthly rainfall at a point, January 2020 to June 2023 (date/value pairs)
series = requests.get(f"{BASE}/raster/timeseries", headers=HEADERS, timeout=60, params={
    "datatype": "rainfall", "production": "new", "period": "month",
    "extent": "statewide", "start": "2020-01", "end": "2023-06",
    "lat": 21.539576, "lng": -157.965820,
})
series.raise_for_status()
print(series.json())`

export function ApiAccess() {
  return (
    <PageShell
      title="HCDP / Hawaiʻi Mesonet API"
      icon={Code2}
      source={API_PAGE}
      lead={<p>To download and work with HCDP and Hawaiʻi Mesonet data by writing code, sign up for the HCDP / Hawaiʻi Mesonet API. The documentation is updated as new products and features become available.</p>}
      actions={(
        <>
          <ExternalButton href={TOKEN_FORM}><KeyRound className="h-4 w-4" aria-hidden="true" />Request an API token</ExternalButton>
          <ExternalButton href={API_DOCS} variant="outline">HCDP &amp; Hawaiʻi Mesonet API Documentation</ExternalButton>
        </>
      )}
      related={dataRelated('/data/api')}
    >
      <Section id="what" title="What the API serves">
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-4">
            <h3 className="font-display text-lg">HCDP API</h3>
            <p className="mt-1 text-sm text-subtle">The portal's gridded products and station data: maps as GeoTIFF files, time series for any grid cell, zipped bulk downloads (instant or emailed), file links, and station metadata and values. Data are available for Hawaiʻi and American Samoa.</p>
          </Card>
          <Card className="p-4">
            <h3 className="font-display text-lg">Hawaiʻi Mesonet API</h3>
            <p className="mt-1 text-sm text-subtle">Hawaiʻi Mesonet station measurements, the station and variable lists, a station monitor, and measurement exports sent by email as CSV.</p>
          </Card>
        </div>
      </Section>

      <Section id="token" title="Get a token">
        <ol className="max-w-3xl list-decimal space-y-2 pl-5 text-base">
          <li>Fill out the <ExternalLink href={TOKEN_FORM}>HCDP / Hawaiʻi Mesonet API request form</ExternalLink>. Every endpoint needs a token.</li>
          <li>Send the token with each request in an <code className="rounded bg-inset px-1 py-0.5 font-mono text-sm">Authorization</code> header: the word <code className="rounded bg-inset px-1 py-0.5 font-mono text-sm">Bearer</code>, a space, then your token.</li>
          <li>Keep the token to yourself: do not put it in web pages or public code.</li>
        </ol>
        <div className="mt-4 grid max-w-3xl gap-2">
          <CopyBlock text={API_BASE} what="base URL"><span className="text-xs text-subtle">Base URL</span><span className="block font-mono">{API_BASE}</span></CopyBlock>
          <CopyBlock text="Authorization: Bearer YOUR_TOKEN" what="authorization header"><span className="text-xs text-subtle">Header</span><span className="block font-mono">Authorization: Bearer YOUR_TOKEN</span></CopyBlock>
        </div>
      </Section>

      <Section id="endpoints" title="Endpoints">
        <div className="space-y-6">
          {ENDPOINTS.map((g) => (
            <div key={g.group}>
              <h3 className="mb-2 font-display text-lg">{g.group}</h3>
              <div className="relative overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-surface text-xs uppercase tracking-wide text-subtle">
                    <tr><th scope="col" className="px-3 py-2 font-medium">Method</th><th scope="col" className="px-3 py-2 font-medium">Path</th><th scope="col" className="px-3 py-2 font-medium">Returns</th></tr>
                  </thead>
                  <tbody>
                    {g.rows.map(([method, path, what]) => (
                      <tr key={method + path} className="border-t border-border align-top">
                        <td className="px-3 py-2"><Badge variant={method === 'GET' ? 'soft' : 'muted'} className="font-mono">{method}</Badge></td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{path}</td>
                        <td className="px-3 py-2">{what}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="parameters" title="Parameters">
        <dl className="grid max-w-3xl gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          {PARAMETERS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-foreground">{k}</dt>
              <dd className="text-subtle">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="examples" title="Documented examples" lead={<p>From the API documentation. Send each with your token in the Authorization header.</p>}>
        <ul className="space-y-2">
          {EXAMPLES.map((ex) => (
            <li key={ex.url + ex.method}>
              <CopyBlock text={ex.body ? `${ex.url}\n${ex.body}` : ex.url} what={`example request: ${ex.what}`}>
                <span className="block text-sm">{ex.what}</span>
                <span className="mt-1 block break-all font-mono text-xs text-subtle"><span className="font-semibold text-foreground">{ex.method}</span> {ex.url}</span>
                {ex.body && <span className="mt-1 block break-all font-mono text-xs text-subtle"><span className="font-semibold text-foreground">body</span> {ex.body}</span>}
              </CopyBlock>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="quick-start" title="Quick start" lead={<p>Replace <code className="font-mono">YOUR_TOKEN</code> with your token.</p>}>
        <div className="space-y-4">
          <CodeBlock language="curl" code={CURL_EXAMPLE} what="curl example" />
          <CodeBlock language="python" code={PYTHON_EXAMPLE} what="Python example" />
        </div>
        <p className="mt-4 text-sm text-subtle">The API's datatypes are the ones this site's climate viewer maps; see <Link className="underline" to="/data">Access Data</Link> for quick maps.</p>
      </Section>
    </PageShell>
  )
}

// ===========================================================================
// Tutorials — https://www.hawaii.edu/climate-data-portal/tutorials/
// ===========================================================================

const TUTORIALS = [
  {
    title: 'Visualize Data Tutorial – Make A Map',
    href: `${HCDP}/visualize-data-tutorial/`,
    blurb: 'Walks you through the Visualize Data feature of the HCDP and shows you how to download a map.',
    steps: ['Map navigation', 'Select variable and timestep', 'Select map date', 'Adjust map attributes: base layer, opacity, colour scheme', 'Resize and download the map'],
  },
  {
    title: 'Visualize Data Tutorial – Explore Station Data',
    href: `${HCDP}/visualize-data-tutorial-explore-station-data/`,
    blurb: 'How to select a station on the map, view its metadata and plot a time series. Review steps 1–3 of Make A Map first.',
    steps: ['Select a station', 'Create a time series', 'Resize and download the time series'],
  },
  {
    title: 'Export Data Tutorial',
    href: `${HCDP}/export-data-tutorial/`,
    blurb: 'How to export data: choose the dataset, time period and date range, tick the files you want, and enter an email address (required for large requests).',
    steps: ['Choose the dataset and time period', 'Set the date range', 'Select the files', 'Enter an email address'],
  },
]

export function Tutorials() {
  return (
    <PageShell
      title="Tutorials"
      icon={GraduationCap}
      source={`${HCDP}/tutorials/`}
      lead={<p>Step-by-step guides to the HCDP data portal. The HCDP is creating updated tutorials; questions go to <a className="underline" href="mailto:HCDP@hawaii.edu">HCDP@hawaii.edu</a>.</p>}
      related={dataRelated('/data/tutorials')}
    >
      <Section id="tutorials" title="Data portal tutorials">
        <ol className="grid gap-4 md:grid-cols-3">
          {TUTORIALS.map((t, i) => (
            <li key={t.href}>
              <Card className="flex h-full flex-col p-4">
                <span className="font-mono text-xs text-subtle">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="mt-1 font-display text-lg leading-tight">{t.title}</h3>
                <p className="mt-2 text-sm text-subtle">{t.blurb}</p>
                <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-sm">
                  {t.steps.map((s) => <li key={s}>{s}</li>)}
                </ol>
                <div className="mt-auto pt-4">
                  <ExternalLink href={t.href} className="text-sm font-medium text-accent">Open the tutorial</ExternalLink>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="also" title="Also on the portal">
        <Card className="flex max-w-3xl items-start gap-3 p-4">
          <Layers className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-medium">Hawaiʻi Monthly Climate Summary: How-To Guide</p>
            <p className="mt-1 text-subtle">Choosing a month, a dataset and a geography, and reading the statistics, ranks and drought categories.</p>
            <p className="mt-2"><ExternalLink href={`${HCDP}/climate-summary/#/tutorial`}>Open the guide</ExternalLink> · <Link className="underline" to="/climate-summary">Climate Summary on this site</Link></p>
          </div>
        </Card>
        <Card className="mt-3 flex max-w-3xl items-start gap-3 p-4">
          <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <p className="text-sm text-subtle">Prefer to work in code? The <Link className="underline" to="/data/api">HCDP / Hawaiʻi Mesonet API</Link> page has the endpoints, a curl example and a Python example.</p>
        </Card>
      </Section>
    </PageShell>
  )
}
