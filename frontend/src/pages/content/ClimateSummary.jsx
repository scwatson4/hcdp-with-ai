import { Link, useSearchParams } from 'react-router-dom'
import { CalendarDays, CloudRain, Thermometer, Sun, Mail, MapPin, BarChart3, FileText, RadioTower } from 'lucide-react'
import { HCDP } from '../../site/nav'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageShell, Section, Prose, FactList } from './PageShell'
import ExternalLink from './ExternalLink'
import EmbedFrame from './EmbedFrame'
import { sectionRelated } from './contentUtils'

// Hawaiʻi Monthly Climate Summary — the portal page
// https://www.hawaii.edu/climate-data-portal/climate-summary/ frames the app at
// https://cherryleh.github.io/climate-summary/ (its dashboard, How-To Guide,
// the 2025 annual report and the storm pages). Wording from the app.

const SUMMARY_PAGE = `${HCDP}/climate-summary/`
const SUMMARY_APP = 'https://cherryleh.github.io/climate-summary/#/'
// The portal page passes its #hash through to the app, so these deep links work.
const page = (route) => `${SUMMARY_PAGE}#/${route}`

// The month lives in the URL: /climate-summary?year=2026&month=8 (the app reads #/?year=&month=)
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
function MonthPicker() {
  const [params, setParams] = useSearchParams()
  const year = /^\d{4}$/.test(params.get('year') || '') ? params.get('year') : ''
  const month = /^(1[0-2]|[1-9])$/.test(params.get('month') || '') ? params.get('month') : ''
  const src = year && month ? `${SUMMARY_APP}?year=${year}&month=${month}` : SUMMARY_APP
  const set = (patch) => { const next = new URLSearchParams(params); Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k))); setParams(next) }
  const years = []; for (let y = 2026; y >= 2020; y -= 1) years.push(String(y))
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3 text-sm" data-testid="month-picker">
        <label className="flex flex-col gap-1"><span className="font-mono text-[10.5px] uppercase tracking-wider text-subtle">Month</span>
          <select value={month} onChange={(e) => set({ month: e.target.value, year: year || '2026' })} className="h-9 rounded-md border border-border bg-canvas px-2 text-sm"><option value="">Latest</option>{MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className="font-mono text-[10.5px] uppercase tracking-wider text-subtle">Year</span>
          <select value={year} onChange={(e) => set({ year: e.target.value, month: month || '8' })} className="h-9 rounded-md border border-border bg-canvas px-2 text-sm"><option value="">Latest</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <span className="pb-2 text-xs text-subtle">The month is in the address bar — copy the link to share it.</span>
      </div>
      <EmbedFrame key={src} src={src} title="Hawaiʻi Monthly Climate Summary" fallbackHref={year && month ? `${SUMMARY_PAGE}#/?year=${year}&month=${month}` : SUMMARY_PAGE} fallbackLabel="open the Monthly Climate Summary" deferred={!(year && month)} />
    </>
  )
}

const DATASETS = [
  { icon: CloudRain, name: 'Rainfall', text: 'Monthly precipitation totals and anomalies compared to the long-term average: how wet or dry a period was relative to history.' },
  { icon: Thermometer, name: 'Temperature', text: 'Average monthly temperature, the anomaly from normal, and the highest recorded temperature for the period.' },
  { icon: Sun, name: 'Drought', text: 'U.S. Drought Monitor categories derived from the 3-month Standardized Precipitation Index (SPI-3), which compares rainfall over the past three months with the historical distribution for that period.' },
]

const DIVISIONS = [
  ['Moku', 'Traditional Hawaiian land districts: large regional sections of each island.'],
  ['Ahupuaʻa', 'Traditional land divisions running from mountain to sea: the finest geographic resolution available.'],
  ['Climate', 'NOAA climate divisions: the standard regions used for official long-term climate records.'],
  ['Watershed', 'Hydrological catchment areas: useful for understanding water resource patterns.'],
]

const STATS = [
  ['Observed average', 'The measured value for the selected month and area, in inches of rain or degrees Fahrenheit, computed from station data within the region.'],
  ['Anomaly', 'How far the observed value is from the long-term average (normal) for the same month. Positive means wetter or warmer than normal, negative drier or cooler; the percentage (e.g. +23%) expresses the departure as a share of normal.'],
  ['Rank', 'Where this month falls in the historical record, e.g. “2nd Wettest out of 30 years”. Rank 1 is the most extreme: wettest, driest, warmest or coolest, depending on context. Click any stat box for the full ranked table of all years on record.'],
  ['Year-to-date % of normal', 'Rainfall only: rainfall from January through the selected month as a percentage of the normal year-to-date total. Above 100% means above-normal accumulation so far this year.'],
  ['Max temp', 'Temperature only: the highest average daily maximum temperature recorded in the region during the month.'],
]

