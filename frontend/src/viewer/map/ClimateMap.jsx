// The Leaflet map of the climate viewer: the HCDP portal's basemap, one
// GeoTIFF drawn in the browser with georaster-layer-for-leaflet, Leaflet's
// scale bar, and the two-way sync between the map view and the URL
// (?lat=&lng=&z=). Loaded lazily by ViewerPage so pages without a map never
// download Leaflet. Title card, legend and compass are drawn by the page on
// top of this component (they do not need Leaflet).

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, ScaleControl, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { EXTENT_BOUNDS, extentView } from './viewerModel'

// The HCDP portal's default basemap, as the AI interface draws it
// (HawaiiMap.jsx TILE_LAYERS.hybrid): Google's hybrid imagery with Google's
// own labels — the deep-blue ocean and the island and town names people
// know from the portal. `basemap-photo` keeps the dark theme from
// inverting the imagery (see globals.css).
export const BASEMAP = {
  url: 'https://www.google.com/maps/vt?lyrs=y@189&gl=en&x={x}&y={y}&z={z}',
  maxZoom: 20,
  attribution: 'Map data &copy; Google',
}

const DATA_PANE = 'climate-data'
const round4 = (n) => Number(n.toFixed(4))
const keyOf = (v) => (v ? `${v.lat.toFixed(4)},${v.lng.toFixed(4)},${Math.round(v.z)}` : '')

function mapView(map) {
  const c = map.getCenter()
  return { lat: round4(c.lat), lng: round4(c.lng), z: Math.round(map.getZoom()) }
}

/** The extent's own view (urlGrammar EXTENTS), zoomed out as far as needed
 *  for the whole island to fit this map's size. */
export function defaultView(map, extent) {
  const base = extentView(extent)
  let z = base.z
  try {
    const fit = map.getBoundsZoom(EXTENT_BOUNDS[extent] || EXTENT_BOUNDS.statewide, false, [8, 8])
    if (Number.isFinite(fit)) z = Math.max(5, Math.min(z, fit))
  } catch { /* no size yet */ }
  return { ...base, z }
}

function viewFromUrl(view, extent, map) {
  if (view && Number.isFinite(view.lat) && Number.isFinite(view.lng)) {
    const z = Number.isFinite(view.z) ? Math.round(view.z) : (map ? defaultView(map, extent).z : extentView(extent).z)
    return { lat: view.lat, lng: view.lng, z }
  }
  return map ? defaultView(map, extent) : extentView(extent)
}

/** URL → map when the address changes (extent picked, back button, a pasted
 *  link); map → URL (debounced) when the visitor pans or zooms. A move the
 *  URL itself caused is recognised by its key and never written back. */
function ViewSync({ extent, view, onViewChange }) {
  const map = useMap()
  const applied = useRef('')
  const timer = useRef(null)
  const cb = useRef(onViewChange)
  cb.current = onViewChange

  useEffect(() => {
    clearTimeout(timer.current)
    const target = viewFromUrl(view, extent, map)
    const here = mapView(map)
    applied.current = keyOf(target)
    if (keyOf(here) !== keyOf(target)) map.setView([target.lat, target.lng], target.z, { animate: false })
  }, [map, extent, view?.lat, view?.lng, view?.z])

  useMapEvents({
    moveend() {
      clearTimeout(timer.current)
      const here = mapView(map)
      if (keyOf(here) === applied.current) return
      timer.current = setTimeout(() => {
        applied.current = keyOf(here)
        cb.current?.(here)
      }, 400)
    },
  })
  useEffect(() => () => clearTimeout(timer.current), [])
  return null
}

/** Lockstep pan/zoom between the two maps of a side-by-side comparison (the
 *  AI interface's MapSync, reduced to a leader and a follower). The leader
 *  is the map that owns the URL view: a follower adopts the leader's view
 *  when it arrives, and a leader arriving second pulls the follower to
 *  itself, so the address never picks up a view nobody chose. */
function PeerSync({ bus, leader }) {
  const map = useMap()
  useEffect(() => {
    if (!bus || typeof map?.on !== 'function') return undefined
    const settle = () => setTimeout(() => { bus.guard = false }, 60)
    const push = (from, to) => { bus.guard = true; to.setView(from.getCenter(), from.getZoom(), { animate: false }); settle() }
    bus.maps.add(map)
    if (leader) {
      bus.leader = map
      bus.maps.forEach((peer) => { if (peer !== map) push(map, peer) })
    } else if (bus.leader && bus.leader !== map) {
      push(bus.leader, map)
    }
    const onMove = () => {
      if (bus.guard) return
      bus.maps.forEach((peer) => { if (peer !== map) push(map, peer) })
    }
    map.on('moveend', onMove)
    return () => {
      map.off('moveend', onMove)
      bus.maps.delete(map)
      if (bus.leader === map) bus.leader = null
    }
  }, [bus, map, leader])
  return null
}

