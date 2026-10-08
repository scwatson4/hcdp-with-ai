// The Leaflet map of the climate viewer: one of the HCDP portal's base maps
// (?basemap=), one GeoTIFF drawn in the browser with
// georaster-layer-for-leaflet at the URL's opacity, the island outlines
// (?layers=outline), Leaflet's scale bar, and the two-way sync between the
// map view and the URL (?lat=&lng=&z=). Loaded lazily by ViewerPage so pages
// without a map never download Leaflet. Title card, legend and compass are
// drawn by the page on top of this component (they do not need Leaflet).

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, GeoJSON, MapContainer, TileLayer, ScaleControl, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { DomEvent } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { EXTENT_BOUNDS, extentView } from './viewerModel'
import { BASEMAPS, DEFAULT_BASEMAP, basemapFor } from './basemaps'
import { ISLAND_GEOJSON } from '../../data/hawaiiIslands'

// The portal's default basemap (Google's hybrid imagery), kept under its old name.
export const BASEMAP = BASEMAPS[DEFAULT_BASEMAP]

const DATA_PANE = 'climate-data'
// Island outlines: a thin dark line, no fill, transparent to the pointer.
const OUTLINE_STYLE = { color: '#111', weight: 1, opacity: 0.85, fill: false }
// A station without a value that day keeps a neutral grey fill.
const NO_VALUE_FILL = '#9ca3af'

/** Marker radius: 6 px from zoom 10 up, shrinking to 3 px zoomed out. */
export const markerRadius = (zoom) => (zoom >= 10 ? 6 : Math.max(3, 6 - (10 - zoom)))
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

/** One circle per station with a value that day: filled with the view's
 *  colour for its value (the grid's ramp and domain), a black hairline, a
 *  tooltip "Name · value". A click selects the station and stops there (no
 *  pin under it); hover still reaches the map, so the raster readout works
 *  through the markers. */
function StationMarkers({ stations, colorFn, format, onSelect }) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => (typeof map?.getZoom === 'function' ? map.getZoom() : 9))
  useMapEvents({ zoomend() { setZoom(map.getZoom()) } })
  const radius = markerRadius(zoom)
  return stations.map((s) => {
    const fill = s.value == null ? null : colorFn?.([s.value])
    return (
      <CircleMarker
        key={s.skn} center={[s.lat, s.lng]} radius={radius} pane={DATA_PANE}
        pathOptions={{ color: '#000', weight: 1, opacity: 1, fillColor: fill || NO_VALUE_FILL, fillOpacity: 1 }}
        // Given the Leaflet event, stopPropagation marks its DOM event
        // _stopped, which is what keeps the map's own click (a pin) from firing.
        eventHandlers={{ click: (e) => { DomEvent.stopPropagation(e); onSelect?.(s) } }}
        data-testid="station-marker"
      >
        <Tooltip direction="top" offset={[0, -radius]}>{`${s.name || `Station ${s.skn}`} · ${format(s.value) || 'no value'}`}</Tooltip>
      </CircleMarker>
    )
  })
}

/** The selected station or grid cell: a ring with a white halo (and a dot
 *  for a grid cell), transparent to the pointer. */
function SelectionMark({ at }) {
  const center = [at.lat, at.lng]
  return (
    <>
      <CircleMarker center={center} radius={11} pane={DATA_PANE} interactive={false} pathOptions={{ color: '#fff', weight: 5, opacity: 0.9, fill: false }} />
      <CircleMarker center={center} radius={11} pane={DATA_PANE} interactive={false} pathOptions={{ color: '#111', weight: 2, opacity: 1, fill: false }} data-testid="selection-mark" />
      {at.kind === 'pin' && (
        <CircleMarker center={center} radius={3} pane={DATA_PANE} interactive={false} pathOptions={{ color: '#fff', weight: 1, fillColor: '#111', fillOpacity: 1 }} />
      )}
    </>
  )
}

/** Hover (rAF-throttled) and tap/click positions for the value readout; a
 *  click on the map (not on a marker — those stop their click) also selects
 *  the grid cell under it. */
