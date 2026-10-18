// Access Data's two doors (18 Oct, the user: "'ACCESS DATA' should open to two options only: Visualize Data and Export
// Data (like in the screenshot of the original HCDP website)"). Visualize Data is this site's map viewer — /viewer/...,
// renamed for visitors — and /data/visualize is its door: it lands on the default map, the latest monthly rainfall map,
// statewide (the date rule: the last complete month in Hawaiʻi, computed at runtime). Export Data is /data/export.
import { formatViewerPath } from '../viewer/urlGrammar'
import { lastCompleteMonth } from '../pages/content/contentUtils'

export const VISUALIZE_PATH = '/data/visualize'
export const EXPORT_PATH = '/data/export'
export const VISUALIZE_LABEL = 'Visualize Data'
export const EXPORT_LABEL = 'Export Data'

/** The default map Visualize Data opens on: monthly rainfall, statewide, for the last complete month. */
export function defaultMapPath(now = new Date()) {
  return formatViewerPath({ dataset: 'rainfall', period: 'month', date: lastCompleteMonth(now), extent: 'statewide' })
}

/** An address the assistant or a link would open, with the Visualize Data door resolved to the map it lands on (so the
 *  answer's overview is asked for, and kept, under the map's own address). Anything else is returned as it is. */
export function resolveDoor(path, now = new Date()) {
  const s = String(path || '')
  const base = s.split('#')[0].split('?')[0].replace(/\/+$/, '')
  return base === VISUALIZE_PATH ? defaultMapPath(now) : s
}
