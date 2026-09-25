// The portal's structure, mirrored. Internal routes are replicated pages;
// `external` entries open the real page on www.hawaii.edu in a new tab.
export const HCDP = 'https://www.hawaii.edu/climate-data-portal'

export const NAV = [
  { label: 'Home', to: '/' },
  { label: 'About', items: [
    { label: 'Team', to: '/about/team' },
    { label: 'HCDP History', to: '/about/history' },
    { label: 'Rainfall Mapping History', external: `${HCDP}/rainfall-mapping-history/` },
    { label: 'Climate Monitoring History', external: `${HCDP}/climate-monitoring-history/` },
    { label: 'Acknowledgements', to: '/about/acknowledgements' },
    { label: 'How to Cite', to: '/about/how-to-cite' },
  ] },
  { label: 'Data Portal', items: [
    { label: 'Access Data', to: '/data' },
    { label: 'HCDP / Hawaiʻi Mesonet API', to: '/data/api' },
    { label: 'Tutorials', to: '/data/tutorials' },
    { label: 'How to Cite', to: '/about/how-to-cite' },
    { label: 'Cultural Resources', external: `${HCDP}/news/` },
    { label: 'Library', external: `${HCDP}/publications-list/` },
  ] },
  { label: 'Cultural Resources', external: `${HCDP}/news/` },
  { label: 'Library', external: `${HCDP}/publications-list/` },
  { label: 'Research', items: [
    { label: 'Research Highlights', external: `${HCDP}/research-highlights/` },
    { label: 'External Resources', external: `${HCDP}/contact/` },
    { label: 'Presentations', external: `${HCDP}/presentations/` },
  ] },
  { label: 'Climate Tools', to: '/tools' },
]

// The landing page's tool cards, in the portal's own order and words.
export const TOOL_CARDS = [
  { key: 'data', title: 'Access Data', to: '/data', blurb: 'Interactive maps of rainfall, temperature, drought, humidity, vegetation and fire risk, from 1920 to yesterday. Download grids, station data and metadata.', icon: 'Map' },
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
