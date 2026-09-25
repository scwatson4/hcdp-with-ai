import { Link } from 'react-router-dom'
import { Users, History as HistoryIcon, Award, Quote, Map as MapIcon } from 'lucide-react'
import { formatViewerPath } from '../../viewer/urlGrammar'
import { HCDP } from '../../site/nav'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageShell, Section, Prose } from './PageShell'
import ExternalLink from './ExternalLink'
import { CopyBlock } from './CopyButton'
import { aboutRelated } from './contentUtils'

// ---------------------------------------------------------------------------
// Team — names, roles and affiliations as listed on
// https://www.hawaii.edu/climate-data-portal/team/ (checked 2026-09-25).
// ---------------------------------------------------------------------------

const TEAM = [
  { name: 'Ryan Longman', role: 'HCDP Director', affiliation: 'Program Director, Pacific Islands Climate Adaptation Science Center, Hawaiʻi Sea Grant College Program; Associate Climatologist, Water Resources Research Center' },
  { name: 'Thomas Giambelluca', role: 'Hawaiʻi Mesonet Director', affiliation: 'Climatologist, Water Resources Research Center' },
  { name: 'Sean Cleveland', role: 'Director of Cyber Infrastructure', affiliation: 'Interim Director of Cyber Infrastructure, Hawaiʻi Data Science Institute' },
  { name: 'Keri Kodama', role: 'HCDP Research Development Lead', affiliation: 'Climate Research & Outreach Specialist, Hawaiʻi Sea Grant College Program; Assistant Atmospheric Scientist, Water Resources Research Center' },
  { name: 'Han Tseng', role: 'Deputy Director Hawaiʻi Mesonet – Field Operations', affiliation: 'Hydrometeorological Researcher, Water Resources Research Center' },
  { name: 'Jared McLean', role: 'Lead Software Engineer', affiliation: 'Research Software Engineer, Information Technology Services, University of Hawaiʻi at Mānoa' },
  { name: 'Matt Lucas', role: 'HCDP Product Development Lead', affiliation: 'Spatial Climate Analysis Specialist, Water Resources Research Center' },
  { name: 'Chris Shuler', role: 'Deputy Director Hawaiʻi Mesonet – Program Operations', affiliation: 'Assistant Specialist, Water Resources Research Center' },
  { name: 'Roderick Tabalba', role: 'Software Engineer', affiliation: 'Artificial Intelligence Research Software Engineer, Information Technology Services, University of Hawaiʻi at Mānoa' },
  { name: 'Cherryle Heu', role: 'HCDP Climate Data Analyst', affiliation: 'Environmental Data Analyst, Hawaiʻi Sea Grant College Program' },
  { name: 'Anke Kuegler', role: 'Mesonet Field Technician', affiliation: 'Mesonet Technician, Water Resources Research Center' },
  { name: 'Jennifer Geis', role: 'Software Engineer', affiliation: 'Cyberinfrastructure Software Engineer, University of Hawaiʻi System' },
  { name: 'Aimee Schriber', role: 'Communications Specialist', affiliation: 'Geospatial Research Technician, Water Resources Research Center' },
  { name: 'Cory Yap', role: 'Mesonet Technician', affiliation: 'Research Associate, Water Resources Research Center' },
  { name: 'Marrisa Halim', role: 'Data Visualization', affiliation: 'Graduate student, Information and Computer Sciences' },
]

const CONTRIBUTORS = [
  { name: 'Abby Frazier', affiliation: 'Assistant Professor, Geography, Clark University; Assistant Climatologist, Water Resources Research Center' },
  { name: 'Aurora Kagawa-Viviani', affiliation: 'Assistant Professor, University of Hawaiʻi at Mānoa Department of Geography and Environment and Water Resources Research Center' },
  { name: 'Sayed Bateni', affiliation: 'Professor, Water Resources Research Center; Professor, Department of Civil, Environmental, and Construction Engineering' },
  { name: 'Yu-Fen Huang', affiliation: 'Junior Researcher, Department of Natural Resources and Environmental Management, University of Hawaiʻi at Mānoa' },
  { name: 'Derek Ford', affiliation: 'Geospatial Data Analyst, Pacific Drought Knowledge Exchange' },
  { name: 'Kristen Sanfillipo', affiliation: 'Hydrometeorological Researcher, Hawaiʻi Sea Grant College Program' },
  { name: 'Katie Kamelamela', affiliation: 'Assistant Professor, School of Ocean Futures, Arizona State University' },
  { name: 'Noelani Puniwai', affiliation: 'Associate Professor of Mālama ʻĀina, Hawaiʻinuiākea School of Hawaiian Knowledge, Kamakakūokalani Center for Hawaiian Studies, University of Hawaiʻi at Mānoa' },
  { name: 'Thi Kieu Trang Tran', affiliation: 'Graduate student, Department of Civil, Environmental & Construction Engineering' },
]