const DROUGHT = [
  ['—', 'Near Normal', 'No significant dryness or wetness detected.'],
  ['D0', 'Abnormally Dry', 'Short-term dryness slowing crop growth or fire risk increasing; not yet drought.'],
  ['D1', 'Moderate Drought', 'Some crop damage; streams and wells below normal; voluntary water use restrictions possible.'],
  ['D2', 'Severe Drought', 'Crop or pasture losses; water shortages common; water restrictions likely.'],
  ['D3', 'Extreme Drought', 'Major crop and pasture losses; widespread water shortages or restrictions.'],
  ['D4', 'Exceptional Drought', 'Exceptional and widespread crop and pasture losses; water emergencies in multiple sectors.'],
  ['W0', 'Abnormally Wet', 'Short-term wetness above normal; flooding possible in low-lying areas.'],
  ['W1–W4', 'Moderate–Exceptional Wetness', 'Progressively wetter conditions with increased flooding, runoff and saturated soils.'],
]

const REPORTS = [
  { title: '2025 Hawaiʻi Annual Climate Report', links: [['Read the report', page('climate-summary-2025')]], when: 'Annual, 2025', text: 'A statewide summary of rainfall, drought, temperature and extremes across Hawaiʻi in 2025. With 42 inches of rain, 2025 was the second driest statewide year on record since 1920 (after 2010), against a 30-year average of 62 inches; statewide average temperature ranked 6th warmest in the last 35 years.' },
  { title: 'Hurricane Lowell', links: [['Read the report', `${HCDP}/hurricane-lowell/`]], when: 'September 2026', text: 'Hour-by-hour wind maps, daily rainfall maps, coastal impacts and a Mesonet storm replay.', internal: '/extreme-events#lowell' },
  { title: 'Hurricane Lala', links: [['Read the report', `${HCDP}/hurricane-lala/`]], when: 'August 2026', text: 'Daily and cumulative rainfall and wind maps with station data, by county and by day.', internal: '/extreme-events#lala' },
  { title: 'Kona Low Storms (#1 and #2)', links: [['Storm #1 report', `${HCDP}/2026-kona-low-1/`], ['Storm #2 report', `${HCDP}/2026-kona-low-2/`]], when: 'March 2026', text: 'Storm viewers for 10–16 and 17–23 March 2026, with daily and cumulative rainfall.', internal: '/extreme-events#kona-lows' },
]

const TRACKERS = [
  { title: 'Tropical Storm Nolo Viewer', href: `${HCDP}/nolo-mesonet-viewer/`, badge: 'live', text: 'Rainfall accumulation and maximum wind and gust speeds at Hawaiʻi Mesonet stations from 22 September 2026, 10:00 PM HST, updated every 15 minutes; plus an hour-by-hour storm-evolution map.', internal: '/extreme-events#nolo' },
  { title: 'Hurricane Lowell Viewer', href: `${HCDP}/hurricane-lowell-viewer/`, badge: 'tracker', text: 'Rainfall accumulation and maximum wind and gust speeds at Hawaiʻi Mesonet stations from 7 September 2026, 12:00 AM HST, updated every 15 minutes, with a Kauaʻi and Oʻahu focus page.', internal: '/extreme-events#lowell' },
  { title: 'Hurricane Lala', href: `${HCDP}/hurricane-lala/`, badge: 'event maps', text: 'Interactive rainfall and wind maps and Mesonet station data for 14–16 August 2026, sortable by county and by day of the storm.', internal: '/extreme-events#lala' },
]

const SUPPORTERS = [
  ['Hawaiʻi Climate Data Portal', 'https://www.hawaii.edu/climate-data-portal/'],
  ['Hawaiʻi Mesonet', 'https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/'],
  ['Pacific Drought Knowledge Exchange', 'https://pdke.soest.hawaii.edu/'],
  ['Pacific Islands Climate Adaptation Science Center', 'https://pi-casc.soest.hawaii.edu/'],
  ['Hawaiʻi Sea Grant', 'https://seagrant.soest.hawaii.edu/'],
  ['University of Hawaiʻi', 'https://www.hawaii.edu/'],
  ['Commission on Water Resource Management', 'https://dlnr.hawaii.gov/cwrm/'],
  ['NIDIS (drought.gov)', 'https://www.drought.gov/'],
  ['Hawaiʻi Data Science Institute', 'https://datascience.hawaii.edu/'],
  ['Change HI', 'https://hawaii.edu/epscor/change-hi/'],
]

