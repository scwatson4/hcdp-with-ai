import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CloudLightning, CalendarDays, MapPin, ArrowRight } from 'lucide-react'
import { formatViewerPath, describeViewer } from '../../viewer/urlGrammar'
import { HCDP } from '../../site/nav'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageShell, Section, Prose } from './PageShell'
import ExternalLink from './ExternalLink'
import { sectionRelated, dayRange, yesterday, formatDate } from './contentUtils'

// Extreme Events — https://www.hawaii.edu/climate-data-portal/extreme-events/
// Event identity and dates: backend/data/extreme_events.json (v2, as of
// 2026-09-17) for Lala, the March 2026 Kona storms and Lowell; Nolo from its
// tracker page and UH News (24 Sept 2026). Descriptions and numbers from the
// HCDP event pages (cherryleh.github.io/climate-summary) and the UH News
// articles linked in each section. Peak days: the heaviest day named by the
// sources, or, for the Kona storms, the day with the highest statewide average
// in the HCDP storm viewers' daily statistics.

const rain = (date, extent) => ({ dataset: 'rainfall', period: 'day', date, extent })

const NOLO_START = '2026-09-23' // first full day after the tracker window opened (22 Sept, 10 PM HST)

const EVENTS = [
  {
    id: 'nolo',
    name: 'Tropical Storm Nolo',
    kind: 'Live tracker',
    when: 'From 22 September 2026, 10:00 PM HST',
    islands: ['Hawaiʻi Island (forecast focus)', 'Stations statewide'],
    summary: [
      'As Tropical Storm Nolo approached, forecast to bring heavy, potentially flood-causing rain and high winds, especially to Hawaiʻi Island, the Hawaiʻi Mesonet–HCDP team launched a tracker of the rain and wind observed at Hawaiʻi Mesonet stations across the state.',
      'It shows rainfall accumulation and maximum wind and gust speeds for the period starting 22 September, 10:00 PM HST, updated every 15 minutes, in two tools: current storm conditions (storm-total rainfall or maximum gust at each station, with charts for any station you pick) and storm evolution (an animated map of 1-hour rainfall or maximum hourly gust).',
    ],
    links: [
      { label: 'Tropical Storm Nolo Mesonet Viewer', href: `${HCDP}/nolo-mesonet-viewer/`, tag: 'Tracker' },
      { label: 'UH launches Tropical Storm Nolo rainfall, wind tracker', href: 'https://www.hawaii.edu/news/2026/09/24/tropical-storm-nolo/', tag: 'UH News · 24 Sept 2026' },
    ],
  },
  {
    id: 'lowell',
    name: 'Hurricane Lowell',
    kind: 'Hurricane report',
    when: '6–8 September 2026',
    islands: ['Kauaʻi', 'Niʻihau', 'Oʻahu (6 September)'],
    summary: [
      'Hurricane Lowell passed close by Niʻihau and Kauaʻi as a Category 2 storm from the afternoon of 7 September into the morning of 8 September. Its centre never touched land: it passed about 40 miles west of Niʻihau late on the 7th, after peaking as a Category 5 far out at sea. It brought damaging winds, heavy rain and dangerous surf.',
      'The rain arrived a day ahead of the wind. On 6 September, 5 inches or more on Oʻahu\'s Koʻolau Ridge sent flood waters down Waikāne and Waiāhole valleys and closed Kamehameha Highway.',
    ],
    facts: [
      'Mount Waiʻaleʻale: just over 23 inches on 7 September, almost 36 inches over the three days.',
      'Lower Limahuli, near Hāʻena: more than 17 inches over the three days, the most of any Hawaiʻi Mesonet station; Waipā more than 14 inches.',
      'Līhuʻe Airport: 56 mph, the highest measured hourly average wind, late on 7 September; experimental models put winds over exposed ridges above 100 mph.',
      'Breaking waves of 20 to 30 feet on Kauaʻi\'s south- and west-facing shores.',
    ],
    links: [
      { label: 'Hurricane Lowell report', href: `${HCDP}/hurricane-lowell/`, tag: 'HCDP report · 7 Sept 2026' },
      { label: 'Hurricane Lowell Mesonet Viewer', href: `${HCDP}/hurricane-lowell-viewer/`, tag: 'Tracker · from 7 Sept, 12:00 AM HST' },
      { label: 'Hurricane Lowell brought 100+ mph winds, heavy rainfall to Kauaʻi, Niʻihau', href: 'https://www.hawaii.edu/news/2026/09/11/hurricane-lowell/', tag: 'UH News · 11 Sept 2026' },
      { label: 'UH launches real-time Hurricane Lowell weather tracker', href: 'https://www.hawaii.edu/news/2026/09/09/hurricane-lowell-tracker-website/', tag: 'UH News · 9 Sept 2026' },
    ],
    peak: { view: rain('2026-09-07', 'kauai'), why: 'The closest pass: almost all of Kauaʻi had more than 2 inches of rain that day.' },
    days: ['2026-09-06', '2026-09-07', '2026-09-08'],
  },
  {
    id: 'lala',
    name: 'Hurricane Lala',
    kind: 'Hurricane report',
    when: '14–16 August 2026',
    islands: ['Hawaiʻi Island (hardest hit)', 'Maui', 'Oʻahu', 'Kauaʻi'],
    summary: [
      'Hurricane Lala tracked just south of the islands, skirting the south side of Hawaiʻi Island as a Category 1 hurricane. It never made official landfall, but brought torrential rain, damaging winds and widespread flooding: one of the state\'s most significant tropical-cyclone impacts in decades.',
      'Hawaiʻi Island took the brunt on 15 August, including devastating flash flooding in Nāʻālehu; the other counties had their heaviest rain a day later, on 16 August.',
    ],
    facts: [
      'About 1.3 trillion gallons of rain statewide, an average of 11.4 inches; Hawaiʻi County received 66% of the volume.',
      'Laupāhoehoe station, Hāmākua: 32.1 inches on 15 August.',
      'Kaiholena station, upslope of Nāʻālehu: 24.4 inches, including 4.4 inches in one hour (7:30 to 8:30 p.m.), the highest hourly rate observed in the state during the event.',
      'Storm totals exceeded 45 inches in spots.',
      'Gusts of 80 mph at Puʻuloa in Kohala and up to 79 mph on Haleakalā.',
    ],
    links: [
      { label: 'Hurricane Lala report', href: `${HCDP}/hurricane-lala/`, tag: 'HCDP report' },
      { label: 'Hurricane Lala douses Hawaiʻi with 1.9M Olympic-size pools of water', href: 'https://www.hawaii.edu/news/2026/08/20/hurricane-lala/', tag: 'UH News · 20 Aug 2026' },
      { label: 'Hurricane Lala Advisory Archive', href: 'https://www.nhc.noaa.gov/archive/2026/LALA.shtml', tag: 'NOAA National Hurricane Center' },
    ],
    peak: { view: rain('2026-08-15', 'hawaii'), why: 'Hawaiʻi Island\'s heaviest day: 32.1 inches at Laupāhoehoe.' },
    days: ['2026-08-14', '2026-08-15', '2026-08-16'],
  },
  {
    id: 'kona-lows',
    name: 'Kona Low Storms',
    kind: 'Two storm reports',
    when: '10–23 March 2026',
    islands: ['Maui', 'Hawaiʻi Island', 'Oʻahu', 'Molokaʻi', 'Kauaʻi', 'Lānaʻi'],
    summary: [
      'Two Kona lows hit back to back. More than 2 trillion gallons of rain fell on Hawaiʻi in March; 14-day totals reached as high as 3,000% of normal, and from 1 to 23 March statewide rainfall averaged 18.25 inches, more than 2.6 times the March average of 6.85 inches.',
    ],
    storms: [
      {
        name: 'Kona Low Storm (#1)',
        when: '10–16 March 2026',
        text: 'An intense Kona low developed northwest of the islands, drawing heavy tropical moisture north for days of severe rain and thunderstorms, with widespread destruction and major disruption to power and utility networks. Maui was hit hardest.',
        facts: [
          'Up to 62 inches of rain on the eastern flank of Haleakalā; the Kuiki station recorded a storm total of 53.05 inches.',
          'Haleakalā Summit station: 33.2 inches in the 24 hours from 8:30 a.m. on 13 March, nearly double its previous 24-hour record and above NOAA\'s 1000-year estimate of 19.7 inches.',
          'Kuiki: 36.42 inches in the 24 hours from 6:00 p.m. on 13 March, above NOAA\'s 1000-year estimate of 28.5 inches.',
          'Kaiāulu Puʻuwaʻawaʻa station, Hawaiʻi Island, 14 March: a 135.4 mph gust at 4:20 a.m. and a 105 mph average from 4:10 to 4:25 a.m.',
        ],
        report: { label: 'Kona Low Storm (#1) report', href: `${HCDP}/2026-kona-low-1/` },
        peak: { view: rain('2026-03-14', 'maui'), why: 'The storm viewer\'s heaviest day: statewide average 6.6 inches, Maui County maximum 37.2 inches.' },
      },
      {
        name: 'Kona Low Storm (#2)',
        when: '17–23 March 2026',
        text: 'A second Kona storm pulled more tropical moisture over the state shortly after the first. On ground already saturated, its downpours triggered severe flooding across eastern and central Molokaʻi, West Maui and Oʻahu, compounding the disaster and complicating relief efforts.',
        facts: [
          'Up to 61 inches of rain in localized areas.',
          'Kaʻala station, Oʻahu: about 22 inches in two days, including 19.67 inches in the 24 hours from the evening of 19 March; Waialua and Haleʻiwa on the north shore were inundated.',
          '23 March: a “rain bomb” over Mānoa and Pālolo valleys dropped 2 to 4 inches an hour; six Mesonet stations in the Nuʻuanu–Mānoa area recorded 3.5 to 6.5 inches, mostly within three hours.',
        ],
        report: { label: 'Kona Low Storm (#2) report', href: `${HCDP}/2026-kona-low-2/` },
        peak: { view: rain('2026-03-20', 'oahu'), why: 'The storm viewer\'s heaviest day: Honolulu County average 6.5 inches, maximum 13.1 inches.' },
      },
    ],
    links: [
      { label: 'Kona Low Storm (#1) report', href: `${HCDP}/2026-kona-low-1/`, tag: 'HCDP storm viewer · 10–16 March' },
      { label: 'Kona Low Storm (#2) report', href: `${HCDP}/2026-kona-low-2/`, tag: 'HCDP storm viewer · 17–23 March' },
      { label: 'Hawaiʻi Mesonet captures 135 mph winds, extreme rainfall during storm', href: 'https://www.hawaii.edu/news/2026/03/19/hawaii-mesonet-storm-data/', tag: 'UH News · 19 Mar 2026' },
      { label: '2 trillion gallons of water trigger historic flooding in Hawaiʻi', href: 'https://www.hawaii.edu/news/2026/03/31/hawaii-mesonet-flooding-data/', tag: 'UH News · 31 Mar 2026' },
    ],
    month: { dataset: 'rainfall', period: 'month', date: '2026-03', extent: 'statewide' },
  },
]