/** Leaflet measures its container once; follow resizes (rotation, rail). */
function AutoResize() {
  const map = useMap()
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || typeof map?.getContainer !== 'function') return undefined
    let frame = null
    const ro = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { frame = null; map.invalidateSize({ pan: false }) })
    })
    ro.observe(map.getContainer())
    return () => { ro.disconnect(); if (frame) cancelAnimationFrame(frame) }
  }, [map])
  return null
}

/** Climate data gets its own pane above the basemap (z 300) so the dark
 *  theme's basemap filter never touches the data colours. */
function DataPane({ children }) {
  const map = useMap()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!map.getPane(DATA_PANE)) map.createPane(DATA_PANE).style.zIndex = 300
    setReady(true)
  }, [map])
  return ready ? children : null
}

/** react-leaflet has no GeoRasterLayer: add and remove it by hand. Parsing
 *  is done already, so a new ramp or scale only rebuilds the layer. */
function GeoRasterLeafletLayer({ georaster, colorFn, opacity }) {
  const map = useMap()
  const layerRef = useRef(null)

  useEffect(() => {
    if (!georaster || !colorFn) return undefined
    let alive = true
    ;(async () => {
      const { default: GeoRasterLayer } = await import('georaster-layer-for-leaflet')
      if (!alive) return
      const layer = new GeoRasterLayer({
        georaster,
        opacity,
        resolution: 256,
        pixelValuesToColorFn: colorFn,
        pane: DATA_PANE,
        updateWhenZooming: false,
        keepBuffer: 4,
      })
      // georaster-layer-for-leaflet 4.x keeps its rendered-tile cache on the
      // PROTOTYPE (`cache: {}` in L.GridLayer.extend), keyed only by
      // z/x/y:resolution — so a new layer for another date or dataset would
      // re-serve the previous layer's tiles. clearCache() gives this layer
      // its own cache.
      layer.clearCache?.()
      layer.addTo(map)
      layerRef.current = layer
    })()
    return () => {
      alive = false
      if (layerRef.current) {
        try { map.removeLayer(layerRef.current) } catch { /* map gone */ }
        layerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, georaster, colorFn])

  useEffect(() => { layerRef.current?.setOpacity?.(opacity) }, [opacity])
  return null
}

/** Hover (rAF-throttled) and tap/click positions for the value readout. */
function PointerProbe({ onHover, onPick }) {
  const raf = useRef(0)
  useMapEvents({
    mousemove(e) {
      cancelAnimationFrame(raf.current)
      const { lat, lng } = e.latlng
      raf.current = requestAnimationFrame(() => onHover?.({ lat, lng }))
    },
    mouseout() { cancelAnimationFrame(raf.current); onHover?.(null) },
    click(e) { onPick?.({ lat: e.latlng.lat, lng: e.latlng.lng }) },
  })
  return null
}

function ClimateMap({ extent, view = null, onViewChange = null, georaster = null, colorFn = null, opacity = 0.75, onHover = null, onPick = null, syncBus = null, leader = false }) {
  // MapContainer reads center/zoom once; ViewSync owns the view after that.
  const initial = useMemo(() => viewFromUrl(view, extent, null), []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <MapContainer
      center={[initial.lat, initial.lng]}
      zoom={initial.z}
      scrollWheelZoom
      attributionControl={false}
      className="h-full w-full"
    >
      <AutoResize />
      <TileLayer url={BASEMAP.url} maxZoom={BASEMAP.maxZoom} attribution={BASEMAP.attribution} className="basemap-photo" />
      <DataPane>
        <GeoRasterLeafletLayer georaster={georaster} colorFn={colorFn} opacity={opacity} />
      </DataPane>
      {/* The portal's scale control (bottom-left, metric + imperial) with
          the AI interface's shorter bar. */}
      <ScaleControl position="bottomleft" imperial metric maxWidth={120} />
      {onViewChange && <ViewSync extent={extent} view={view} onViewChange={onViewChange} />}
      {syncBus && <PeerSync bus={syncBus} leader={leader} />}
      <PointerProbe onHover={onHover} onPick={onPick} />
    </MapContainer>
  )
}

export default memo(ClimateMap)