export default function ClimateSummary() {
  return (
    <PageShell
      title="Monthly Climate Summary"
      icon={CalendarDays}
      source={SUMMARY_PAGE}
      lead={<p>The Hawaiʻi Monthly Climate Summary (beta) lets you explore rainfall, temperature and drought across the Hawaiian Islands by month, year, island and geographic division, and sends a monthly report by email.</p>}
      actions={(
        <>
          <Button asChild size="lg">
            <a href={SUMMARY_PAGE} target="_blank" rel="noopener noreferrer">Open the Monthly Climate Summary<span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>
          </Button>
          <Button asChild variant="outline" size="lg">
            <a href={page('tutorial')} target="_blank" rel="noopener noreferrer">How-To Guide<span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>
          </Button>
        </>
      )}
      related={sectionRelated('/climate-summary')}
    >
      <Section id="what" title="What the summary shows">
        <Prose>
          <p>Pick a month and year (or <span className="font-medium">Latest</span> for the most recent data), a dataset and a place. The climate snapshot and the charts update for that area; the historical chart shows every year on record for the selected month, and data availability varies by dataset.</p>
        </Prose>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {DATASETS.map((d) => (
            <Card key={d.name} className="p-4">
              <div className="mb-1 flex items-center gap-2"><d.icon className="h-4 w-4 text-accent" aria-hidden="true" /><h3 className="font-display text-lg">{d.name}</h3></div>
              <p className="text-sm text-subtle">{d.text}</p>
            </Card>
          ))}
        </div>
        <div className="mt-5">
          <h3 className="flex items-center gap-2 font-display text-lg"><MapPin className="h-4 w-4 text-accent" aria-hidden="true" />Places</h3>
          <p className="mt-1 max-w-3xl text-sm text-subtle">Statewide, one island, or a division of an island. Division types:</p>
          <FactList className="mt-2" items={DIVISIONS} />
        </div>
      </Section>

      <Section id="ranks" title="How the numbers and ranks work">
        <FactList items={STATS} />
        <div className="mt-6">
          <h3 className="flex items-center gap-2 font-display text-lg"><BarChart3 className="h-4 w-4 text-accent" aria-hidden="true" />Drought categories</h3>
          <p className="mt-1 max-w-3xl text-sm text-subtle">The drought statistics give the share of the selected area in each U.S. Drought Monitor category, derived from SPI-3: negative values mean dryness, positive values wetness. Categories are cumulative, so “D1 or worse” includes all area in D1, D2, D3 and D4.</p>
          <div className="relative mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-subtle">
                <tr><th scope="col" className="px-3 py-2 font-medium">Category</th><th scope="col" className="px-3 py-2 font-medium">Label</th><th scope="col" className="px-3 py-2 font-medium">What it means</th></tr>
              </thead>
              <tbody>
                {DROUGHT.map(([c, label, meaning]) => (
                  <tr key={c} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-mono text-xs">{c}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{label}</td>
                    <td className="px-3 py-2 text-subtle">{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <Section id="email" title="Monthly email reports">
        <Card className="flex items-start gap-3 p-4">
          <Mail className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <div className="text-sm">
            <p>Select an area on the map (or leave it statewide), enter your email and subscribe; resubmit to add more areas. Subscribing to a division also includes reports for its island and for statewide. Reports arrive around the 1st of each month; unsubscribe anytime.</p>
            <p className="mt-2"><ExternalLink href={SUMMARY_PAGE}>Subscribe on the portal</ExternalLink> · <ExternalLink href={page('manage-preferences')}>Manage preferences</ExternalLink></p>
          </div>
        </Card>
      </Section>

      <Section id="reports" title="Latest reports">
        <ul className="grid gap-3 md:grid-cols-2">
          {REPORTS.map((r) => (
            <li key={r.title}>
              <Card className="flex h-full flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-lg leading-tight">{r.title}</h3>
                  <Badge variant="muted" className="shrink-0">{r.when}</Badge>
                </div>
                <p className="mt-2 text-sm text-subtle">{r.text}</p>
                <p className="mt-auto flex flex-wrap gap-x-3 pt-3 text-sm">
                  {r.links.map(([label, href]) => <ExternalLink key={href} href={href} className="font-medium">{label}</ExternalLink>)}
                  {r.internal && <Link to={r.internal} className="text-subtle underline-offset-2 hover:underline">On this site</Link>}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="trackers" title="Storm trackers" lead={<p>Built on the same app, from Hawaiʻi Mesonet stations.</p>}>
        <ul className="space-y-3">
          {TRACKERS.map((t) => (
            <li key={t.title}>
              <Card className="flex items-start gap-3 p-4">
                <RadioTower className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                <div className="min-w-0 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="font-display text-lg leading-tight">{t.title}</h3><Badge variant="soft">{t.badge}</Badge></div>
                  <p className="mt-1 text-subtle">{t.text}</p>
                  <p className="mt-2 flex flex-wrap gap-x-3"><ExternalLink href={t.href} className="font-medium">Open on the portal</ExternalLink><Link to={t.internal} className="text-subtle underline-offset-2 hover:underline">Event details on this site</Link></p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="dashboard" title="The dashboard" lead={<p>The summary itself, embedded from the portal.</p>}>
        <MonthPicker />
      </Section>

      <Section id="supported" title="Supported by">
        <ul className="flex flex-wrap gap-2 text-sm">
          {SUPPORTERS.map(([name, href]) => (
            <li key={name}><ExternalLink href={href} plain className="inline-block rounded-full border border-border px-3 py-1 hover:border-foreground">{name}</ExternalLink></li>
          ))}
        </ul>
        <p className="mt-3 flex items-start gap-2 text-xs text-subtle"><FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />As the 2025 report notes, its data come from gridded climate products built from station measurements across Hawaiʻi with statistical and interpolation methods, and each product carries uncertainty that the summary statistics do not quantify. The products and their metadata are on <Link className="underline" to="/data">Access Data</Link>; citations are on <Link className="underline" to="/about/how-to-cite">How to Cite</Link>.</p>
      </Section>
    </PageShell>
  )
}