function Facts({ items }) {
  if (!items?.length) return null
  return (
    <ul className="mt-3 max-w-3xl space-y-1.5 text-sm">
      {items.map((f) => <li key={f} className="flex gap-2"><span aria-hidden="true" className="mt-0.5 text-accent">•</span><span>{f}</span></li>)}
    </ul>
  )
}

function OfficialLinks({ links }) {
  return (
    <Card className="p-4">
      <h3 className="font-display text-lg">Official links</h3>
      <ul className="mt-2 space-y-2 text-sm">
        {links.map((l) => (
          <li key={l.href}>
            <ExternalLink href={l.href} className="font-medium">{l.label}</ExternalLink>
            <span className="block text-xs text-subtle">{l.tag}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function PeakLink({ peak, label }) {
  const path = formatViewerPath(peak.view)
  return (
    <div>
      <Button asChild size="sm" className="h-auto whitespace-normal py-1.5 text-left">
        <Link to={path}>{label || describeViewer(peak.view)}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
      </Button>
      <p className="mt-1 text-xs text-subtle">{peak.why}</p>
    </div>
  )
}

function DayChips({ days, extent, label }) {
  return (
    <div className="mt-3">
      <p className="text-xs text-subtle">{label}</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {days.map((d) => (
          <li key={d}>
            <Link to={formatViewerPath(rain(d, extent))} className="inline-block rounded-full border border-border px-2.5 py-0.5 text-xs hover:border-foreground" aria-label={`Open ${describeViewer(rain(d, extent))} in the climate viewer`}>{formatDate(d, { short: true })}</Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ViewerCard({ event, noloDays }) {
  return (
    <Card className="p-4">
      <h3 className="font-display text-lg">Open in the climate viewer</h3>
      <div className="mt-2 space-y-3">
        {event.id === 'nolo' && (
          noloDays.length > 0 ? (
            <>
              <p className="text-sm text-subtle">The storm is recent, so its peak day is not settled; daily rainfall maps appear once each day ends.</p>
              <DayChips days={noloDays} extent="hawaii" label="Daily rainfall, Hawaiʻi Island" />
              <DayChips days={noloDays} extent="statewide" label="Daily rainfall, statewide" />
            </>
          ) : (
            <p className="text-sm text-subtle">Daily rainfall maps appear here once the first full day of the storm has ended.</p>
          )
        )}
        {event.peak && <PeakLink peak={event.peak} />}
        {event.days && <DayChips days={event.days} extent="statewide" label="Each day of the event, statewide" />}
        {event.storms?.map((s) => <PeakLink key={s.name} peak={s.peak} label={`${s.name}: ${describeViewer(s.peak.view)}`} />)}
        {event.month && (
          <p className="text-sm"><Link to={formatViewerPath(event.month)} className="font-medium text-accent underline-offset-2 hover:underline">{describeViewer(event.month)}</Link><span className="text-subtle">: the whole month on one map</span></p>
        )}
      </div>
    </Card>
  )
}

export default function ExtremeEvents() {
  const noloDays = useMemo(() => dayRange(NOLO_START, yesterday(), 7), [])
  return (
    <PageShell
      title="Extreme Events"
      icon={CloudLightning}
      source={`${HCDP}/extreme-events/`}
      lead={<p>HCDP storm reports and live trackers, built from Hawaiʻi Mesonet observations and HCDP rainfall maps, newest first. The portal's Extreme Events page lists the Lowell, Lala and Kona Low reports; the Nolo tracker has its own page.</p>}
      related={sectionRelated('/extreme-events')}
    >
      <nav aria-label="Events" className="-mt-4 flex flex-wrap gap-2">
        {EVENTS.map((e) => (
          <Link key={e.id} to={{ hash: `#${e.id}` }} className="rounded-full border border-border bg-card px-3 py-1 text-sm hover:border-foreground">{e.name}</Link>
        ))}
      </nav>

      {EVENTS.map((e) => (
        <Section key={e.id} id={e.id} title={e.name}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="soft">{e.kind}</Badge>
            <Badge variant="outline"><CalendarDays className="h-3 w-3" aria-hidden="true" />{e.when}</Badge>
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-sm text-subtle"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>{e.islands.join(' · ')}</span></p>
          <Prose className="mt-3">{e.summary.map((p) => <p key={p}>{p}</p>)}</Prose>
          <Facts items={e.facts} />
          {e.storms && (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {e.storms.map((s) => (
                <Card key={s.name} className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-display text-lg">{s.name}</h3>
                    <span className="text-xs text-subtle">{s.when}</span>
                  </div>
                  <p className="mt-1 text-sm">{s.text}</p>
                  <Facts items={s.facts} />
                  <p className="mt-3 text-sm"><ExternalLink href={s.report.href} className="font-medium">{s.report.label}</ExternalLink></p>
                </Card>
              ))}
            </div>
          )}
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <OfficialLinks links={e.links} />
            <ViewerCard event={e} noloDays={noloDays} />
          </div>
        </Section>
      ))}
    </PageShell>
  )
}
