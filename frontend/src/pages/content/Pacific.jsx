import { Link } from 'react-router-dom'
import { Globe2, Map as MapIcon, Database, RadioTower, Library, Users, Waves, Code2 } from 'lucide-react'
import { HCDP } from '../../site/nav'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageShell, Section, Prose } from './PageShell'
import ExternalLink from './ExternalLink'
import { sectionRelated } from './contentUtils'

// Pacific Portal — https://www.hawaii.edu/climate-data-portal/pacific-portal/
// plus the American Samoa Climate Data Portal (americansamoaportal, as-about,
// as-live-climate-data) and the Guam Data Viewer (guam-data-viewer, which
// frames the GCDP app; its dataset list is in github.com/HCDP/gcdp).

const PACIFIC_PAGE = `${HCDP}/pacific-portal/`
const AS_PAGE = `${HCDP}/americansamoaportal/`
const GUAM_PAGE = `${HCDP}/guam-data-viewer/`

const AS_PORTALS = [
  { icon: MapIcon, title: 'Geospatial Portal', href: 'https://maps-asgis.opendata.arcgis.com/', text: 'American Samoa\'s geospatial data, including shapefiles and rasters of biological, geological, political and climate-related data.' },
  { icon: Database, title: 'Environmental Data Portal', href: 'https://americansamoa-data.sprep.org/', text: 'Publications, tabular data and climate-related resources for American Samoa.' },
  { icon: RadioTower, title: 'Real-Time Monitoring and Gridded Data Portal', href: `${HCDP}/as-live-climate-data/`, text: 'Real-time weather station and stream gauge data for American Samoa.' },
]

const AS_LIVE = [
  ['Real-time data', 'The ASCDP collects real-time weather data at 5 sites and streamflow data at 4 sites through the American Samoa Mesonet and hydrological monitoring network, served through the National Weather Service (MADIS), Synoptic and the American Samoa Mesonet Live Data Viewer.'],
  ['Gridded rainfall', 'Gridded rainfall data are available from 1980 to 2024: make a rainfall map and time series for any location, or download the data, with the American Samoa data visualization and download tool.'],
  ['Historical data', 'From stations in the field since 2015: 15-minute intervals before August 2022, 5-minute intervals at all climate stations since; stream gauges every 15 minutes. CSV files and data tables are available.'],
  ['Water use', 'Water use by village (industrial, commercial and residential) in an interactive dashboard, with downloadable tables.'],
]

const AS_TOOLS = [
  ['Coastal Resilience Evaluation & Siting Tool', 'An interactive display of the Regional Coastal Resilience Assessments.', 'https://resilientcoasts.org/#Home'],
  ['NOAA Sea Level Rise Viewer', 'A preliminary look at sea level rise and coastal flooding impacts.', 'https://coast.noaa.gov/slr/#/layer/sce/0/-18630253.16710345/-1515473.9587210258/7/satellite/none/0.8/2050/interHigh/midAccretion'],
  ['PacIOOS American Samoa Coral Reef Drivers', 'How environmental and human factors shape coral reef spatial patterns.', 'https://www.pacioos.hawaii.edu/projects/coral-drivers-amsam/#data'],
  ['SONEL', 'High-quality continuous measurements of sea and land levels at the coast from tide gauges.', 'https://www.sonel.org/spip.php?page=gps&idStation=631'],
  ['U.S. Drought Monitor (USDM)', 'Weekly drought maps for the U.S. and its territories.', 'https://droughtmonitor.unl.edu/CurrentMap/StateDroughtMonitor.aspx?USAPI'],
  ['NOAA Coral Reef Watch', 'The daily global 5 km satellite Bleaching Alert Area: where coral bleaching heat stress reaches certain levels.', 'https://coralreefwatch.noaa.gov/product/5km/index_5km_baa-max-7d.php'],
  ['GML Data Finder', 'Data files from the public archive of the ESRL Global Monitoring Laboratory.', 'https://gml.noaa.gov/dv/data/index.php?site=SMO'],
  ['PacIOOS American Samoa Sea Level Rise Viewer', 'A scientific prediction of potential future flooding due to sea level rise.', 'https://www.pacioos.hawaii.edu/shoreline/slr-amsam/'],
  ['Integrated Resource Management Applications (IRMA) Portal', 'Access to National Park Service applications.', 'https://irma.nps.gov/Portal/'],
  ['WACOP wave atlas', 'Many aspects of the wave climate in Samoa.', 'https://wacop.gsd.spc.int/WaveAtlas-Samoa.html'],
  ['Pacific Drought Knowledge Exchange (PDKE)', 'Drought knowledge exchange among drought stakeholders in Hawaiʻi and in Pacific Island nations.', 'https://www.soest.hawaii.edu/pdke/'],
  ['National Coral Reef Monitoring Program', 'See data collection info, visualize status and trends, and download data.', 'https://experience.arcgis.com/experience/0d933966e48c4246819b8ac8d8182574/'],
  ['USGS Hazard Exposure and Reporting Analytics (HERA)', 'Tools and data to help communities plan and prepare for climate-related natural hazards.', 'https://www.usgs.gov/apps/hera/'],
  ['University of Hawaiʻi Sea Level Center', 'A station explorer for tide gauge data.', 'https://uhslc.soest.hawaii.edu/stations/?stn=056#levels'],
  ['Tide forecast', 'High tide times and tide charts in American Samoa.', 'https://www.tide-forecast.com/countries/American-Samoa'],
  ['American Samoa Data Project', 'American Samoa coral reef monitoring programs, data collection methods and site-specific location data.', 'https://connect.fisheries.noaa.gov/american_samoa_data_integration/'],
]

