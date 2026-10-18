import { useCallback, useId, useMemo, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { Download } from 'lucide-react'
import { DATASETS, formatViewerPath, describeViewer } from '../../viewer/urlGrammar'
import { portalDataset } from '../../viewer/portalDatasets.reference'
import { HCDP } from '../../site/nav'
import { PORTAL_APP } from '../../site/original'
import { EXPORT_LABEL, EXPORT_PATH, VISUALIZE_LABEL, VISUALIZE_PATH, defaultMapPath } from '../../site/visualize'
import { PageShell, Section } from './PageShell'
import ExternalLink from './ExternalLink'
import ExportForm from './ExportForm'
import AISummary from '../../assistant/AISummary'
import { prefersReducedMotion } from '../../assistant/AssistantProvider'
import AccessDataLine from '../../download/AccessDataLine'
import OfferCard from '../../download/OfferCard'
import { pageOverview, usePageFollowups, usePageHead } from '../../portal/MirroredPage'
import { useAppOverview } from '../../portal/usePortalPage'
import { dataRelated, lastCompleteMonth, yesterday } from './contentUtils'
import '../../portal/portal.css'

const PORTAL_PAGE = `${HCDP}/data-portal/`

// ===========================================================================
// Access Data — https://www.hawaii.edu/climate-data-portal/data-portal/ — and its two doors, Visualize Data (the viewer,
// /data/visualize → /viewer/...) and Export Data (/data/export).
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

// ── Access Data: two tiles, as on HCDP's data portal ─────────────────────────────────────────────────────────────────
// 18 Oct (the user: "'ACCESS DATA' should open to two options only: Visualize Data and Export Data (like in the screenshot
// of the original HCDP website)"): the page is the portal app's two tiles and nothing else but the AI overview line above
// them (closed on a direct load). The tiles copy the app's own (rainfall.ikewai.org's nav tiles): the title in 32 px bold
// Roboto, the caption in 16 px, the picture the app uses (its vis_tile_background.png and export_tile_background.jpg, as
// WebP in public/tiles) filling the tile and fading out to the left; the two share the viewport under the sticky header.
export const DATA_TILES = [
  { key: 'visualize', title: VISUALIZE_LABEL, caption: 'Visualize available climate data in the portal.', to: VISUALIZE_PATH, image: '/tiles/visualize-data.webp' },
  { key: 'export', title: EXPORT_LABEL, caption: 'Generate customized packages of data to export from the portal.', to: EXPORT_PATH, image: '/tiles/export-data.webp' },
]

function DataTile({ tile }) {
  const id = useId().replace(/:/g, '')
  return (
    <Link to={tile.to} className="hcdp-data-tile" aria-labelledby={`${id}-t`} aria-describedby={`${id}-c`} data-testid={`data-tile-${tile.key}`}>
      <span className="hcdp-data-tile-text">
        <h2 id={`${id}-t`}>{tile.title}</h2>
        <p id={`${id}-c`}>{tile.caption}</p>
      </span>
      <span className="hcdp-data-tile-picture" style={{ backgroundImage: `url(${tile.image})` }} aria-hidden="true" data-testid="data-tile-picture" />
    </Link>
  )
}

export function AccessData() {
  const { pathname } = useLocation()
  usePageHead('Access Data', PORTAL_PAGE)
  // the page's own overview (written by the mirror's job from the catalog), closed on a direct load; an answer's opens
  const record = useAppOverview('/data')
  const fallback = useMemo(() => pageOverview(record, pathname), [record, pathname])
  usePageFollowups(fallback)
  return (
    <div className="hcdp-data-portal" data-testid="access-data">
      <h1 className="sr-only">Access Data</h1>
      <div className="hcdp-mirror-container hcdp-mirror-overview" data-testid="data-overview"><AISummary fallback={fallback} /></div>
      <nav aria-label="Access Data" className="hcdp-data-tiles" data-testid="data-tiles">
        {DATA_TILES.map((t) => <DataTile key={t.key} tile={t} />)}
      </nav>
    </div>
  )
}

// ── Visualize Data: /data/visualize lands on the default map ────────────────────────────────────────────────────────────
// The viewer is the tool (/viewer/... deep links unchanged); its door replaces itself with the latest monthly rainfall
// map, statewide, so Back from the map returns to Access Data.
export function VisualizeData() {
  const target = useMemo(() => defaultMapPath(new Date()), [])
  return <Navigate to={target} replace />
}

// ── Export Data: the form, the datasets, the AI line ───────────────────────────────────────────────────────────────────
export function ExportData() {
  const now = useMemo(() => new Date(), [])
  usePageHead(EXPORT_LABEL, PORTAL_PAGE)
  // 13 Oct (D1 D): the AI line at the top of the page ticks the Export form from a sentence and scrolls it into view.
  const [prefill, setPrefill] = useState(null)
  const onPrefill = useCallback((p) => {
    setPrefill(p)
    window.setTimeout(() => document.getElementById('export')?.scrollIntoView?.({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }), 60)
  }, [])
  return (
    <PageShell
      title={EXPORT_LABEL}
      icon={Download}
      top={<><AccessDataLine onPrefill={onPrefill} className="mb-7" /><OfferCard className="mb-7" /></>}
      source={PORTAL_PAGE}
      lead={<p>Generate customized packages of data to export from the portal: Hawaiʻi's rainfall and temperature grids (GeoTIFF), their standard-error and anomaly maps, metadata and error metrics, and the station data behind them (CSV), for the dates and islands you choose. Small packages download at once; larger ones are zipped by HCDP and a link is emailed to you.</p>}
      related={dataRelated(EXPORT_PATH)}
    >
      <Section id="export" title="Export form">
        <ExportForm originalHref={`${PORTAL_APP}/?datatype=rainfall&period=month`} prefill={prefill} />
        <p className="mt-3 text-sm text-subtle" data-testid="export-original-link">
          Drought index (SPI), vegetation (NDVI), ignition probability, climate projections and the climatologies are exported from the{' '}
          <ExternalLink href={`${PORTAL_APP}/?datatype=spi&period=month`}>original HCDP data portal app</ExternalLink>.
        </p>
      </Section>

      <Section id="datasets" title="Datasets" lead={<p>What HCDP maps and packages. “—”: the portal gives no first year for this product; its date picker shows the dates available. “Map it” opens the dataset in {VISUALIZE_LABEL}.</p>}>
        {/* M6 A (14 Oct): under 640 px each row is a stacked card (globals.css .hcdp-stack) instead of a sideways scroll */}
        <div className="hcdp-stack-wrap relative overflow-x-auto rounded-lg border border-border">
          <table className="hcdp-stack w-full min-w-[640px] text-left text-sm" data-testid="datasets-table">
            <thead className="bg-surface text-xs uppercase tracking-wide text-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Dataset</th>
                <th scope="col" className="px-3 py-2 font-medium">Periods</th>
                <th scope="col" className="px-3 py-2 font-medium">Coverage</th>
                <th scope="col" className="px-3 py-2 font-medium">First year</th>
                <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Open in {VISUALIZE_LABEL}</span></th>
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
                    <td className="px-3 py-2" data-label="Periods">{rowPeriods(row).join(', ')}</td>
                    <td className="px-3 py-2" data-label="Coverage">{row.coverage}</td>
                    <td className="px-3 py-2 font-mono text-xs" data-label="First year">{row.first || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {v ? <Link to={formatViewerPath(v)} className="whitespace-nowrap text-accent hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center" aria-label={`Map ${describeViewer(v)} in ${VISUALIZE_LABEL}`}>Map it →</Link> : <span className="text-xs text-subtle">portal</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-subtle">Rainfall 1990 onward is the contemporary product; 1920–2012 is the legacy product. Future periods: mid-century 2040–2069; late century 2070–2099 (statistical) or 2080–2099 (dynamical).</p>
      </Section>
    </PageShell>
  )
}

// The API and Tutorials pages are HCDP's own now, mirrored live (src/portal, CONTRACT.md "Mirrored pages", 14 Oct).