const initials = (name) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('')

function PersonCard({ person }) {
  return (
    <Card className="h-full p-4" data-testid="person">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft font-display text-base text-accent">{initials(person.name)}</span>
        <div className="min-w-0">
          <h3 className="font-display text-lg leading-tight">{person.name}</h3>
          {person.role && <p className="mt-0.5 text-sm font-medium">{person.role}</p>}
          <p className="mt-1 text-sm text-subtle">{person.affiliation}</p>
        </div>
      </div>
    </Card>
  )
}

export function AboutTeam() {
  return (
    <PageShell
      title="Team"
      icon={Users}
      source={`${HCDP}/team/`}
      lead={<p>The people behind the Hawaiʻi Climate Data Portal. The team spans three programs: the HCDP, the Hawaiʻi Mesonet and Cyberinfrastructure.</p>}
      actions={['HCDP', 'Hawaiʻi Mesonet', 'Cyberinfrastructure'].map((p) => <Badge key={p} variant="soft">{p}</Badge>)}
      related={aboutRelated('/about/team')}
    >
      <Section id="team" title="Team members">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TEAM.map((p) => <li key={p.name}><PersonCard person={p} /></li>)}
        </ul>
      </Section>
      <Section id="contributors" title="Contributors">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CONTRIBUTORS.map((p) => <li key={p.name}><PersonCard person={p} /></li>)}
        </ul>
      </Section>
      <p className="text-sm text-subtle">Many more people support climate monitoring and data in Hawaiʻi; see the <Link className="underline" to="/about/acknowledgements">Acknowledgements</Link>.</p>
    </PageShell>
  )
}

// ---------------------------------------------------------------------------
// HCDP History — https://www.hawaii.edu/climate-data-portal/2339-2/ (tightened).
// ---------------------------------------------------------------------------

const LANE_MAP = formatViewerPath({ dataset: 'rainfall', period: 'month', date: '2018-08', extent: 'hawaii' })

export function AboutHistory() {
  return (
    <PageShell
      title="HCDP History"
      icon={HistoryIcon}
      source={`${HCDP}/2339-2/`}
      lead={<p>Why Hawaiʻi needs a climate data portal, and how the HCDP came to be.</p>}
      related={aboutRelated('/about/history')}
    >
      <Section id="climate-of-hawaii" title="The climate of Hawaiʻi">
        <Prose>
          <p>The Hawaiian Islands have one of the most diverse climates on Earth. Rainfall, temperature, solar radiation and relative humidity gradients are so steep that continental-scale ranges occur over short distances (less than 25 km). That makes Hawaiʻi a remarkable place for research, but characterizing the patterns takes data.</p>
          <p>Four of the five major Köppen climate groups are found on Hawaiʻi Island alone: wet tropical climates on windward coasts, arid and semi-arid climates on some leeward coasts, temperate wet and dry climates upslope on the highest islands (Maui and Hawaiʻi), and polar climates at the tops of Mauna Kea, Mauna Loa and Haleakalā.</p>
          <p>The islands lie in a relatively dry latitude, yet topography and persistent winds bring abundant rain to windward slopes: moist air pushed up the mountains condenses into cloud at the lifting condensation level (LCL). On the highest islands the trade wind inversion (TWI), when present, caps that upslope flow and leaves the high elevations dry. The wind-blown clouds just below the inversion add significant water and support a lush tropical mountain cloud forest.</p>
          <p>Knowing these patterns matters for groundwater and surface water development and protection, controlling and eradicating invasive species, protecting and restoring native ecosystems, and planning for the effects of global warming.</p>
        </Prose>
      </Section>

      <Section id="climate-data" title="Climate data in Hawaiʻi">
        <Prose>
          <p>The hardest part of any analysis built on station observations is finding, acquiring and quality-controlling the data. In Hawaiʻi, climate data come from independent researchers and county, state and federal agencies, spread across several large electronic repositories in different formats that can take technical skill to access.</p>
          <p>For many years, researchers at the University of Hawaiʻi at Mānoa compiled and quality-controlled climate data for their own research, producing gridded products such as rainfall and temperature maps. These were shared through journal articles, technical reports or peer-to-peer networks, and by the time a product was available its record no longer covered recent events: climate data production lagged months and years behind the weather.</p>
        </Prose>
      </Section>

      <Section id="evolution" title="Evolution of the HCDP">
        <Prose>
          <p>A central repository for quality-controlled climate data and gridded climate products had been in the making for over a decade, held back by a lack of resources and technical limitations.</p>
        </Prose>
        <Card className="my-5 flex max-w-3xl gap-4 p-4">
          <Badge variant="soft" className="h-fit shrink-0 font-mono">2018</Badge>
          <p className="text-sm leading-relaxed">As part of the Established Program to Stimulate Competitive Research (EPSCoR) ʻIke Wai project, scientists from the UH Mānoa Department of Geography and Environment, the Hawaiʻi Data Science Institute (UH Mānoa), the Water Resources Research Center (WRRC, UH) and the East-West Center (EWC) began building the open-source data and information platform that became the Hawaiʻi Climate Data Portal.</p>
        </Card>
        <Prose>
          <p>As the work got under way, the team saw how siloed Hawaiʻi's climate data and information were: researchers could not see the full range of available resources, and many land and resource managers did not know about the climate tools and data that already existed. So the team built features that connect users to the full range of climate data, information and decision-support tools in the state:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>an easy-to-use interface to visualize and download meteorological data;</li>
            <li>a reference library of over 400 peer-reviewed journal articles and technical reports;</li>
            <li>an archive of National Weather Service monthly rainfall summaries;</li>
            <li>highlights of past and ongoing research across the state;</li>
            <li>access to a range of decision-support tools;</li>
            <li>information on indigenous climate knowledge perspectives.</li>
          </ul>
          <p>The overarching goal is streamlined access to high-quality, reliable climate data and information for the State of Hawaiʻi, including near-real-time monthly rainfall and daily temperature maps and a user-friendly tool to visualize and download them. Researchers spend more time on analysis and less on collecting and processing data; the wider community gets information that technical barriers would otherwise put out of reach; and centralizing data and information supports a more holistic environment for environmental stewardship in Hawaiʻi.</p>
        </Prose>
        <Card className="mt-6 max-w-3xl p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"><MapIcon className="h-4 w-4" aria-hidden="true" /></span>
            <div className="text-sm">
              <p>The history page illustrates the portal with the monthly rainfall map for August 2018, one of the wettest months in Hawaiʻi Island's rainfall record, due to Hurricane Lane (Lucas et al., 2022).</p>
              <Link to={LANE_MAP} className="mt-2 inline-block font-medium text-accent underline-offset-2 hover:underline">Open August 2018 rainfall on Hawaiʻi Island in the climate viewer →</Link>
            </div>
          </div>
        </Card>
      </Section>
    </PageShell>
  )
}

