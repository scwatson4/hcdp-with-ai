// The viewer's base maps: the HCDP portal's five (as the AI interface's
// HawaiiMap.jsx TILE_LAYERS spells them — copied, not imported, so the
// viewer has no dependency on that app) plus a light grey canvas for
// screenshots and print. Keys are the URL's ?basemap= values
// (urlGrammar BASEMAP_KEYS); the portal's default, Google's hybrid imagery
// with its own labels, is the default and omitted from the URL.
//
// `photo` layers get the `basemap-photo` class: the dark theme darkens them
// instead of inverting them (an inverted satellite tile has a white ocean —
// see globals.css).

import { BASEMAP_KEYS, DEFAULT_BASEMAP } from '../urlGrammar'

export const BASEMAPS = {
  satellite: {
    label: 'Satellite (Google hybrid)',
    url: 'https://www.google.com/maps/vt?lyrs=y@189&gl=en&x={x}&y={y}&z={z}',
    maxZoom: 20,
    attribution: 'Map data &copy; Google',
    photo: true,
  },
  street: {
    label: 'Street (Google)',
    url: 'https://www.google.com/maps/vt?lyrs=m@221097413,traffic&x={x}&y={y}&z={z}',
    maxZoom: 20,
    attribution: 'Map data &copy; Google',
  },
  imagery: {
    label: 'Imagery (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri',
    photo: true,
  },
  topo: {
    label: 'Topographic (USGS)',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 16,
    attribution: 'Tiles &copy; U.S. Geological Survey',
  },
  relief: {
    label: 'Shaded relief (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 13,
    attribution: 'Tiles &copy; Esri',
  },
  light: {
    label: 'Light grey (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    maxNativeZoom: 16,
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri',
  },
}

export { DEFAULT_BASEMAP }

/** The base map for a ?basemap= value (the default for anything else). */
export function basemapFor(key) {
  return BASEMAPS[key] || BASEMAPS[DEFAULT_BASEMAP]
}

/** Options for the "Base map" select, in the grammar's order. */
export const BASEMAP_OPTIONS = BASEMAP_KEYS.map((key) => ({ value: key, label: BASEMAPS[key].label }))