const PACIFIC_DATA = [
  ['Pacific Climate Change Portal', 'Climate resources, news, events and more in the Pacific Islands region.', 'https://www.pacificclimatechange.net/'],
  ['Pacific Environment Portal', 'An easy way to find, access and reuse regional and national data.', 'https://pacific-data.sprep.org/'],
  ['PNW-FIA Pacific Islands Database', 'Resource inventories for islands in the Pacific.', 'https://www.fs.usda.gov/pnw/tools/pnw-fia-pacific-islands-database'],
  ['Pacific Regional Data Repository', 'A data and information revolution for the Pacific Island Countries and Territories (PICTs).', 'https://prdrse4all.spc.int/'],
  ['NIWA', 'Environmental science for the sustainable management of natural resources for New Zealand and the planet.', 'https://niwa.co.nz/'],
]

const REGIONAL_ORGS = [
  ['SPREP', 'Established by the governments and administrations of the Pacific to protect and manage the region\'s environment and natural resources.', 'https://www.sprep.org/'],
  ['Pacific Community (SPC)', 'The principal scientific and technical organisation in the Pacific region, supporting development since 1947.', 'https://www.spc.int/'],
  ['Australian Government Department of Foreign Affairs and Trade', 'Its page on Pacific Islands regional organisations.', 'https://www.dfat.gov.au/international-relations/regional-architecture/pacific-islands/pacific-islands-regional-organisation'],
  ['Pacific Islands Forum Fisheries Agency (FFA)', 'Helps its 17 members manage, control and develop their tuna fisheries.', 'https://www.ffa.int/about'],
  ['Pacific Tourism Organisation (SPTO)', 'Established in 1983 as the Tourism Council of the South Pacific; represents tourism in the region.', 'https://southpacificislands.travel/about/'],
  ['The University of the South Pacific', 'A public research university with locations throughout the South Pacific.', 'https://www.usp.ac.fj/'],
  ['Pacific Aviation Safety Office (PASO)', 'Aviation safety and security services for member states in the Pacific.', 'https://paso.aero/'],
  ['PPA', 'An inter-governmental agency and member of the Council of Regional Organizations in the Pacific (CROP), promoting direct cooperation of Pacific island power utilities in technical training and more.', 'https://www.ppa.org.fj/'],
  ['Pacific Islands Forum', 'Founded in 1971; the region\'s premier political and economic policy organization.', 'https://www.forumsec.org/'],
  ['PI-CASC', 'A partnership between the USGS and a university consortium hosted by UH Mānoa, with UH Hilo and the University of Guam, supporting sustainability and climate adaptation across the Pacific Islands.', 'https://pi-casc.soest.hawaii.edu/'],
  ['Pacific Islands Development Program', 'Housed at the East-West Center; works to enhance quality of life in the Pacific Islands and serves the Secretariat of the Pacific Islands Conference of Leaders (PICL).', 'https://pidp.eastwestcenter.org/'],
]

const COUNTRIES = [
  ['Guam', 'guam-draft'], ['Republic of the Marshall Islands', 'republic-of-marshall-islands'], ['Federated States of Micronesia', 'federated-states-of-micronesia'],
  ['Kiribati', 'kiribati'], ['Fiji', 'fiji'], ['Tonga', 'tonga'], ['Nauru', 'nauru'], ['Palau', 'palau'],
  ['Northern Mariana Islands', 'commonwealth-of-the-northern-mariana-islands'], ['Cook Islands', 'cook-islands'], ['Tokelau', 'tokelau'],
  ['Papua New Guinea', 'papua-new-guinea'], ['Solomon Islands', 'solomon-islands'], ['Vanuatu', 'vanuatu'], ['New Caledonia', 'new-caledonia-draft'],
  ['Tuvalu', 'tuvalu'], ['Samoa', 'samoa-draft'], ['American Samoa', 'american-samoa-draft'], ['Niue', 'niue-draft'], ['French Polynesia', 'french-polynesia'],
]