// ---------------------------------------------------------------------------
// Acknowledgements — https://www.hawaii.edu/climate-data-portal/acknowledgements/
// The funding statement is the one in the portal's footer; the Hawaiʻi
// Mesonet funding paragraph is quoted from the Hawaiʻi Mesonet page.
// ---------------------------------------------------------------------------

const FUNDING_STATEMENT = 'This work is supported by the National Science Foundation OIA #2149133 and Hawaii EPSCoR- RII Track-1: Change Hawaii: Harnessing the Data Revolution for Island Resilience'
const MESONET_FUNDING = 'More than $1.5M for the purchase of equipment was obtained primarily from the National Science Foundation, with additional funds provided by the Hawaiʻi Commission on Water Resources Management and the Honolulu Board of Water Supply. Support for the costs of installation come from the Water Resources Research Center and the Office of the Vice Provost for Research and Scholarship at the University of Hawaiʻi at Mānoa.'

// Institution → optional sub-groups → people, in the page's order.
const ACKNOWLEDGED = [
  { org: 'University of Hawaiʻi', groups: [{ name: 'Information Technology Services', people: ['Gwen Jacobs', 'Sean Cleveland', 'Jared McLean', 'Michael Dodge II', 'Michelle Choe', 'Maria Dumanlang', 'Shivani Tanaka'] }] },
  { org: 'University of Hawaiʻi Hilo', groups: [{ people: ['Rebecca Ostertag', 'James Juvik', 'Johnathan Price'] }] },
  { org: 'Honolulu Community College', groups: [{ people: ['John Delay'] }] },
  { org: 'Clark University', groups: [{ people: ['Abby Frazier'] }] },
  { org: 'University at Albany-SUNY', groups: [{ people: ['Oliver Elison Timm'] }] },
  { org: 'Stanford University', groups: [{ people: ['Peter Vitousek'] }] },
  { org: 'University of California Santa Barbara', groups: [{ people: ['Oliver Chadwick'] }] },
  { org: 'USDA Natural Resources Conservations Service', groups: [{ people: ['Carolyn Wong'] }] },
  { org: 'University of Arizona', groups: [{ people: ['Katie Kamelamela'] }] },
  { org: 'Conservation Science Partners', groups: [{ people: ['Shelley Crausbay'] }] },
  { org: 'Citizen Scientist', groups: [{ people: ['Glenn Bauer'] }] },
  { org: 'HaleNet Climate Network', groups: [
    { name: 'HaleNet Field Technicians', people: ['Kathy Wakelee', 'Sabine Jessel', 'Bill Minysard', 'Chuck Chimera', 'Phillip Thomas', 'Paul Krushelnycky', 'Stephanie Joe', 'Forrest Starr', 'Kim Starr', 'Trae Menard', 'David Penn', 'Dennis Nullet', 'Mike Nullet', 'John Delay', 'Ryan Longman', 'Ryan Mudd'] },
    { name: 'Windward Aviation', people: ['Don Shearer', 'Duke Baldwin'] },
    { name: 'USGS – PIERC', people: ['Lloyd Loope', 'Gordon Tribble', 'Art Medieros'] },
    { name: 'Haleakalā National Park', people: ['Natalie Gates', 'Ron Nagata', 'Ted Rodriques', 'Steve Anderson', 'Matt Brown', 'Terry Lind', 'Timmy Bailey', 'Clinton Fukushima', 'Ross Hart', 'Sean Birney', 'Liz Gordon', 'Mark Rentz', 'Peter Kafka', 'Don Reeser', 'Marilyn Parris', 'Sarah Creachbaum', 'Natalie Gates'] },
    { name: 'UH Kula Ag. Experimental Station', people: ['Dave Oka'] },
    { name: 'Haleakalā Ranch', people: ['Scott Meindell'] },
    { name: 'Ulupalakua Ranch', people: ['Sumner Erdman'] },
  ] },
  { org: 'University of Hawaiʻi at Mānoa', groups: [
    { name: 'Water Resources Research Center', people: ['Thomas Giambelluca', 'Matt Lucas', 'Aimee Schriber', 'Christopher Shuler', 'Sayed Bateni', 'Jonghyun (Harry) Lee', 'Aurora Kagawa-Viviani', 'Ryan Longman'] },
    { name: 'Department of Natural Resources and Environmental Management', people: ['Yin-Phan Tsang', 'Creighton Litton', 'Tomoaki Miura', 'Clay Trauernicht', 'Yufen Huang'] },
    { name: 'SeaGrant', people: ['Darren Learner', 'Rosie Alegado'] },
    { name: 'Department of Hawaiian Studies', people: ['Noelani Puniwai'] },
    { name: 'Department of Atmospheric Sciences', people: ['Alison Nugent', 'Giuseppe Torri', 'Pao-Shin Chu', 'Steven Businger', 'Yi-Leng Chen', 'Thomas Schroeder'] },
    { name: 'International Pacific Research Center', people: ['Chunxi Zhang', 'Xiao Luo'] },
    { name: 'Department of Geography and Environment', people: ['Thomas Giambelluca', 'Mike Nullet', 'Aurora Kagawa-Viviani', 'Han Tseng', 'Henry Diaz', 'David Beilman', 'Qi Chen'] },
    { name: 'Department of Plant and Environment Protection Sciences', people: ['Paul Krushelnycky'] },
    { name: 'Department of Oceanography', people: ['Charles Fletcher', 'Brian Glazer'] },
  ] },
  { org: 'HAVONET', groups: [
    { name: 'UHM Department of Geography and Environment', people: ['Tom Giambelluca', 'Mike Nullet', 'Ryan Mudd'] },
    { name: 'Honolulu Community College', people: ['John Delay'] },
    { name: 'Hawaiʻi Volcanoes National Park', people: ['Sierra McDaniel', 'Mark Wasser', 'Rhonda Loh'] },
  ] },
  { org: 'HIPPNET Climate Network', groups: [
    { name: 'UHM Department of Natural Resources and Environmental Management', people: ['Creighton Litton'] },
    { name: 'USDA Forest Service', people: ['Christian Giardina', 'Susan Cordell', 'Robert Hegemann'] },
    { name: 'University of California Los Angeles', people: ['Lawren Sack'] },
    { name: 'University of Hawaiʻi Hilo (UHH)', people: ['Rebecca Ostertag'] },
  ] },
  { org: 'East-West Center', groups: [{ people: ['Ryan Longman', 'Derek Ford', 'Keri Kodama'] }] },
  { org: 'Honolulu Board of Water Supply', groups: [{ people: ['Barry Usagawa', 'Nancy Matsumoto'] }] },
  { org: 'Commission for Water Resource Management', groups: [{ people: ['Kaleo Manuel', 'Neal Fujii', 'Ayron Strauch'] }] },
  { org: 'Ulupono Initiative', groups: [{ people: ['Jeremy Kimura'] }] },
  { org: 'United States Fish and Wildlife Service', groups: [{ people: ['Jeff Burgett'] }] },
  { org: 'USGS Pacific Islands Water Science Center', groups: [{ people: ['Delwyn Oki', 'Alan Mair', 'Kolja Rotzoll', 'Heidi Kane', 'John Hoffman'] }] },
  { org: 'USGS Pacific Islands Ecosystem Research Center', groups: [{ people: ['Gordon Tribble', 'Lucas Fortini'] }] },
  { org: 'USGS Pacific Islands Climate Adaptation Science Center', groups: [{ people: ['Mari-Vaughn Johnson', 'Heather Kerkering'] }] },
  { org: 'NOAA National Weather Service', groups: [{ people: ['Kevin Kodama'] }] },
  { org: 'Ulu Mau Puanui', groups: [{ people: ['Kehaulani Marshall'] }] },
  { org: 'Rainfall Atlas of Hawaiʻi', groups: [
    { name: 'UHH Department of Geography and Environmental Sciences', people: ['Jonathan Price'] },
    { name: 'UHM Department of Atmospheric Sciences', people: ['Pao-Shin Chu', 'Yi-Leng Chen'] },
    { name: 'Cooperative Institute for Research in Environmental Science, University of Colorado, Boulder, Colorado', people: ['John Eischeid'] },
    { name: 'Idaho State University', people: ['Donna Delparte'] },
    { name: 'Oregon State University', people: ['Christopher Daly'] },
  ] },
  { org: 'Evapotranspiration of Hawaiʻi', groups: [
    { name: 'UHM Department of Geography and Environment', people: ['Thomas Giambelluca', 'Abby Frazier', 'Ryan Longman', 'Qi Chen'] },
    { name: 'Indiana University', people: ['Mallory Barnes'] },
    { name: 'Northrop Grumman Corporation', people: ['Randy Allis'] },
    { name: 'Contractor', people: ['Xiufu Shuai'] },
    { name: 'Idaho State University', people: ['Donna Delparte'] },
  ] },
]