function PointerProbe({ onHover, onPick, onSelectPoint }) {
  const raf = useRef(0)
  useMapEvents({
    mousemove(e) {
      cancelAnimationFrame(raf.current)
      const { lat, lng } = e.latlng
      raf.current = requestAnimationFrame(() => onHover?.({ lat, lng }))
    },
    mouseout() { cancelAnimationFrame(raf.current); onHover?.(null) },
    click(e) {
      const at = { lat: e.latlng.lat, lng: e.latlng.lng }
      onPick?.(at)
      onSelectPoint?.(at)
    },
  })
  return null
}

/** A long press on touch (450 ms without moving) selects the cell under
 *  the finger, as a click does with a pointer. Pointer events on the map's
 *  container, so Leaflet's own handlers are untouched. */
function LongPress({ onSelectPoint, ms = 450 }) {
  const map = useMap()
  const cb = useRef(onSelectPoint)
  cb.current = onSelectPoint
  useEffect(() => {
    const el = typeof map?.getContainer === 'function' ? map.getContainer() : null
    if (!el) return undefined
    let timer = null
    let start = null
    const cancel = () => { clearTimeout(timer); timer = null; start = null }
    const down = (e) => {
      if (e.pointerType !== 'touch' || e.isPrimary === false) return
      cancel()
      start = { x: e.clientX, y: e.clientY }
      timer = setTimeout(() => {
        timer = null
        const rect = el.getBoundingClientRect()
        const p = map.containerPointToLatLng([start.x - rect.left, start.y - rect.top])
        start = null
        if (p) cb.current?.({ lat: p.lat, lng: p.lng })
      }, ms)
    }
    const move = (e) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel() }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', cancel)
    el.addEventListener('pointercancel', cancel)
    return () => {
      cancel()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', cancel)
      el.removeEventListener('pointercancel', cancel)
    }
  }, [map, ms])
  return null
}

function ClimateMap({
  extent, view = null, onViewChange = null, georaster = null, colorFn = null,
  basemap = DEFAULT_BASEMAP, opacity = 0.75, layers = [],
  stations = null, selected = null, onSelectStation = null, onSelectPoint = null, formatValue = String,
  onHover = null, onPick = null, syncBus = null, leader = false,
}) {
  // MapContainer reads center/zoom once; ViewSync owns the view after that.
  const initial = useMemo(() => viewFromUrl(view, extent, null), []) // eslint-disable-line react-hooks/exhaustive-deps
  const base = basemapFor(basemap)
  return (
    <MapContainer
      center={[initial.lat, initial.lng]}
      zoom={initial.z}
      scrollWheelZoom
      attributionControl={false}
      className="h-full w-full"
    >
      <AutoResize />
      {/* Keyed by name: a TileLayer only follows url changes, not maxZoom or class. */}
      <TileLayer
        key={basemap} url={base.url} maxZoom={base.maxZoom} maxNativeZoom={base.maxNativeZoom}
        attribution={base.attribution} className={base.photo ? 'basemap-photo' : undefined}
      />
      <DataPane>
        <GeoRasterLeafletLayer georaster={georaster} colorFn={colorFn} opacity={opacity} />
        {layers.includes('outline') && (
          <GeoJSON data={ISLAND_GEOJSON} pane={DATA_PANE} interactive={false} style={OUTLINE_STYLE} data-testid="island-outlines" />
        )}
        {stations && stations.length > 0 && (
          <StationMarkers stations={stations} colorFn={colorFn} format={formatValue} onSelect={onSelectStation} />
        )}
        {selected && <SelectionMark at={selected} />}
      </DataPane>
      {/* The portal's scale control (bottom-left, metric + imperial) with
          the AI interface's shorter bar. */}
      <ScaleControl position="bottomleft" imperial metric maxWidth={120} />
      {onViewChange && <ViewSync extent={extent} view={view} onViewChange={onViewChange} />}
      {syncBus && <PeerSync bus={syncBus} leader={leader} />}
      <PointerProbe onHover={onHover} onPick={onPick} onSelectPoint={onSelectPoint} />
      {onSelectPoint && <LongPress onSelectPoint={onSelectPoint} />}
    </MapContainer>
  )
}

export default memo(ClimateMap)
