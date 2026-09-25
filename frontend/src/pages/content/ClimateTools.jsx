import { Wrench, CloudRain, Globe2, Map as MapIcon, Sun, Leaf, BookOpen } from 'lucide-react'
import { HCDP } from '../../site/nav'
import { PageShell, Section } from './PageShell'
import ExternalLink from './ExternalLink'
import { ToolTileGrid } from './ToolTiles'
import { sectionRelated } from './contentUtils'

// Climate Tools — https://www.hawaii.edu/climate-data-portal/climate-tools/
// The portal's picture buttons in its order and words: rows of three with no
// group headings, then "Avian Malaria-Risk & Warning (Coming soon)" alone in
// the middle of a fourth row, with no link. The pictures are the portal's
// own, in public/tools/; the five over 400 KB were re-saved as optimized
// PNGs (their alpha channels were fully opaque) and the American Samoa
// screenshot scaled from 1817 to 1600 px wide. Width and height are the
// files' own, so the browser reserves the space before they load.

const img = (file, width, height) => ({ src: `/tools/${file}`, width, height })

const TOOLS = [
  { name: 'Rainfall Atlas of Hawaiʻi', caption: 'Visualize rainfall across the state.', href: 'https://rainfall.geography.hawaii.edu/', image: img('rainfall-atlas.jpg', 663, 500), shade: 'navy' },
  { name: 'CCVD Portfolios', caption: 'Generate a climate portfolio for anywhere in Hawaiʻi.', href: 'https://ccvd.manoa.hawaii.edu/', image: img('ccvd-portfolios.png', 800, 530), shade: 'navy' },
  { name: 'Hawaiʻi Rangeland Information Portal (H-RIP)', caption: 'View drought and rainfall conditions for ranches in Hawaiʻi.', href: 'http://hrip.manoa.hawaii.edu/', image: img('h-rip.jpg', 663, 500), shade: 'navy' },
  { name: 'Hawaiʻi Groundwater Recharge Tool', caption: 'Explore how changes in land cover and climate can affect groundwater recharge.', href: 'https://recharge.ikewai.org/#/workspace', image: img('groundwater-recharge.jpg', 663, 500), shade: 'blue' },
  { name: 'Hawaiʻi Monthly Climate Summary', caption: 'Receive monthly climate summaries for areas across the state.', href: `${HCDP}/climate-summary/#/`, image: img('monthly-climate-summary.png', 800, 406), shade: 'blue' },
  { name: 'State of Hawaiʻi Sea Level Rise Viewer', caption: 'Visualize potential sea level rise impacts in Hawaiʻi.', href: 'https://www.pacioos.hawaii.edu/shoreline/slr-hawaii/', image: img('sea-level-rise-viewer.png', 663, 500), shade: 'navy' },
  { name: 'American Samoa Data Viewer and Download', caption: 'Visualize and download climate data for American Samoa.', href: 'https://hcdp.github.io/ascdp/', image: img('american-samoa-data-viewer.png', 800, 395), shade: 'blue' },
  { name: 'SOEST Coastal Viewer', caption: 'View coastal data for Hawaiʻi.', href: 'https://www.soest.hawaii.edu/crc/slr-viewer/', image: img('soest-coastal-viewer.jpg', 663, 500), shade: 'blue' },
  { name: 'Climate of Hawaiʻi', caption: 'Download mean annual climate maps for Hawaiʻi.', href: `${HCDP}/climate-atlas/`, image: img('climate-of-hawaii.jpg', 663, 414), shade: 'blue' },
  { name: 'Avian Malaria-Risk & Warning', soon: true, center: true, image: img('avian-malaria.png', 301, 209), shade: 'blue' },
]

// The portal's "Climate Resources" list (its home-page sidebar).

export default function ClimateTools() {
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
        <p className="mt-8 text-xs text-subtle" data-testid="image-credit">Images: Hawaiʻi Climate Data Portal</p>
      </div>
    </PageShell>
  )
}
