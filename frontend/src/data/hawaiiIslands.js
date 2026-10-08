/**
 * Hawaiian Islands geographic data for the interactive map.
 * Bounding boxes, centers, simplified GeoJSON outlines, and HCDP API extent codes.
 */

// Island bounding boxes: [[south, west], [north, east]]
export const ISLAND_BOUNDS = {
  oahu:       [[21.22, -158.30], [21.75, -157.62]],
  maui:       [[20.55, -156.70], [21.05, -155.95]],
  big_island: [[18.90, -156.10], [20.25, -154.75]],
  kauai:      [[21.85, -159.80], [22.25, -159.25]],
  molokai:    [[21.03, -157.35], [21.25, -156.68]],
  lanai:      [[20.70, -157.10], [20.95, -156.80]],
  all:        [[18.90, -160.30], [22.30, -154.70]],
}

// Island center points and default zoom levels
export const ISLAND_CENTERS = {
  oahu:       { center: [21.47, -157.97], zoom: 11 },
  maui:       { center: [20.80, -156.33], zoom: 10 },
  big_island: { center: [19.60, -155.45], zoom: 9 },
  kauai:      { center: [22.05, -159.53], zoom: 11 },
  molokai:    { center: [21.14, -157.02], zoom: 11 },
  lanai:      { center: [20.83, -156.92], zoom: 12 },
  all:        { center: [20.5, -157.5], zoom: 7 },
}

// HCDP API extent codes → island names
export const EXTENT_TO_ISLAND = {
  oa: 'oahu',
  ka: 'kauai',
  mn: 'maui',
  bi: 'big_island',
  mo: 'molokai',
  la: 'lanai',
  hi: 'all',
}

export const ISLAND_TO_EXTENT = {
  oahu: 'oa',
  kauai: 'ka',
  maui: 'mn',
  big_island: 'bi',
  molokai: 'mo',
  lanai: 'la',
  all: 'hi',
}

// Display names
export const ISLAND_DISPLAY_NAMES = {
  oahu: 'Oahu',
  maui: 'Maui',
  big_island: 'Big Island',
  kauai: 'Kauai',
  molokai: 'Molokai',
  lanai: 'Lanai',
  all: 'All Islands',
}

// Aliases used by the AI to resolve island names
export const ISLAND_ALIASES = {
  'hawaii': 'big_island',
  'hawaii island': 'big_island',
  'big island': 'big_island',
  "hawai'i": 'big_island',
  "hawai'i island": 'big_island',
  'honolulu': 'oahu',
  'oahu': 'oahu',
  "o'ahu": 'oahu',
  'maui': 'maui',
  'kauai': 'kauai',
  "kaua'i": 'kauai',
  'molokai': 'molokai',
  "moloka'i": 'molokai',
  'lanai': 'lanai',
  "lana'i": 'lanai',
}