export function AboutAcknowledgements() {
  return (
    <PageShell
      title="Acknowledgements"
      icon={Award}
      source={`${HCDP}/acknowledgements/`}
      lead={<p>The HCDP is the product of hard work and dedication from many people at institutions and organizations in Hawaiʻi and beyond. Research scientists, field technicians and community members all helped pave the way. These are the people recognized for past or ongoing contributions to climate monitoring and data dissemination in Hawaiʻi.</p>}
      related={aboutRelated('/about/acknowledgements')}
    >
      <Section id="funding" title="Funding">
        <figure className="max-w-3xl rounded-lg border border-border bg-surface p-4">
          <blockquote className="text-base leading-relaxed" data-testid="funding-statement">{FUNDING_STATEMENT}</blockquote>
          <figcaption className="mt-2 text-xs text-subtle">
            As stated in the portal's footer. <ExternalLink href="https://www.nsf.gov/awardsearch/showAward?AWD_ID=2149133">NSF award 2149133</ExternalLink> · <ExternalLink href="https://hawaii.edu/epscor">Hawaiʻi EPSCoR</ExternalLink>
          </figcaption>
        </figure>
        <figure className="mt-4 max-w-3xl rounded-lg border border-border bg-surface p-4">
          <p className="mb-1 text-sm font-medium">Building the Hawaiʻi Mesonet</p>
          <blockquote className="text-sm leading-relaxed text-subtle">{MESONET_FUNDING}</blockquote>
          <figcaption className="mt-2 text-xs text-subtle">From the <Link className="underline" to="/mesonet">Hawaiʻi Mesonet</Link> page.</figcaption>
        </figure>
      </Section>

      <Section
        id="contributors"
        title="Contributors"
        lead={<p>Grouped by institution as on the portal. Suggestions for additions are welcome: <a className="underline" href="mailto:hcdp@hawaii.edu">hcdp@hawaii.edu</a>.</p>}
      >
        <div className="gap-4 sm:columns-2 lg:columns-3">
          {ACKNOWLEDGED.map((inst) => (
            <Card key={inst.org} className="mb-4 break-inside-avoid p-4" data-testid="ack-institution">
              <h3 className="font-display text-lg leading-tight">{inst.org}</h3>
              {inst.groups.map((g, i) => (
                <div key={g.name || i} className="mt-2">
                  {g.name && <p className="text-xs font-semibold uppercase tracking-wide text-subtle">{g.name}</p>}
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {g.people.map((p, j) => <li key={`${p}-${j}`}>{p}</li>)}
                  </ul>
                </div>
              ))}
            </Card>
          ))}
        </div>
      </Section>
    </PageShell>
  )
}

