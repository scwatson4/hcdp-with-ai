import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { RadioTower, Code2, PlayCircle, Globe2 } from 'lucide-react'
import { HCDP } from '../../site/nav'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PageShell, Section, Prose } from './PageShell'
import ExternalLink from './ExternalLink'
import EmbedFrame from './EmbedFrame'
import { sectionRelated } from './contentUtils'

// Hawaiʻi Mesonet — https://www.hawaii.edu/climate-data-portal/hawaii-mesonet/
// Station count "75 active" from UH News, 9 September 2026.

const MESONET_PAGE = `${HCDP}/hawaii-mesonet/`
const LIVE_DATA_PAGE = `${HCDP}/hawaii-mesonet-data/#/`

// The live viewers. Each server was checked for framing (no X-Frame-Options,
// no CSP frame-ancestors on 2026-09-25); the portal pages that wrap them
// are the fallback links.
const VIEWERS = [
  {
    key: 'live',
    tab: 'Live Data Access',
    title: 'Hawaiʻi Mesonet Live Data Access',
    src: 'https://cherryleh.github.io/mesonet/?source=iframe',
    page: LIVE_DATA_PAGE,
    blurb: 'The portal\'s real-time dashboard: current conditions at every active station, updated every 15 minutes, including temperature, rainfall, wind, humidity, solar radiation and soil moisture.',
  },
  {
    key: 'app',
    tab: 'hawaiimesonet.app',
    title: 'Hawaiʻi Mesonet app (hawaiimesonet.app)',
    src: 'https://hawaiimesonet.app/',
    page: 'https://hawaiimesonet.app/',
    blurb: 'Real-time Hawaiʻi environmental sensor data from the HCDP Mesonet network (the app\'s own description).',
  },
  {
    key: 'nolo',
    tab: 'Tropical Storm Nolo',
    title: 'Tropical Storm Nolo Mesonet Viewer',
    src: 'https://cherryleh.github.io/climate-summary/#/nolo-viewer',
    page: `${HCDP}/nolo-mesonet-viewer/`,
    blurb: 'Rainfall accumulation and maximum wind and gust speeds at Hawaiʻi Mesonet stations for the period starting 22 September 2026, 10:00 PM HST, updated every 15 minutes.',
  },
]

// The live viewers' state lives in the URL: ?viewer=live|app|nolo&station=0115&view=dashboard|graphing|station-map|station-table|wind-map
const VIEWS = [['dashboard', 'Dashboard'], ['graphing', 'Graphs'], ['station-map', 'Station map'], ['station-table', 'Station table'], ['wind-map', 'Wind map']]
function viewerSrc(v, station, view) {
  if (v.key === 'live') return `${v.src}#/${view || 'dashboard'}${station && (view === 'dashboard' || view === 'graphing' || !view) ? `?id=${encodeURIComponent(station)}` : ''}`
  if (v.key === 'app') return station ? `https://hawaiimesonet.app/station/${encodeURIComponent(station)}` : v.src
  return v.src
}

