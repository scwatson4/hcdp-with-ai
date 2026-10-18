// The portal's structure, mirrored. Internal routes are replicated pages;
// `external` entries open the real page on www.hawaii.edu in a new tab.
import { handoffUrl } from './handoff'

export const HCDP = 'https://www.hawaii.edu/climate-data-portal'

// The door to the AI data analysis tool (the separate HCDP AI interface): the same label on
// the landing sidebar's sixth button, the Climate Tools tile and the viewer's rail button —
// always external, outlined in the logo's spectrum rather than a solid portal colour (T1 picks
// A, 2026-10-08 — the user dropped D on 12 Oct: no header-menu entry; the label reads exactly
// "AI Data Analysis Tool", one line, no arrow).
export const AI_TOOL = { label: 'AI Data Analysis Tool', href: handoffUrl({}) }

// HCDP's own menu, item for item (its header on 13 Oct 2026); every entry is a page this site mirrors (or, for Access
// Data, its native page), so nothing here leaves the site (CONTRACT.md "Mirrored pages", 14 Oct).
export const NAV = [
  { label: 'Home', to: '/' },
  { label: 'About', items: [
    { label: 'Team', to: '/about/team' },
    { label: 'HCDP History', to: '/about/history' },
    { label: 'Rainfall Mapping History', to: '/about/rainfall-mapping-history' },
    { label: 'Climate Monitoring History', to: '/about/climate-monitoring-history' },
    { label: 'Acknowledgements', to: '/about/acknowledgements' },
    { label: 'How to Cite', to: '/about/how-to-cite' },
  ] },
  { label: 'Data Portal', items: [
    { label: 'Access Data', to: '/data' },
    { label: 'HCDP / Hawaiʻi Mesonet API', to: '/data/api' },
    { label: 'Tutorials', to: '/data/tutorials' },
    { label: 'How to Cite', to: '/about/how-to-cite' },
  ] },
  { label: 'Cultural Resources', to: '/cultural-resources' },
  { label: 'Library', to: '/library' },
  { label: 'Research', items: [
    { label: 'Research Highlights', to: '/research/highlights' },
    { label: 'External Resources', to: '/research/external-resources' },
    { label: 'Presentations', to: '/research/presentations' },
  ] },
  { label: 'Climate Tools', to: '/tools' },
]

// The landing page's tool cards, in the portal's own order and words.
export const TOOL_CARDS = [
  { key: 'data', title: 'Access Data', to: '/data', blurb: 'Visualize Data: interactive maps of rainfall, temperature, drought, humidity, vegetation and fire risk, from 1920 to yesterday. Export Data: grids, station data and metadata.', icon: 'Map' },
  { key: 'mesonet', title: 'Hawaiʻi Mesonet', to: '/mesonet', blurb: 'Live readings every five minutes from some eighty weather stations across the islands, plus American Samoa.', icon: 'RadioTower' },
  { key: 'summary', title: 'Climate Summary', to: '/climate-summary', blurb: 'The monthly Hawaiʻi climate report: rainfall and temperature by island, moku and watershed, with ranks against the record.', icon: 'CalendarDays' },
  { key: 'pacific', title: 'Pacific Portal', to: '/pacific', blurb: 'Climate data portals for American Samoa and Guam, and the Pacific Marine National Monuments stations.', icon: 'Globe2' },
  { key: 'events', title: 'Extreme Events', to: '/extreme-events', blurb: 'Storm trackers and reports: Tropical Storm Nolo, Hurricane Lowell, Hurricane Lala, the March Kona lows.', icon: 'CloudLightning' },
  { key: 'tools', title: 'Climate Tools', to: '/tools', blurb: 'The Rainfall Atlas, climate portfolios, rangeland drought, groundwater recharge, sea-level rise and more.', icon: 'Wrench' },
]

export const ATLASES = [
  { label: 'Rainfall Atlas of Hawaiʻi', external: 'https://rainfall.geography.hawaii.edu/' },
  { label: 'Evapotranspiration of Hawaiʻi', external: `${HCDP}/evapotranspiration-atlas` },
  { label: 'Solar Radiation of Hawaiʻi', external: `${HCDP}/solar-radiation-atlas/` },
  { label: 'Climate of Hawaiʻi', external: `${HCDP}/climate-atlas` },
]

// The portal home page's sidebar, as listed by the project lead (2026-09-25).
export const SIDEBAR = {
  // The portal's five buttons in its order, recoloured with the logo's spectrum (globals.css --hcdp-rainbow),
  // one shade deeper each so white type stays legible; linked to this site's pages where it has them.
  buttons: [
    { label: "Access Data", to: "/data", href: "https://www.hawaii.edu/climate-data-portal/data-portal/", color: "#357c78", tip: "Visualize Data or Export Data: rainfall, temperature, drought, humidity, vegetation and fire-risk maps, 1920 to yesterday, and their files." },
    { label: "Hawaiʻi Mesonet", to: "/mesonet", href: "https://www.hawaii.edu/climate-data-portal/hawaii-mesonet/", color: "#4f7a30", tip: "Live readings every five minutes from about eighty stations across the islands and American Samoa." },
    { label: "Climate Summary", to: "/climate-summary", href: "https://www.hawaii.edu/climate-data-portal/climate-summary/", color: "#a85a1c", tip: "The monthly climate report: rainfall and temperature by island, moku and watershed, ranked against the record." },
    { label: "Pacific Portal", to: "/pacific", href: "https://www.hawaii.edu/climate-data-portal/pacific-portal/", color: "#303078", tip: "Climate data for American Samoa, Guam and the Pacific Marine National Monuments." },
    { label: "Extreme Events", to: "/extreme-events", href: "https://www.hawaii.edu/climate-data-portal/extreme-event/", color: "#b8452f", tip: "Storm trackers and reports: Tropical Storm Nolo, Hurricane Lowell, Hurricane Lala, the March Kona lows." },
    // The sixth button: white with the 1.5 px rainbow border, dark type, opens the AI interface in a new tab.
    { label: AI_TOOL.label, href: AI_TOOL.href, ai: true, tip: "Ask about HCDP’s data in plain English and get charts, maps and analysis. Opens in a new tab." },
  ],
  resources: [
    { label: 'Rainfall Atlas of Hawaiʻi', href: `${HCDP}/rainfall-atlas` },
    { label: 'Evapotranspiration of Hawaiʻi', href: `${HCDP}/evapotranspiration-atlas` },
    { label: 'Solar Radiation of Hawaiʻi', href: `${HCDP}/solar-radiation-atlas/` },
    { label: 'Climate of Hawaiʻi', href: `${HCDP}/climate-atlas` },
    { label: 'American Samoa Climate Data Portal', href: `${HCDP}/americansamoaportal/` },
    { label: 'Guam Data Viewer', href: `${HCDP}/guam-data-viewer/` },
  ],
  social: [{ label: 'Instagram', href: 'https://www.instagram.com/hiclimateportal/' }],
  cite: { label: 'How To Cite', to: '/about/how-to-cite', href: `${HCDP}/how-to-cite-3/` },
  contact: { label: 'hcdp@hawaii.edu', href: 'mailto:hcdp@hawaii.edu' },
}