// ---------------------------------------------------------------------------
// How to Cite — https://www.hawaii.edu/climate-data-portal/how-to-cite-3/
// Citations as the portal lists them (one typo corrected: "Soceity").
// ---------------------------------------------------------------------------

const BAMS_URL = 'https://journals.ametsoc.org/view/journals/bams/aop/BAMS-D-23-0188.1/BAMS-D-23-0188.1.xml'
const HCDP_BAMS = 'Ryan J. Longman, Mathew P. Lucas, Jared Mclean, Sean Cleveland, Keri Kodama, Abby G. Frazier, Katie Kamelamela, Aimee Schriber, Michael Dodge, Gwen Jacobs, Thomas W. Giambelluca. 2024. “Hawaiʻi Climate Data Portal (HCDP).” Bulletin of the American Meteorological Society.'
const KRIGING = 'Lucas, Mathew P., Ryan J. Longman, Thomas W. Giambelluca, Abby F. Frazier, J. Mclean, S. B. Cleveland, YF. Haung, and Jonghyun H. Lee. n.d. “Optimizing Automated Kriging to Improve Spatial Interpolation of Monthly Rainfall over Complex Terrain.” In Review: Journal of Hydrometeorology.'
const KRIGING_URL = 'https://journals.ametsoc.org/view/journals/hydr/aop/JHM-D-21-0171.1/JHM-D-21-0171.1.xml'
const FRAZIER_2016 = 'Frazier, Abby G., Thomas W. Giambelluca, Henry F. Diaz, and Heidi L. Needham. 2016. “Comparison of Geostatistical Approaches to Spatially Interpolate Month-Year Rainfall for the Hawaiian Islands.” International Journal of Climatology.'
const FRAZIER_2016_URL = 'https://rmets.onlinelibrary.wiley.com/doi/10.1002/joc.4437'
const LONGMAN_2019 = 'Longman, Ryan J., Abby G. Frazier, Andrew J. Newman, Thomas W. Giambelluca, David Schanzenbach, Aurora Kagawa-Viviani, Heidi Needham, Jeffrey R. Arnold, and Martyn P. Clark. 2019. “High-Resolution Gridded Daily Rainfall and Temperature for the Hawaiian Islands (1990-2014).” Journal of Hydrometeorology JHM-D-18-0112.1.'
const LONGMAN_2019_URL = 'https://journals.ametsoc.org/view/journals/hydr/20/3/jhm-d-18-0112_1.xml'
const KODAMA = 'Kodama, K., E. Kourkchi, R. J. Longman, M. P. Lucas, S. Bateni, Y. F. Huang, A. Kagawa-Viviani, J. McLean, S. B. Cleveland, and T. W. Giambelluca. n.d. “Mapping Daily Air Temperature Over the Hawaiian Islands From 1990 to 2021 via an Optimized Piecewise Linear Regression Technique.” Earth and Space Science.'
const KODAMA_URL = 'https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2023EA002851'
const LONGMAN_2018 = 'Longman, Ryan J., Thomas W. Giambelluca, Michael A. Nullet, Abby G. Frazier, Kevin Kodama, Shelley D. Crausbay, Paul D. Krushelnycky, Susan Cordell, Martyn P. Clark, Andy J. Newman, and Jeffrey R. Arnold. 2018. “Compilation of Climate Data from Heterogeneous Networks across the Hawaiian Islands.” Scientific Data 5:180012.'
const LONGMAN_2018_URL = 'https://www.nature.com/articles/sdata201812'
const ET_REPORT = 'Giambelluca, Thomas W., Xiufu Shuai, Mallory L. Barnes, Randall J. Alliss, Ryan J. Longman, Tomoaki Miura, Qi Chen, Abby G. Frazier, Ryan G. Mudd, Lan Cuo, and Aaron D. Businger. 2014. Evapotranspiration of Hawai’i Final Report. Honolulu.'

