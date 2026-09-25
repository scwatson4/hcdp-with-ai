import { Link } from 'react-router-dom'
import { Wrench, CloudRain, FileText, Sprout, Droplets, CalendarDays, Waves, Globe2, Anchor, Map as MapIcon, Bird, Sun, Leaf, BookOpen } from 'lucide-react'
import { HCDP } from '../../site/nav'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageShell, Section } from './PageShell'
import ExternalLink from './ExternalLink'
import { sectionRelated } from './contentUtils'

// Climate Tools — https://www.hawaii.edu/climate-data-portal/climate-tools/
// The tools in the page's order and words. The page is one grid (rows of
// three) with no group headings; the portal groups its atlases and partner
// portals separately, under "Climate Resources" in its footer.

const TOOLS = [
  { name: 'Rainfall Atlas of Hawaiʻi', blurb: 'Visualize rainfall across the state.', href: 'https://rainfall.geography.hawaii.edu/', icon: CloudRain },
  { name: 'CCVD Portfolios', blurb: 'Generate a climate portfolio for anywhere in Hawaiʻi.', href: 'https://ccvd.manoa.hawaii.edu/', icon: FileText },
  { name: 'Hawaiʻi Rangeland Information Portal (H-RIP)', blurb: 'View drought and rainfall conditions for ranches in Hawaiʻi.', href: 'http://hrip.manoa.hawaii.edu/', icon: Sprout },
  { name: 'Hawaiʻi Groundwater Recharge Tool', blurb: 'Explore how changes in land cover and climate can affect groundwater recharge.', href: 'https://recharge.ikewai.org/#/workspace', icon: Droplets },
  { name: 'Hawaiʻi Monthly Climate Summary', blurb: 'Receive monthly climate summaries for areas across the state.', href: `${HCDP}/climate-summary/#/`, internal: '/climate-summary', icon: CalendarDays },
  { name: 'State of Hawaiʻi Sea Level Rise Viewer', blurb: 'Visualize potential sea level rise impacts in Hawaiʻi.', href: 'https://www.pacioos.hawaii.edu/shoreline/slr-hawaii/', icon: Waves },
  { name: 'American Samoa Data Viewer and Download', blurb: 'Visualize and download climate data for American Samoa.', href: 'https://hcdp.github.io/ascdp/', internal: '/pacific', icon: Globe2 },
  { name: 'SOEST Coastal Viewer', blurb: 'View coastal data for Hawaiʻi.', href: 'https://www.soest.hawaii.edu/crc/slr-viewer/', icon: Anchor },
  { name: 'Climate of Hawaiʻi', blurb: 'Download mean annual climate maps for Hawaiʻi.', href: `${HCDP}/climate-atlas/`, icon: MapIcon },
  { name: 'Avian Malaria-Risk & Warning', blurb: null, href: null, icon: Bird, soon: true },
]

// The portal footer's "Climate Resources" list.
const RESOURCES = [
  { name: 'Rainfall Atlas of Hawaiʻi', href: `${HCDP}/rainfall-atlas`, icon: CloudRain },
  { name: 'Evapotranspiration of Hawaiʻi', href: `${HCDP}/evapotranspiration-atlas`, icon: Leaf },
  { name: 'Solar Radiation of Hawaiʻi', href: `${HCDP}/solar-radiation-atlas/`, icon: Sun },
  { name: 'Climate of Hawaiʻi', href: `${HCDP}/climate-atlas`, icon: MapIcon },
  { name: 'American Samoa Climate Data Portal', href: `${HCDP}/americansamoaportal/`, internal: '/pacific', icon: Globe2 },
  { name: 'Guam Data Viewer', href: `${HCDP}/guam-data-viewer/`, internal: '/pacific#guam', icon: Globe2 },
]

function ToolCard({ tool }) {
  const Icon = tool.icon
  return (
    <Card className="flex h-full flex-col p-4" data-testid="tool">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"><Icon className="h-4 w-4" aria-hidden="true" /></span>
        <div className="min-w-0">
          <h3 className="font-display text-lg leading-tight">{tool.name}</h3>
          {tool.soon && <Badge variant="muted" className="mt-1">Coming soon</Badge>}
          {tool.blurb && <p className="mt-1 text-sm text-subtle">{tool.blurb}</p>}
        </div>
      </div>
      {tool.href && (
        <p className="mt-auto flex flex-wrap gap-x-3 pt-3 text-sm">
          <ExternalLink href={tool.href} className="font-medium">Open</ExternalLink>
          {tool.internal && <Link to={tool.internal} className="text-subtle underline-offset-2 hover:underline">More on this site</Link>}
        </p>
      )}
    </Card>
  )
}

export default function ClimateTools() {
  return (
    <PageShell
      title="Climate Tools"
      icon={Wrench}
      source={`${HCDP}/climate-tools/`}
      lead={<p>Decision-support tools for Hawaiʻi and American Samoa, from rainfall and climate maps to ranch drought conditions, groundwater recharge and sea level rise.</p>}
      related={sectionRelated('/tools')}
    >
      <Section id="tools" title="Tools">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((t) => <li key={t.name}><ToolCard tool={t} /></li>)}
        </ul>
      </Section>

      <Section id="resources" title="Climate resources" lead={<p>The atlases and partner portals the portal lists under Climate Resources.</p>}>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {RESOURCES.map((r) => (
            <li key={r.name} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
              <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              <div className="min-w-0 text-sm">
                <ExternalLink href={r.href} className="font-medium">{r.name}</ExternalLink>
                {r.internal && <Link to={r.internal} className="block text-xs text-subtle underline-offset-2 hover:underline">More on this site</Link>}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-start gap-2 text-sm text-subtle"><BookOpen className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>Citations for the atlases are on <Link className="underline" to="/about/how-to-cite#not-on-hcdp">How to Cite</Link>.</span></p>
      </Section>
    </PageShell>
  )
}