// GeoJSON outlines for island click detection and highlighting.
// Higher-fidelity polygons that closely follow actual coastlines.
export const ISLAND_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { island: 'big_island', name: 'Big Island' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-155.58, 20.25], [-155.50, 20.21], [-155.44, 20.17], [-155.38, 20.12],
          [-155.27, 20.08], [-155.16, 20.02], [-155.08, 19.97], [-155.03, 19.90],
          [-154.97, 19.82], [-154.95, 19.73], [-154.95, 19.63], [-154.97, 19.53],
          [-155.00, 19.48], [-155.06, 19.42], [-155.10, 19.35], [-155.16, 19.28],
          [-155.24, 19.22], [-155.32, 19.17], [-155.42, 19.08], [-155.50, 19.00],
          [-155.58, 18.94], [-155.66, 18.92], [-155.75, 18.91], [-155.82, 18.91],
          [-155.88, 18.93], [-155.94, 18.97], [-156.00, 19.04], [-156.05, 19.12],
          [-156.07, 19.22], [-156.06, 19.33], [-156.04, 19.43], [-156.02, 19.52],
          [-156.00, 19.62], [-155.99, 19.72], [-155.98, 19.78], [-155.98, 19.85],
          [-155.96, 19.92], [-155.92, 19.98], [-155.88, 20.02], [-155.84, 20.08],
          [-155.80, 20.12], [-155.76, 20.16], [-155.72, 20.20], [-155.66, 20.24],
          [-155.58, 20.25],
        ]],
      },
    },
    {
      type: 'Feature',
      properties: { island: 'maui', name: 'Maui' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          // West Maui
          [-156.69, 20.95], [-156.62, 20.97], [-156.55, 20.96], [-156.48, 20.93],
          [-156.42, 20.93], [-156.37, 20.92],
          // Isthmus + East Maui
          [-156.34, 20.90], [-156.28, 20.88], [-156.22, 20.88], [-156.16, 20.90],
          [-156.10, 20.92], [-156.05, 20.91], [-156.00, 20.87], [-155.98, 20.82],
          [-155.98, 20.77], [-156.00, 20.72], [-156.02, 20.67], [-156.06, 20.63],
          [-156.12, 20.59], [-156.18, 20.58], [-156.25, 20.58], [-156.32, 20.59],
          [-156.38, 20.61], [-156.44, 20.63], [-156.48, 20.65],
          // Back up west side
          [-156.52, 20.68], [-156.58, 20.72], [-156.64, 20.77], [-156.68, 20.82],
          [-156.70, 20.87], [-156.70, 20.92], [-156.69, 20.95],
        ]],
      },
    },
    {
      type: 'Feature',
      properties: { island: 'oahu', name: 'Oahu' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          // North shore
          [-158.10, 21.58], [-158.03, 21.60], [-157.97, 21.60], [-157.90, 21.59],
          [-157.83, 21.58], [-157.78, 21.57], [-157.73, 21.56],
          // East side
          [-157.68, 21.53], [-157.65, 21.49], [-157.64, 21.44], [-157.65, 21.39],
          [-157.66, 21.34], [-157.68, 21.30], [-157.70, 21.27],
          // South shore
          [-157.74, 21.26], [-157.79, 21.26], [-157.84, 21.27], [-157.90, 21.27],
          [-157.95, 21.27], [-158.00, 21.28],
          // West side / Waianae
          [-158.08, 21.30], [-158.12, 21.33], [-158.16, 21.37], [-158.19, 21.42],
          [-158.23, 21.46], [-158.27, 21.50], [-158.28, 21.54], [-158.25, 21.57],
          [-158.20, 21.58], [-158.15, 21.58], [-158.10, 21.58],
        ]],
      },
    },
    {
      type: 'Feature',
      properties: { island: 'kauai', name: 'Kauai' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-159.45, 22.24], [-159.38, 22.24], [-159.33, 22.23], [-159.29, 22.20],
          [-159.28, 22.16], [-159.28, 22.12], [-159.29, 22.08], [-159.30, 22.04],
          [-159.32, 22.00], [-159.35, 21.97], [-159.39, 21.95], [-159.44, 21.93],
          [-159.50, 21.92], [-159.56, 21.93], [-159.61, 21.95], [-159.66, 21.98],
          [-159.70, 22.02], [-159.73, 22.06], [-159.75, 22.10], [-159.75, 22.14],
          [-159.73, 22.17], [-159.70, 22.20], [-159.65, 22.22], [-159.59, 22.23],
          [-159.53, 22.24], [-159.45, 22.24],
        ]],
      },
    },
    {
      type: 'Feature',
      properties: { island: 'molokai', name: 'Molokai' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          // Elongated east-west shape
          [-157.31, 21.20], [-157.25, 21.21], [-157.18, 21.21], [-157.10, 21.20],
          [-157.02, 21.18], [-156.93, 21.14], [-156.85, 21.10], [-156.78, 21.07],
          [-156.72, 21.05], [-156.69, 21.03],
          // South coast
          [-156.70, 21.01], [-156.74, 20.99], [-156.80, 20.98], [-156.88, 20.98],
          [-156.96, 20.99], [-157.04, 21.02], [-157.10, 21.05], [-157.18, 21.08],
          [-157.24, 21.11], [-157.30, 21.14], [-157.33, 21.17], [-157.31, 21.20],
        ]],
      },
    },
    {
      type: 'Feature',
      properties: { island: 'lanai', name: 'Lanai' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-156.92, 20.92], [-156.87, 20.91], [-156.83, 20.89], [-156.81, 20.86],
          [-156.80, 20.83], [-156.80, 20.80], [-156.81, 20.77], [-156.83, 20.74],
          [-156.86, 20.73], [-156.90, 20.73], [-156.94, 20.74], [-156.97, 20.76],
          [-156.99, 20.79], [-157.00, 20.82], [-157.00, 20.85], [-156.98, 20.88],
          [-156.96, 20.90], [-156.92, 20.92],
        ]],
      },
    },
  ],
}

// Color ramps for climate data overlays.
// Cross-system reference: shared/style_presets.json mirrors these stops (pinned
// by tests on both sides — frontend colormaps.test + backend
// test_colormap_presets) and the QGIS side reads it; keep them in sync.
// `rainfall` here is the distinct "rainfall blues" scheme selectable in the
// colormap picker. Rainfall maps DEFAULT to HCDP's viridis_r (see
// DEFAULT_COLORMAP_BY_DATATYPE in rasterSpec.js), not this ramp.
export const CLIMATE_COLOR_RAMPS = {
  // "Rainfall blues", re-oriented to match HCDP's semantic convention
  // (warm = dry at 0 → deep blue = wet at max; the portal's own maps put
  // orange at zero — see reference/hcdp-instagram/). Same palette as the
  // original scheme, direction flipped so no surface can read inverted
  // beside an official HCDP map.
  rainfall: [
    [0, '#f97316'],
    [0.2, '#10b981'],
    [0.4, '#06b6d4'],
    [0.6, '#0ea5e9'],
    [0.8, '#0e7490'],
    [1.0, '#1e3a5f'],
  ],
  temperature: [
    [0, '#1e3a5f'],
    [0.2, '#6366f1'],
    [0.4, '#8b5cf6'],
    [0.6, '#f43f5e'],
    [0.8, '#f97316'],
    [1.0, '#fbbf24'],
  ],
}

// Helper: resolve any island name/alias to canonical key.
// Normalizes Hawaiian orthography first — ʻokina (U+02BB) and curly quotes
// become ASCII apostrophes and macrons are stripped — so display names like
// "Hawaiʻi Island", "Lānaʻi", or "Oʻahu" resolve the same as their ASCII forms.
export function resolveIslandName(name) {
  if (!name) return null
  const lower = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // strip combining diacritics (ā → a)
    .replace(/[ʻ’‘`]/g, "'")
    .trim()
  if (ISLAND_BOUNDS[lower]) return lower
  return ISLAND_ALIASES[lower] || null
}