const journal = (href) => ({ label: 'Journal', href })
const website = (href) => ({ label: 'Website', href })

const CITATIONS = [
  { id: 'portal', title: 'Hawaiʻi Climate Data Portal', products: [
    { title: 'HCDP Overview and Attributes', entries: [{ text: HCDP_BAMS, links: [journal(BAMS_URL)] }] },
    { title: 'HCDP Application Programming Interface (API) and HCDP Data Download and Visualization Tool', entries: [
      { text: 'Mclean, Jared, Sean B. Cleveland, Michael Dodge II, Matthew P. Lucas, Ryan J. Longman, Thomas W. Giambelluca, and Gwen A. Jacobs. 2021. “Building A Portal For Climate Data-Mapping Automation, Visualization, and Dissemination.” Concurrency and Computation: Practice and Experience.', links: [journal('https://onlinelibrary.wiley.com/doi/10.1002/cpe.6727')] },
      { text: 'McLean, J. H., S. B. Cleveland, M. P. Lucas, R. J. Longman, T. W. Giambelluca, J. Leigh, and G. A. Jacobs. 2020. “The Hawai‘i Rainfall Analysis and Mapping Application (HI-RAMA): Decision Support and Data Visualization for Statewide Rainfall Data. In Practice and Experience in Advanced Research Computing.” Practice and Experience in Advanced Research 239–45.', links: [journal('https://dl.acm.org/doi/abs/10.1145/3311790.3396668')] },
    ] },
  ] },
  { id: 'rainfall-maps', title: 'HCDP Monthly Rainfall Maps', products: [
    { title: '2020–present day', entries: [{ text: HCDP_BAMS, links: [journal(BAMS_URL)] }] },
    { title: '1990–2019 maps and mapping methods', entries: [
      { text: KRIGING, links: [journal(KRIGING_URL)] },
      { text: 'Longman, R.J., Newman, A.J. Giambelluca, T.W. Lucas, M., (2020). Characterizing the uncertainty and assessing the value of gap-filled daily rainfall data in Hawai‘i. Journal of Applied Meteorology and Climatology, 59 (7), 1261-1276.', links: [journal('https://journals.ametsoc.org/view/journals/apme/59/7/jamcD200007.xml')] },
    ] },
    { title: '1920–2012 “legacy” rainfall maps and methods', entries: [{ text: FRAZIER_2016, links: [journal(FRAZIER_2016_URL)] }] },
  ] },
  { id: 'rainfall-data', title: 'HCDP Rainfall Data', products: [
    { title: '2020–present day daily and monthly data', entries: [{ text: HCDP_BAMS, links: [journal(BAMS_URL)] }] },
    { title: '1990–2019', entries: [{ text: KRIGING, links: [journal(KRIGING_URL)] }] },
    { title: '1990–2014', entries: [{ text: LONGMAN_2019, links: [journal(LONGMAN_2019_URL)] }] },
    { title: '1920–2012 “legacy” monthly data', entries: [{ text: FRAZIER_2016, links: [journal(FRAZIER_2016_URL)] }] },
  ] },
  { id: 'temperature-maps', title: 'HCDP Daily and Monthly Temperature Maps', products: [
    { title: '2020–present day', entries: [{ text: HCDP_BAMS, links: [journal(BAMS_URL)] }] },
    { title: '1990–2018 maps and mapping methods', entries: [{ text: KODAMA, links: [journal(KODAMA_URL)] }] },
  ] },
  { id: 'temperature-data', title: 'HCDP Daily and Monthly Temperature Data', products: [
    { title: '2019–present day', entries: [{ text: HCDP_BAMS, links: [journal(BAMS_URL)] }] },
    { title: '1990–2018', entries: [
      { text: KODAMA, links: [journal(KODAMA_URL)] },
      { text: 'Kagawa-Viviani, A. K. and T. W. Giambelluca. 2020. “Spatial Patterns and Trends in Surface Air Temperatures and Implied Changes in Atmospheric Moisture Across the Hawaiian Islands, 1905–2017.” Journal of Geophysical Research: Atmospheres 125(2).', links: [journal('https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2019JD031571')] },
      { text: LONGMAN_2018, links: [journal(LONGMAN_2018_URL)] },
    ] },
    { title: 'Relative humidity, solar radiation, windspeed data', entries: [
      { text: 'Longman, R. J., M. P. Lucas, J. Mclean, T. W. Giambelluca, S. Cleveland, Kodama, K., M. Dodge II, K. Kamelamela, A. Schriber, A. Frazier, Yu-Fen Huang, and G. Jacobs. 2024. “Hawaiʻi Climate Data Portal (HCDP).” Bulletin of the American Meteorological Society.', links: [journal(BAMS_URL)] },
      { text: LONGMAN_2018, links: [journal(LONGMAN_2018_URL)] },
    ] },
  ] },
  { id: 'projections', title: 'Future Climate Projections', products: [
    { title: 'Products available on the portal (bias-corrected gridded products)', entries: [{ text: HCDP_BAMS, links: [journal(BAMS_URL)] }] },
    { title: 'Dynamical downscaling methods for rainfall and temperature', entries: [{ text: 'Zhang, Chunxi, Yuqing Wang, Kevin Hamilton, and Axel Lauer. 2016. “Dynamical Downscaling of the Climate for the Hawaiian Islands. Part II: Projection for the Late Twenty-First Century.” Journal of Climate 29(23):8333–54.', links: [journal('https://journals.ametsoc.org/view/journals/clim/29/23/jcli-d-16-0038.1.xml')] }] },
    { title: 'Statistical downscaling methods: rainfall', entries: [{ text: 'Elison Timm, Oliver, Thomas W. Giambelluca, and Henry F. Diaz. 2015. “Statistical Downscaling of Rainfall Changes in Hawai‘i Based on the CMIP5 Global Model Projections.” Journal of Geophysical Research 120(1):92–112.', links: [journal('https://agupubs.onlinelibrary.wiley.com/doi/10.1002/2014JD022059')] }] },
    { title: 'Statistical downscaling methods: temperature', entries: [{ text: 'Elison Timm, Oliver. 2017. “Future Warming Rates over the Hawaiian Islands Based on Elevation-Dependent Scaling Factors.” International Journal of Climatology 37:1093–1104.', links: [journal('https://rmets.onlinelibrary.wiley.com/doi/10.1002/joc.5065')] }] },
  ] },
  { id: 'spi', title: 'Standardized Precipitation Index', products: [
    { title: 'Maps and methods', entries: [{ text: 'Lucas, Matthew P., Clay Trauernicht, Abby G. Frazier, and Tomoaki Miura. 2020. “Long-Term, Gridded Standardized Precipitation Index for Hawai’i.” Data 5.', links: [journal('https://www.mdpi.com/2306-5729/5/4/109')] }] },
  ] },
  { id: 'twi', title: 'Trade Wind Inversion Data', products: [
    { title: 'Data 1990–2014, Hilo and Līhuʻe', entries: [{ text: 'Longman, Ryan J., Henry F. Diaz, and Thomas W. Giambelluca. 2015. “Sustained Increases in Lower-Tropospheric Subsidence over the Central Tropical North Pacific Drive a Decline in High-Elevation Rainfall in Hawaii.” Journal of Climate.', links: [journal('https://journals.ametsoc.org/view/journals/clim/28/22/jcli-d-15-0006.1.xml')] }] },
  ] },
  { id: 'not-on-hcdp', title: 'Relevant Methods and Data Not Available on HCDP', lead: 'Mean climate', products: [
    { title: 'Rainfall Atlas of Hawaiʻi website', entries: [{ text: 'Giambelluca, Thomas W., Qi Chen, Abby G. Frazier, Jonathan P. Price, Yi Leng Chen, Pao Shin Chu, Jon K. Eischeid, and Donna M. Delparte. 2013. “Online Rainfall Atlas of Hawai’i.” Bulletin of the American Meteorological Society 94:312–16.', links: [journal('https://journals.ametsoc.org/view/journals/bams/94/3/bams-d-11-00228.1.xml'), website('http://rainfall.geography.hawaii.edu/')] }] },
    { title: 'Evapotranspiration of Hawaiʻi website', entries: [{ text: ET_REPORT, links: [journal('http://evapotranspiration.geography.hawaii.edu/assets/files/PDF/ET%20Project%20Final%20Report.pdf'), website('http://evapotranspiration.geography.hawaii.edu/')] }] },
    { title: 'Solar Radiation of Hawaiʻi website', entries: [{ text: ET_REPORT, links: [website('http://solar.geography.hawaii.edu/')] }] },
    { title: 'Climate of Hawaiʻi website', entries: [{ text: ET_REPORT, links: [website('http://climate.geography.hawaii.edu/')] }] },
  ] },
  { id: 'daily-earlier', title: 'Daily Rainfall and Temperature (Earlier Effort)', products: [
    { title: '1990–2014', entries: [{ text: LONGMAN_2019, links: [journal(LONGMAN_2019_URL)] }] },
  ] },
]