function ViewerTabs() {
  const [params, setParams] = useSearchParams()
  const viewer = VIEWERS.some((v) => v.key === params.get('viewer')) ? params.get('viewer') : 'live'
  const station = params.get('station') || ''
  const view = VIEWS.some(([k]) => k === params.get('view')) ? params.get('view') : ''
  const [stations, setStations] = useState([])
  useEffect(() => { fetch('/api/stations').then((r) => (r.ok ? r.json() : { stations: [] })).then((d) => setStations(d.stations || [])).catch(() => {}) }, [])
  const set = (patch) => { const next = new URLSearchParams(params); Object.entries(patch).forEach(([k, val]) => (val ? next.set(k, val) : next.delete(k))); setParams(next, { replace: false }) }
  // A shared station/viewer link lands on the viewer, not the page top.
  useEffect(() => { if (params.get('station') || params.get('viewer') || params.get('view')) setTimeout(() => document.getElementById('viewers')?.scrollIntoView({ block: 'start' }), 120) }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Tabs value={viewer} onValueChange={(v) => set({ viewer: v === 'live' ? '' : v })}>
      <TabsList className="h-auto flex-wrap justify-start">
        {VIEWERS.map((v) => <TabsTrigger key={v.key} value={v.key}>{v.tab}</TabsTrigger>)}
      </TabsList>
      {(viewer === 'live' || viewer === 'app') && (
        <div className="mt-3 flex flex-wrap items-end gap-3 text-sm" data-testid="station-picker">
          <label className="flex flex-col gap-1"><span className="font-mono text-[10.5px] uppercase tracking-wider text-subtle">Station</span>
            <select value={station} onChange={(e) => set({ station: e.target.value })} className="h-9 rounded-md border border-border bg-canvas px-2 text-sm">
              <option value="">All stations</option>
              {['hawaii', 'maui', 'molokai', 'lanai', 'oahu', 'kauai'].map((isl) => { const rows = stations.filter((s) => s.island === isl && s.status !== 'planned'); return rows.length ? <optgroup key={isl} label={{ hawaii: 'Hawaiʻi Island', maui: 'Maui', molokai: 'Molokaʻi', lanai: 'Lānaʻi', oahu: 'Oʻahu', kauai: 'Kauaʻi' }[isl]}>{rows.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}</optgroup> : null })}
            </select></label>
          {viewer === 'live' && <label className="flex flex-col gap-1"><span className="font-mono text-[10.5px] uppercase tracking-wider text-subtle">View</span>
            <select value={view || 'dashboard'} onChange={(e) => set({ view: e.target.value === 'dashboard' ? '' : e.target.value })} className="h-9 rounded-md border border-border bg-canvas px-2 text-sm">{VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
          <span className="pb-2 text-xs text-subtle">This choice is in the address bar — copy the link to share it.</span>
        </div>
      )}
      {VIEWERS.map((v) => (
        <TabsContent key={v.key} value={v.key} className="mt-3">
          <p className="mb-3 max-w-3xl text-sm text-subtle">{v.blurb} <ExternalLink href={v.key === 'live' && (station || view) ? `${HCDP}/hawaii-mesonet-data/#/${view || 'dashboard'}${station ? `?id=${station}` : ''}` : v.page}>Open it full screen</ExternalLink></p>
          {viewer === v.key && <EmbedFrame key={viewerSrc(v, station, view)} src={viewerSrc(v, station, view)} title={v.title} fallbackHref={v.page} fallbackLabel={`open ${v.title}`} />}
        </TabsContent>
      ))}
    </Tabs>
  )
}

const MEASUREMENTS = [
  'Rainfall', 'Air temperature', 'Relative humidity', 'Wind speed and direction', 'Air pressure', 'Solar radiation',
  'Reflected solar radiation', 'Incoming and outgoing longwave radiation', 'Net radiation', 'Soil heat conduction',
  'Soil temperature at three depths', 'Soil moisture at three depths',
]

const USES = [
  'Weather forecasting', 'Flood warning', 'Fire warning', 'Emergency management', 'Water resource management', 'Agriculture',
  'Ranching', 'Cultural resource protection', 'Ecosystem protection', 'Recreation', 'Research on weather, climate, hydrological and ecosystem processes',
]

const STATS = [
  { value: '~100', label: 'telemetered stations in the planned network' },
  { value: '75', label: 'stations active (September 2026)' },
  { value: '5 min', label: 'averages and statistics recorded' },
  { value: '15 min', label: 'every station transmits its data' },
]

export default function Mesonet() {
  return (
    <PageShell
      title="Hawaiʻi Mesonet"
      icon={RadioTower}
      source={MESONET_PAGE}
      lead={<p>A statewide advanced weather and climate monitoring network of approximately 100 telemetered stations, now under construction.</p>}
      actions={(
        <>
          <Button asChild size="lg">
            <a href={LIVE_DATA_PAGE} target="_blank" rel="noopener noreferrer">Live Data Access<span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>
          </Button>
          <Button asChild variant="outline" size="lg"><Link to="/data/api"><Code2 className="h-4 w-4" aria-hidden="true" />Mesonet data by API</Link></Button>
        </>
      )}
      related={sectionRelated('/mesonet')}
    >
      <div>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="The network in numbers">
          {STATS.map((s) => (
            <li key={s.label} className="rounded-lg border border-border bg-card p-3">
              <span className="block font-display text-2xl">{s.value}</span>
              <span className="block text-xs text-subtle">{s.label}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-subtle">Sources: the portal's Hawaiʻi Mesonet page; active-station count from <ExternalLink href="https://www.hawaii.edu/news/2026/09/09/hurricane-lowell-tracker-website/">UH News, 9 September 2026</ExternalLink>.</p>
      </div>

      <Section id="viewers" title="Live viewers" lead={<p>Three ways to watch the network live. Only the open tab loads.</p>}>
        <ViewerTabs />
        <p className="mt-3 text-xs text-subtle">American Samoa has its own Mesonet: <ExternalLink href={`${HCDP}/hawaii-mesonet-data/#/american-samoa`}>American Samoa Mesonet Live Data Viewer</ExternalLink> (see <Link className="underline" to="/pacific">Pacific Portal</Link>).</p>
      </Section>

      <Section id="why" title="What is the Hawaiʻi Mesonet and why is it needed?">
        <Prose>
          <p>Hawaiʻi is one of only 20 states that had no statewide mesonet until now. Climate information has been gathered in the islands for over 100 years by various entities, but the observing network is fragmented, unmanaged, shrinking in spatial coverage and inadequate for the researchers and the many stakeholders who depend on the data and the research it supports.</p>
          <p>Until recent decades, the mainstay of the network was stations run by the sugarcane and pineapple industries. As large-scale agriculture contracted and ended, many of those stations were discontinued.</p>
          <p className="text-sm text-subtle">Background: <ExternalLink href="https://www.hawaii.edu/news/2021/10/10/hawaii-mesonet-project/">The Hawaiʻi Mesonet (UH News)</ExternalLink></p>
        </Prose>
      </Section>

      <Section id="density" title="Do we need so many stations?">
        <Prose>
          <p>Temperature, rainfall, cloud cover, solar radiation, wind, humidity and other variables vary enormously across the islands, driven by complex topography, varied wind patterns and a persistent inversion layer known as the trade wind inversion (TWI). Average rainfall ranges from 8 to 400 inches a year.</p>
          <p>Rainfall gradients here are among the steepest on Earth: in West Maui, average annual rainfall differs by more than 140 inches over a distance of 1 mile. Monitoring weather and climate properly takes a dense, well-distributed network of stations.</p>
          <p className="text-sm text-subtle">One of the new stations: Kīlauea, Kauaʻi, installed December 1, 2022.</p>
        </Prose>
      </Section>

      <Section id="measurements" title="What does each station measure?">
        <Prose>
          <p>Each station measures the full array of variables needed for weather forecasting, emergency management, water resource management, agriculture and many other applications. Every sensor is scanned every 4 seconds; averages and other statistics are recorded every 5 minutes, and every station transmits its data every 15 minutes, giving real-time information from across the state.</p>
        </Prose>
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Measurements">
          {MEASUREMENTS.map((m) => <li key={m}><Badge variant="outline" className="font-normal">{m}</Badge></li>)}
        </ul>
      </Section>

      <Section id="uses" title="Who needs the data?">
        <p className="max-w-3xl text-base">Hawaiʻi Mesonet data serve a wide range of uses, including:</p>
        <ul className="mt-3 grid max-w-3xl gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {USES.map((u) => <li key={u} className="flex gap-2"><span aria-hidden="true" className="text-accent">•</span>{u}</li>)}
        </ul>
      </Section>

      <Section id="funding" title="Who pays for it?">
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-4">
            <h3 className="font-display text-lg">Building it</h3>
            <p className="mt-1 text-sm text-subtle">More than $1.5M for equipment came mainly from the National Science Foundation, with additional funds from the Hawaiʻi Commission on Water Resources Management and the Honolulu Board of Water Supply. Installation costs are supported by the Water Resources Research Center and the Office of the Vice Provost for Research and Scholarship at the University of Hawaiʻi at Mānoa.</p>
          </Card>
          <Card className="p-4">
            <h3 className="font-display text-lg">Keeping it running for decades</h3>
            <p className="mt-1 text-sm text-subtle">Operating and maintaining the network and managing and publishing its data is estimated at around $600K a year. Around 40–50% of that is expected from the National Mesonet program; the rest has to come from state, county and private sources.</p>
          </Card>
        </div>
        <Card className="mt-4 flex items-start gap-3 p-4">
          <PlayCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <p className="text-sm">Video: <ExternalLink href="https://www.youtube.com/watch?v=umIhmY-gCO0">$1.33M grant to better understand, forecast Hawaiʻi's complex weather and climate</ExternalLink></p>
        </Card>
      </Section>

      <Section id="code" title="Mesonet data by code">
        <Card className="flex items-start gap-3 p-4">
          <Globe2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <p className="text-sm">The Hawaiʻi Mesonet API serves station measurements, station and variable lists, a station monitor and emailed CSV exports. Request a token and see the endpoints on the <Link className="font-medium text-accent underline-offset-2 hover:underline" to="/data/api">HCDP / Hawaiʻi Mesonet API</Link> page.</p>
        </Card>
      </Section>
    </PageShell>
  )
}
