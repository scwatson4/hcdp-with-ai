import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Wrench, CloudRain, Globe2, Map as MapIcon, Sun, Leaf, BookOpen } from 'lucide-react'
import { AI_TOOL, HCDP } from '../../site/nav'
import { PageShell, Section } from './PageShell'
import ExternalLink from './ExternalLink'
import { ToolTileGrid } from './ToolTiles'
import { TOOL_IMAGES } from './toolImages'
import { sectionRelated } from './contentUtils'

// Climate Tools — https://www.hawaii.edu/climate-data-portal/climate-tools/
// The portal's picture buttons in its order and words: rows of three with no
// group headings, then "Avian Malaria-Risk & Warning (Coming soon)" alone in
// the middle of a fourth row, with no link. The pictures live in toolImages.js
// (shared with the assistant's did-you-mean tiles, R5 C), keyed by the tool's slug.

const TOOLS = [
  { name: 'Rainfall Atlas of Hawaiʻi', caption: 'Visualize rainfall across the state.', href: 'https://rainfall.geography.hawaii.edu/', image: TOOL_IMAGES['rainfall-atlas'], shade: 'navy' },
  { name: 'CCVD Portfolios', caption: 'Generate a climate portfolio for anywhere in Hawaiʻi.', href: 'https://ccvd.manoa.hawaii.edu/', image: TOOL_IMAGES['ccvd-portfolios'], shade: 'navy' },
  { name: 'Hawaiʻi Rangeland Information Portal (H-RIP)', caption: 'View drought and rainfall conditions for ranches in Hawaiʻi.', href: 'http://hrip.manoa.hawaii.edu/', image: TOOL_IMAGES['h-rip'], shade: 'navy' },
  { name: 'Hawaiʻi Groundwater Recharge Tool', caption: 'Explore how changes in land cover and climate can affect groundwater recharge.', href: 'https://recharge.ikewai.org/#/workspace', image: TOOL_IMAGES['groundwater-recharge'], shade: 'blue' },
  { name: 'Hawaiʻi Monthly Climate Summary', caption: 'Receive monthly climate summaries for areas across the state.', href: `${HCDP}/climate-summary/#/`, image: TOOL_IMAGES['monthly-climate-summary'], shade: 'blue' },
  { name: 'State of Hawaiʻi Sea Level Rise Viewer', caption: 'Visualize potential sea level rise impacts in Hawaiʻi.', href: 'https://www.pacioos.hawaii.edu/shoreline/slr-hawaii/', image: TOOL_IMAGES['sea-level-rise-viewer'], shade: 'navy' },
  { name: 'American Samoa Data Viewer and Download', caption: 'Visualize and download climate data for American Samoa.', href: 'https://hcdp.github.io/ascdp/', image: TOOL_IMAGES['american-samoa-data-viewer'], shade: 'blue' },
  { name: 'SOEST Coastal Viewer', caption: 'View coastal data for Hawaiʻi.', href: 'https://www.soest.hawaii.edu/crc/slr-viewer/', image: TOOL_IMAGES['soest-coastal-viewer'], shade: 'blue' },
  { name: 'Climate of Hawaiʻi', caption: 'Download mean annual climate maps for Hawaiʻi.', href: `${HCDP}/climate-atlas/`, image: TOOL_IMAGES['climate-of-hawaii'], shade: 'blue' },
  // Ours, not the portal's (T1 D, 2026-10-08): the door to the AI data analysis tool, after the portal's nine
  // live tiles and before its coming-soon one. The picture is the AI interface's own sign-in page (captured
  // 2026-10-08, 3:2, 800 px); the spectrum outline marks it as AI.
  { name: AI_TOOL.label, caption: 'ask questions of the data', href: AI_TOOL.href, image: TOOL_IMAGES['ai-data-analysis'], shade: 'navy', ai: true },
  { name: 'Avian Malaria-Risk & Warning', soon: true, center: true, image: TOOL_IMAGES['avian-malaria'], shade: 'blue' },
]

// The portal's "Climate Resources" list (its home-page sidebar).

export default function ClimateTools() {
  const { slug } = useParams()
  useEffect(() => {
    if (!slug) return undefined
    const t = window.setTimeout(() => {
      const el = document.getElementById(`tool-${slug}`)
      // 13 Oct: when the assistant's AI overview tops the page, land on it (the tile is ringed below it); else centre the tile.
      const overview = document.querySelector('.hcdp-ai-summary')
      if (overview) overview.scrollIntoView({ block: 'start' }); else el?.scrollIntoView({ block: 'center' })
      el?.classList.add('ring-4', 'ring-accent'); setTimeout(() => el?.classList.remove('ring-4', 'ring-accent'), 2200)
    }, 80)
    return () => window.clearTimeout(t)
  }, [slug])
  return (
    <PageShell
      title="Climate Tools"
      icon={Wrench}
      source={`${HCDP}/climate-tools/`}
      lead={<p>Decision-support tools for Hawaiʻi and American Samoa, from rainfall and climate maps to ranch drought conditions, groundwater recharge and sea level rise.</p>}
      related={sectionRelated('/tools')}
      className="max-w-6xl"
    >
      <div>
        <ToolTileGrid tools={TOOLS} label="Climate tools" />
        <p className="mt-8 text-xs text-subtle" data-testid="image-credit">Images: Hawaiʻi Climate Data Portal; the AI Data Analysis Tool picture is the HCDP AI interface</p>
      </div>
    </PageShell>
  )
}