export function HowToCite() {
  return (
    <PageShell
      title="How to Cite"
      icon={Quote}
      source={`${HCDP}/how-to-cite-3/`}
      lead={<p>Please cite the data products and the portal when you use them. Each product's citation is below as the portal lists it; <span className="font-medium text-foreground">Copy</span> puts it on your clipboard.</p>}
      related={aboutRelated('/about/how-to-cite')}
    >
      <nav aria-label="Products" className="flex flex-wrap gap-2">
        {CITATIONS.map((g) => (
          <a key={g.id} href={`#${g.id}`} className="rounded-full border border-border px-3 py-1 text-xs text-subtle hover:border-foreground hover:text-foreground">{g.title}</a>
        ))}
      </nav>
      {CITATIONS.map((group) => (
        <Section key={group.id} id={group.id} title={group.title} lead={group.lead}>
          <div className="space-y-6">
            {group.products.map((product) => (
              <div key={product.title}>
                <h3 className="font-display text-lg">{product.title}</h3>
                <div className="mt-2 space-y-2">
                  {product.entries.map((entry, i) => (
                    <CopyBlock key={i} text={entry.text} what={`citation: ${product.title}`}>
                      <p data-testid="citation">{entry.text}</p>
                      <p className="mt-1 flex flex-wrap gap-3 text-xs">
                        {entry.links.map((l) => <ExternalLink key={l.href + l.label} href={l.href}>{l.label}</ExternalLink>)}
                      </p>
                    </CopyBlock>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ))}
    </PageShell>
  )
}
