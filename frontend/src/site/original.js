// Every page on this site links to its "Original HCDP version": the page on
// www.hawaii.edu/climate-data-portal that carries the same content. HCDP has no
// shareable, customizable URLs, so many of our URLs map to one of theirs — every
// viewer link maps to the data portal, every station view to the Mesonet viewer.
export const HCDP = 'https://www.hawaii.edu/climate-data-portal'
// The portal's Access Data app (framed by the portal page). Its inbound dataset tags, by our viewer slug.
export const PORTAL_APP = 'https://rainfall.ikewai.org'
export const PORTAL_DATATYPE = {
  rainfall: 'rainfall', 'rainfall-legacy': 'legacy_rainfall', 'temperature-max': 'max_temp', 'temperature-min': 'min_temp', 'temperature-mean': 'mean_temp',
  humidity: 'rh', ndvi: 'ndvi', ignition: 'ignition_probability', 'ignition-lead-1': 'ignition_probability', 'ignition-lead-2': 'ignition_probability', 'ignition-lead-3': 'ignition_probability',
  ...Object.fromEntries([1, 3, 6, 9, 12, 24, 36, 48, 60].map((n) => [`spi-${n}`, 'spi'])),
}

const STORM_PAGES = {
  lowell: `${HCDP}/hurricane-lowell/`,
  lala: `${HCDP}/hurricane-lala/`,
  nolo: `${HCDP}/nolo-mesonet-viewer/`,
  'kona-low-1': `${HCDP}/2026-kona-low-1/`,
  'kona-low-2': `${HCDP}/2026-kona-low-2/`,
  'kona-lows': `${HCDP}/extreme-events/`,
}

const STATIC = {
  '/': `${HCDP}/`,
  '/about': `${HCDP}/2339-2/`,
  '/about/team': `${HCDP}/team/`,
  '/about/history': `${HCDP}/2339-2/`,
  '/about/acknowledgements': `${HCDP}/acknowledgements/`,
  '/about/how-to-cite': `${HCDP}/how-to-cite-3/`,
  '/data': `${HCDP}/data-portal/`,
  '/data/api': `${HCDP}/hcdp-hawaii-mesonet-api/`,
  '/data/tutorials': `${HCDP}/tutorials/`,
  '/mesonet': `${HCDP}/hawaii-mesonet/`,
  '/climate-summary': `${HCDP}/climate-summary/`,
  '/pacific': `${HCDP}/pacific-portal/`,
  '/extreme-events': `${HCDP}/extreme-events/`,
  '/tools': `${HCDP}/climate-tools/`,
}

/** The original HCDP URL for a location on this site, and a short label of what it is. */
export function originalFor(pathname, search = '', hash = '') {
  const q = new URLSearchParams(search)
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path.startsWith('/viewer')) {
    // The original app reads ?datatype and ?period once on load (and skips its landing tiles when a
    // query string is present); nothing else — date, place, camera and layers — can be passed to it.
    const seg = path.split('/').filter(Boolean)
    const tag = PORTAL_DATATYPE[seg[1]]
    const period = seg[2] === 'day' || seg[2] === 'month' ? seg[2] : null
    if (tag) return { url: `${PORTAL_APP}/?datatype=${tag}${period ? `&period=${period}` : ''}`, label: 'this dataset in the HCDP data portal', note: 'the portal opens the dataset; the date, place and view cannot be passed' }
    return { url: `${HCDP}/data-portal/`, label: 'HCDP data portal', note: 'the portal cannot open a specific map from a link' }
  }
  if (path === '/mesonet') {
    const viewer = q.get('viewer') || 'live'
    const station = q.get('station')
    const view = q.get('view') || 'dashboard'
    if (viewer === 'live' && (station || q.get('view'))) {
      return { url: `${HCDP}/hawaii-mesonet-data/#/${view}${station ? `?id=${encodeURIComponent(station)}` : ''}`, label: 'Mesonet viewer on HCDP' }
    }
    if (viewer === 'app') return { url: station ? `https://hawaiimesonet.app/station/${encodeURIComponent(station)}` : 'https://hawaiimesonet.app/', label: 'Hawaiʻi Mesonet app' }
    if (viewer === 'nolo') return { url: `${HCDP}/nolo-mesonet-viewer/`, label: 'Nolo Mesonet Viewer on HCDP' }
    return { url: STATIC['/mesonet'], label: 'Hawaiʻi Mesonet on HCDP' }
  }
  if (path === '/climate-summary') {
    const y = q.get('year'); const m = q.get('month')
    if (y && m) return { url: `https://cherryleh.github.io/climate-summary/#/?year=${encodeURIComponent(y)}&month=${encodeURIComponent(m)}`, label: 'Monthly Climate Summary app' }
    return { url: STATIC['/climate-summary'], label: 'Climate Summary on HCDP' }
  }
  const storm = path.match(/^\/extreme-events\/([a-z0-9-]+)$/)?.[1] || (path === '/extreme-events' && hash ? hash.replace('#', '') : null)
  if (storm && STORM_PAGES[storm]) return { url: STORM_PAGES[storm], label: 'this storm on HCDP' }
  if (path.startsWith('/extreme-events')) return { url: STATIC['/extreme-events'], label: 'Extreme Events on HCDP' }
  if (path.startsWith('/tools')) return { url: STATIC['/tools'], label: 'Climate Tools on HCDP' }
  if (STATIC[path]) return { url: STATIC[path], label: path === '/' ? 'HCDP home page' : 'this page on HCDP' }
  return { url: `${HCDP}/`, label: 'HCDP' }
}