const TOOLS_RESOURCES = [
  ['Regional Documents', 'pacific-islands-regional-documents'],
  ['Country Specific Non-Governmental Organizations', 'pacific-portal-ngos'],
  ['Video Resources', 'video-resources'],
  ['Pacific Marine National Monuments Weather Stations', 'pacific-marine-national-monuments-weather-stations'],
]

function LinkList({ items, columns = 'md:grid-cols-2' }) {
  return (
    <ul className={`grid gap-2 ${columns}`}>
      {items.map(([name, text, href]) => (
        <li key={name} className="rounded-lg border border-border bg-card p-3">
          <ExternalLink href={href} className="font-medium">{name}</ExternalLink>
          <p className="mt-0.5 text-sm text-subtle">{text}</p>
        </li>
      ))}
    </ul>
  )
}

export default function Pacific() {
  return (
    <PageShell
      title="Pacific Portal"
      icon={Globe2}
      source={PACIFIC_PAGE}
      lead={<p>The HCDP serves the State of Hawaiʻi and parts of the Pacific. Its partner portals for American Samoa and Guam map and share climate data for those islands, and the Pacific Portal gathers regional data, organizations, country and territory pages, and tools.</p>}
      actions={(
        <>
          <Button asChild size="lg"><a href="#american-samoa">American Samoa</a></Button>
          <Button asChild variant="outline" size="lg"><a href="#guam">Guam</a></Button>
          <Button asChild variant="outline" size="lg"><a href="#pacific-portal">Pacific Portal</a></Button>
        </>
      )}
      related={sectionRelated('/pacific')}
    >
      <Section
        id="american-samoa"
        title="American Samoa Climate Data Portal"
        lead={<p>A partner project of the Hawaiʻi Climate Data Portal. <ExternalLink href={AS_PAGE}>Open the ASCDP</ExternalLink></p>}
      >
        <Prose>
          <p>American Samoa is highly vulnerable to the negative impacts of climate change, and many agencies there are working on it, but the data and information are hard to organize and present for people who need them and lack the time or expertise to synthesize them. The ASCDP's goal is to help climate adaptation and natural resource managers in American Samoa by giving open access to new and existing web-based tools for GIS and climate-related data, so managers and community members can collect, download and view the data they need.</p>
        </Prose>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {AS_PORTALS.map((p) => (
            <Card key={p.title} className="flex flex-col p-4">
              <p.icon className="mb-2 h-4 w-4 text-accent" aria-hidden="true" />
              <h3 className="font-display text-lg leading-tight">{p.title}</h3>
              <p className="mt-1 text-sm text-subtle">{p.text}</p>
              <div className="mt-auto pt-3"><ExternalLink href={p.href} className="text-sm font-medium">Open</ExternalLink></div>
            </Card>
          ))}
        </div>

        <h3 className="mt-8 font-display text-lg">Real-time monitoring and gridded data</h3>
        <dl className="mt-2 grid max-w-3xl gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          {AS_LIVE.map(([k, v]) => (
            <div key={k} className="contents"><dt className="font-medium">{k}</dt><dd className="text-subtle">{v}</dd></div>
          ))}
        </dl>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <ExternalLink href="https://hcdp.github.io/ascdp/">American Samoa Data Viewer and Download</ExternalLink>
          <ExternalLink href={`${HCDP}/hawaii-mesonet-data/#/american-samoa`}>American Samoa Mesonet Live Data Viewer</ExternalLink>
          <ExternalLink href={`${HCDP}/as-historical-climate-data/`}>Historical climate data</ExternalLink>
        </p>

        <h3 className="mt-8 font-display text-lg">Also on the ASCDP</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {[
            ['Top Climate Datasets', 'The ASCDP\'s list of top climate datasets for American Samoa.', `${HCDP}/american-samoa-explore-data/`],
            ['Future Climate Projections', 'Projections for American Samoa.', `${HCDP}/future-climate-projections/`],
            ['Coral Reef Advisory Group (CRAG) Library', 'Literature on coral reefs in American Samoa.', `${HCDP}/crag-coral-reef-advisory-group-library/`],
            ['About the ASCDP', 'Why the portal exists, its guide and its project partners.', `${HCDP}/as-about/`],
          ].map(([name, text, href]) => (
            <li key={name} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
              <Library className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              <div><ExternalLink href={href} className="font-medium">{name}</ExternalLink><p className="text-sm text-subtle">{text}</p></div>
            </li>
          ))}
        </ul>

        <details className="mt-6 rounded-lg border border-border bg-surface p-3">
          <summary className="cursor-pointer text-sm font-medium">Other American Samoa data tools ({AS_TOOLS.length})</summary>
          <div className="mt-3"><LinkList items={AS_TOOLS} /></div>
        </details>

        <p className="mt-4 flex items-start gap-2 text-sm text-subtle">
          <Users className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>The ASCDP is being developed by Dr. Chris Shuler, Aimee Schriber, Danielle Hall and the HCDP team, and is still under development. Feedback and questions: <a className="underline" href="mailto:cshuler@hawaii.edu">cshuler@hawaii.edu</a> or the <ExternalLink href="https://forms.gle/Puh1YKGYRa5RD5Gb9">feedback form</ExternalLink>.</span>
        </p>
      </Section>

      <Section id="guam" title="Guam Data Viewer" lead={<p>Guam's climate data viewer on the portal.</p>}>
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="soft">Daily rainfall</Badge>
            <Badge variant="outline">1980–2024</Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm">The Guam Climate Data Portal application disseminates and visualizes climate data for Guam: gridded daily rainfall maps (rainfall data 1980–2024), with downloads of the maps and the station data.</p>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <ExternalLink href={GUAM_PAGE} className="font-medium">Open the Guam Data Viewer</ExternalLink>
            <ExternalLink href={`${HCDP}/guam-draft/`}>Guam country page (under development)</ExternalLink>
          </p>
        </Card>
      </Section>

      <Section id="pacific-portal" title="Pacific Portal" lead={<p>The portal's hub for the wider Pacific Islands region. <ExternalLink href={PACIFIC_PAGE}>Open the Pacific Portal</ExternalLink></p>}>
        <div className="space-y-8">
          <div>
            <h3 className="flex items-center gap-2 font-display text-lg"><Database className="h-4 w-4 text-accent" aria-hidden="true" /><ExternalLink href={`${HCDP}/pacific-islands-data/`} plain arrow={false} className="hover:underline">Data</ExternalLink></h3>
            <div className="mt-2"><LinkList items={PACIFIC_DATA} /></div>
          </div>
          <div>
            <h3 className="flex items-center gap-2 font-display text-lg"><Users className="h-4 w-4 text-accent" aria-hidden="true" /><ExternalLink href={`${HCDP}/pacific-portal-regional-partners/`} plain arrow={false} className="hover:underline">Regional Organizations</ExternalLink></h3>
            <details className="mt-2 rounded-lg border border-border bg-surface p-3">
              <summary className="cursor-pointer text-sm font-medium">{REGIONAL_ORGS.length} organizations</summary>
              <div className="mt-3"><LinkList items={REGIONAL_ORGS} /></div>
            </details>
          </div>
          <div>
            <h3 className="flex items-center gap-2 font-display text-lg"><Globe2 className="h-4 w-4 text-accent" aria-hidden="true" /><ExternalLink href={`${HCDP}/2826-2/`} plain arrow={false} className="hover:underline">Countries &amp; Territories</ExternalLink></h3>
            <p className="mt-1 text-sm text-subtle">Country and territory resource pages (under development).</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {COUNTRIES.map(([name, slug]) => (
                <li key={slug}><ExternalLink href={`${HCDP}/${slug}/`} plain className="inline-block rounded-full border border-border px-3 py-1 text-sm hover:border-foreground">{name}</ExternalLink></li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="flex items-center gap-2 font-display text-lg"><Waves className="h-4 w-4 text-accent" aria-hidden="true" /><ExternalLink href={`${HCDP}/pacific-islands-tools-and-resources/`} plain arrow={false} className="hover:underline">Tools &amp; Resources</ExternalLink></h3>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {TOOLS_RESOURCES.map(([name, slug]) => (
                <li key={slug} className="rounded-lg border border-border bg-card p-3"><ExternalLink href={`${HCDP}/${slug}/`} className="font-medium">{name}</ExternalLink></li>
              ))}
            </ul>
            <p className="mt-3 max-w-3xl text-sm text-subtle">The Pacific Marine National Monuments page describes the weather stations the US Fish and Wildlife Service runs in the monuments, with examples of how the data are used: albatross hyperthermia and nest flooding on Kamole (Laysan), invasive plant management on Nihoa, phenology on Jarvis Island, and sand temperature and storms on Rose Island.</p>
          </div>
        </div>
      </Section>

      <Section id="code" title="Pacific data by code">
        <Card className="flex items-start gap-3 p-4">
          <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <p className="text-sm">The HCDP API serves American Samoa as well as Hawaiʻi (<code className="font-mono">location=american_samoa</code>). See the <Link className="underline" to="/data/api">HCDP / Hawaiʻi Mesonet API</Link> page.</p>
        </Card>
      </Section>
    </PageShell>
  )
}
