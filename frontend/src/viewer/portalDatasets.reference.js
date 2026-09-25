/**
 * Per-dataset settings copied from the HCDP portal (github.com/HCDP/hcdp,
 * branch prod: dataset-form-manager.service.ts, leaflet-color-scale
 * component, date-manager.service.ts). One place for the title-card label,
 * the legend header, the fixed colour range with its "+"/"-" label rules,
 * and which way Viridis runs — so every map type reads like the portal's.
 */

const TEMP_AGG = { min: 'Minimum', max: 'Maximum', mean: 'Mean' }

/** The portal's settings for a spec's product, or null (derived rasters, unknown types). */
export function portalDataset(spec) {
  const dt = spec?.datatype
  const period = spec?.period === 'day' ? 'day' : 'month'   // month_to_date sums read on the monthly scale
  const cadence = period === 'day' ? 'Daily' : 'Monthly'
  switch (dt) {
    case 'rainfall':
      return period === 'day'
        ? { label: 'Daily Rainfall', datatypeLabel: 'Rainfall', units: 'mm', range: [0, 20], rangeAbsolute: [true, false], reverse: false, extreme: [0, 250] }
        : { label: 'Monthly Rainfall', datatypeLabel: 'Rainfall', units: 'mm', range: [0, 650], rangeAbsolute: [true, false], reverse: false }
    case 'temperature': {
      const agg = TEMP_AGG[spec?.aggregation] || 'Mean'
      return { label: `${cadence} ${agg} Temperature`, datatypeLabel: `${agg} Temperature`, units: '°C', range: [-10, 35], rangeAbsolute: [false, false], reverse: true }
    }
    case 'relative_humidity':
      return { label: 'Daily Relative Humidity', datatypeLabel: 'Relative Humidity', units: '%', range: [0, 100], rangeAbsolute: [true, true], reverse: false }
    case 'ndvi_modis':
      return { label: 'Normalized Difference Vegetation Index (NDVI)', datatypeLabel: 'Normalized Difference Vegetation Index (NDVI)', units: '', range: [-0.2, 1], rangeAbsolute: [false, true], reverse: false }
    case 'ignition_probability':
      return { label: 'Ignition Probability', datatypeLabel: 'Ignition Probability', units: '', range: [0, 1], rangeAbsolute: [true, true], reverse: true }
    case 'spi': {
      const n = Number(spec?.timescale) || 1
      const name = `${n}-Month Standardized Precipitation Index (SPI-${n})`
      return { label: name, datatypeLabel: name, units: '', range: [-3, 3], rangeAbsolute: [false, false], reverse: false }
    }
    default:
      return null
  }
}

/** The portal's default scheme for a product: its Viridis, oriented per dataset. */
export function portalSchemeFor(spec) {
  const ds = portalDataset(spec)
  return ds ? (ds.reverse ? 'viridis' : 'viridis_r') : null
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "September 02, 2026" for a day, "September, 2026" for a month (moment's
 *  "MMMM DD, YYYY" / "MMMM, YYYY" as the portal formats them); anything
 *  else (derived labels, 'latest') comes back verbatim. */
export function portalDateLabel(date) {
  const s = String(date ?? '')
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[3]}, ${m[1]}`
  m = /^(\d{4})-(\d{2})$/.exec(s)
  if (m) return `${MONTHS[Number(m[2]) - 1]}, ${m[1]}`
  return s
}

/** The two lines of the title card. Derived (QGIS / computed) rasters carry
 *  their own name and a label in dates[0]. */
export function portalTitle(spec, date) {
  const ds = portalDataset(spec)
  if (!ds) return { label: spec?.name || spec?.title || 'Map', dateLabel: date != null ? String(date) : '' }
  return { label: ds.label, dateLabel: portalDateLabel(date) }
}

/** "Rainfall (mm)" — the legend header (units in parentheses only when set). */
export function portalLegendHeader(spec, unitOverride) {
  const ds = portalDataset(spec)
  // A difference / Δ map is not the portal's product any more: its own label
  // ("Change vs previous month") must win over the dataset name.
  const own = spec?.mode === 'difference' || spec?.legend_label
  const name = own
    ? (spec?.legend_label || spec?.name || spec?.datatype || '')
    : (ds ? ds.datatypeLabel : (spec?.name || spec?.datatype || ''))
  const units = unitOverride !== undefined ? unitOverride : (ds ? ds.units : (spec?.units || ''))
  return units ? `${name} (${units})` : name
}

/** Five labels, top → bottom, exactly as leaflet-color-scale builds them:
 *  "+" before positive values, a "+" suffix on the top when the range is
 *  open above, a "-" suffix on the bottom when it is open below. */
export function portalLegendLabels(range, rangeAbsolute = [true, true], intervals = 5, fmt = null) {
  const [lo, hi] = range
  const parts = intervals - 1
  const step = (hi - lo) / parts
  const round2 = (v) => Math.round(v * 100) / 100
  const show = (v) => (fmt ? fmt(v) : round2(v).toLocaleString('en-US'))
  const out = []
  for (let i = 0; i < parts; i++) {
    const v = round2(hi - step * i)
    out.push((v > 0 ? '+' : '') + show(v))
  }
  out.push((lo > 0 ? '+' : '') + show(lo))
  if (rangeAbsolute && out.length > 1) {
    if (!rangeAbsolute[0]) out[out.length - 1] += '-'
    if (!rangeAbsolute[1]) out[0] += '+'
  }
  return out
}
