import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom'
import ViewerPage from './ViewerPage'
import { clearRasterCache } from './map/rasterCache'
import { clearDateRanges } from './map/dateRanges'
import { clearStationCache } from './map/stationData'
import { resetUrlWrites } from './urlWrites'
import { NAMED_RAMPS, interpolateColorRamp } from './map/ramps'

// ── Leaflet, georaster and the GeoRasterLayer, mocked ───────────────────────
// jsdom cannot run Leaflet; the mocks keep one fake map whose view and event
// handlers the tests can drive (moveend → the debounced URL write).
const fake = vi.hoisted(() => {
  const handlers = new Set()
  const map = {
    center: { lat: 0, lng: 0 }, zoom: 0,
    getCenter() { return { ...this.center } },
    getZoom() { return this.zoom },
    setView(c, z) {
      this.center = Array.isArray(c) ? { lat: c[0], lng: c[1] } : { lat: c.lat, lng: c.lng }
      this.zoom = z
      map.fire('moveend')
      return this
    },
    getBoundsZoom() { return 12 },
    getPane() { return null },
    createPane() { return { style: {} } },
    addLayer() {}, removeLayer: vi.fn(), invalidateSize() {},
    getContainer() { return fake.container },
    // A 1° per 100 px fake projection from the container's top-left corner.
    containerPointToLatLng([x, y]) { return { lat: 22.5 - y / 100, lng: -160 + x / 100 } },
    on() {}, off() {},
    fire(name, e = {}) { for (const h of [...handlers]) h[name]?.(e) },
  }
  return { map, handlers, layers: [], instances: [], mapProps: [], charts: [], container: null }
})

vi.mock('react-leaflet', async () => {
  const React = await vi.importActual('react')
  return {
    MapContainer: ({ center, zoom, children }) => {
      const first = React.useRef(true)
      if (first.current) {
        first.current = false
        fake.map.center = { lat: center[0], lng: center[1] }
        fake.map.zoom = zoom
        fake.mapProps.push({ center, zoom })
      }
      return <div data-testid="leaflet-map" data-center={center.join(',')} data-zoom={zoom}>{children}</div>
    },
    TileLayer: ({ url, className }) => <div data-testid="tile-layer" data-url={url} className={className} />,
    ScaleControl: () => <div data-testid="scale-control" />,
    GeoJSON: (props) => <div data-testid={props['data-testid'] || 'geojson'} data-pane={props.pane} />,
    CircleMarker: ({ center, radius, pathOptions, pane, eventHandlers, children, ...rest }) => (
      <div
        data-testid={rest['data-testid'] || 'circle-marker'} data-center={center.join(',')} data-radius={radius}
        data-fill={pathOptions?.fillColor} data-stroke={pathOptions?.color} data-weight={pathOptions?.weight} data-pane={pane}
        onClick={(e) => eventHandlers?.click?.({ latlng: { lat: center[0], lng: center[1] }, originalEvent: e.nativeEvent })}
      >
        {children}
      </div>
    ),
    Tooltip: ({ children }) => <span data-testid="marker-tooltip">{children}</span>,
    useMap: () => fake.map,
    useMapEvents: (h) => {
      React.useEffect(() => {
        fake.handlers.add(h)
        return () => { fake.handlers.delete(h) }
      }, [h])
      return fake.map
    },
  }
})

// The parse result depends on the body size the fetch mock sends: 8 bytes
// → HCDP's all-nodata "empty" grid, anything else → a grid with values.
vi.mock('georaster', () => ({
  default: vi.fn(async (buf) => {
    const empty = buf.byteLength === 8
    return {
      xmin: -160, ymax: 23, pixelWidth: 1, pixelHeight: 1, width: 2, height: 2, noDataValue: -9999,
      values: [empty ? [[-9999, -9999], [-9999, -9999]] : [[5, 10], [-9999, 15]]],
    }
  }),
}))

vi.mock('georaster-layer-for-leaflet', () => ({
  default: class {
    constructor(opts) { this.opts = opts; this.opacity = opts.opacity; this.ownCache = false; fake.layers.push(opts); fake.instances.push(this) }
    clearCache() { this.ownCache = true }
    addTo() { return this }
    setOpacity(o) { this.opacity = o }
  },
}))

// Radix's slider measures its thumb with a ResizeObserver; jsdom has none.
if (!global.ResizeObserver) global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }

// uPlot draws on a canvas jsdom does not have: keep what it was given.
vi.mock('uplot', () => ({
  default: class {
    constructor(opts, data, el) { this.opts = opts; this.data = data; this.root = document.createElement('div'); this.root.className = 'uplot'; el?.appendChild(this.root); fake.charts.push(this) }
    setData(d) { this.data = d }
    setSize() {}
    destroy() { this.destroyed = true; this.root.remove() }
    static tzDate(d) { return d }
  },
}))

// ── fetch ───────────────────────────────────────────────────────────────────
const DAY_RANGE = ['1990-01-01T10:00:00.000Z', '2026-09-23T10:00:00.000Z']
const MONTH_RANGE = ['1990-01-01T10:00:00.000Z', '2026-08-01T10:00:00.000Z']

// Station values for one day, and the station list (CONTRACT.md shapes).
const STATION_VALUES = {
  stations: [
    { skn: '1020.1', name: 'Hilo Airport', island: 'Hawaiʻi', lat: 19.72, lng: -155.05, value: 12.3 },
    { skn: '800.2', name: 'Kahului', island: 'Maui', lat: 20.9, lng: -156.43, value: null },
  ],
  units: 'mm', count: 2,
}
const CLIMATE_STATIONS = {
  stations: [
    { skn: '1020.1', name: 'Hilo Airport', island: 'Hawaiʻi', lat: 19.72, lng: -155.05, elevation_m: 11, network: 'NWS', observer: null },
    { skn: '800.2', name: 'Kahului', island: 'Maui', lat: 20.9, lng: -156.43, elevation_m: 15, network: 'NWS', observer: null },
    { skn: '1075.0', name: 'Waimea', island: 'Hawaiʻi', lat: 20.02, lng: -155.67, elevation_m: 814, network: 'HaleNet', observer: null },
  ],
}

// A short record: a gap on the 2nd, as the API sends it.
const RECORD = (u) => ({
  points: [['2026-09-01', 7.72], ['2026-09-02', null], ['2026-09-03', 1.5]],
  units: 'mm', dataset: u.searchParams.get('dataset'), period: u.searchParams.get('period'),
  location: u.searchParams.get('station') ? { skn: u.searchParams.get('station') } : { lat: u.searchParams.get('lat'), lng: u.searchParams.get('lng') },
})

let rasterMode = 'data' // 'data' | 'empty' | 404 | 500 | 'network' | 'hang'
let stationsMode = 'data' // 'data' | 404 | 'hang'
let seriesMode = 'data' // 'data' | 404 | 500 | 'hang'
let shortenMode = 'data' // 'data' | 500
let hung = []
let hungStations = []
let hungSeries = []
function hang(url, init, list) {
  return new Promise((resolve, reject) => {
    list.push({ url: String(url), signal: init.signal, resolve })
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })
}
function installFetch() {
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(url, 'http://localhost')
    if (u.pathname === '/api/dates') {
      const body = u.searchParams.get('period') === 'month' ? MONTH_RANGE : DAY_RANGE
      return { ok: true, status: 200, json: async () => body }
    }
    if (u.pathname === '/api/station-values') {
      if (stationsMode === 404) return { ok: false, status: 404, json: async () => ({ detail: 'no station values for that date' }) }
      if (stationsMode === 'hang') return hang(url, init, hungStations)
      return { ok: true, status: 200, json: async () => STATION_VALUES }
    }
    if (u.pathname === '/api/climate-stations') return { ok: true, status: 200, json: async () => CLIMATE_STATIONS }
    if (u.pathname === '/api/shorten') {
      if (shortenMode === 500) return { ok: false, status: 502, json: async () => ({ detail: 'down' }) }
      const { path } = JSON.parse(init.body)
      return { ok: true, status: 200, json: async () => ({ id: 'k7Qz2', url: `http://localhost/s/k7Qz2`, path }) }
    }
    if (u.pathname === '/api/timeseries') {
      if (seriesMode === 404) return { ok: false, status: 404, json: async () => ({ detail: 'no record' }) }
      if (seriesMode === 500) return { ok: false, status: 502, json: async () => ({ detail: 'HCDP API returned 500' }) }
      if (seriesMode === 'hang') return hang(url, init, hungSeries)
      return { ok: true, status: 200, json: async () => RECORD(u) }
    }
    if (u.pathname === '/api/raster') {
      if (rasterMode === 'network') throw new TypeError('Failed to fetch')
      if (rasterMode === 404) return { ok: false, status: 404, json: async () => ({ detail: 'no map for that date' }) }
      if (rasterMode === 500) return { ok: false, status: 502, json: async () => ({ detail: 'HCDP API returned 500' }) }
      if (rasterMode === 'hang') return hang(url, init, hung)
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(rasterMode === 'empty' ? 8 : 16) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}
const rasterCalls = () => global.fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/raster'))
const callsTo = (path) => global.fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith(path))

// ── rendering at a URL ──────────────────────────────────────────────────────
let visited = [] // every location the router has been at, in order
function Probe() {
  const loc = useLocation()
  const type = useNavigationType()
  React.useEffect(() => { visited.push(loc.pathname + loc.search + loc.hash) }, [loc.key]) // eslint-disable-line react-hooks/exhaustive-deps
  return <output data-testid="location" data-type={type}>{loc.pathname + loc.search}</output>
}
function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/viewer/*" element={<><ViewerPage /><Probe /></>} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  )
}
const loc = () => screen.getByTestId('location').textContent
const navType = () => screen.getByTestId('location').dataset.type

// The viewport: wide by default; narrowScreen(true) answers the viewer's
// (max-width: 767px) query as a phone would.
function narrowScreen(on) {
  window.matchMedia = (q) => ({ matches: on && /max-width:\s*767px/.test(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } })
}

beforeEach(() => {
  try { localStorage.clear() } catch { /* no storage */ }
  narrowScreen(false)
  rasterMode = 'data'
  stationsMode = 'data'
  seriesMode = 'data'
  shortenMode = 'data'
  hung = []
  hungStations = []
  hungSeries = []
  visited = []
  resetUrlWrites()
  clearStationCache()
  fake.handlers.clear()
  fake.layers.length = 0
  fake.instances.length = 0
  fake.mapProps.length = 0
  fake.charts.length = 0
  fake.container = document.createElement('div')
  clearRasterCache()
  clearDateRanges()
  installFetch()
})
// Let late answers (date ranges, parses) land inside act.
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)) })
afterEach(async () => {
  vi.useRealTimers()
  await settle()
})

// ── the launcher ────────────────────────────────────────────────────────────
describe('/viewer with no parameters', () => {
  it('renders the launcher: what it is, the grammar, and the four example questions', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-25T20:00:00Z')) // 10:00 on 25 Sep in Hawaiʻi
    renderAt('/viewer')
    expect(screen.getByTestId('viewer-launcher')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/address you can share/i)
    expect(screen.getByTestId('viewer-grammar')).toHaveTextContent('/viewer/{dataset}/{period}/{date}/{place}')
    const hrefs = () => screen.getAllByTestId('launcher-example').map((a) => a.getAttribute('href'))
    // Yesterday (24 Sep) is not published; once the range arrives the link opens the latest day.
    await waitFor(() => expect(hrefs()).toContain('/viewer/rainfall/day/2026-09-23/statewide'))
    expect(hrefs()).toEqual([
      '/viewer/rainfall/day/2026-09-23/statewide',
      '/viewer/spi-3/month/2026-08/statewide',
      '/viewer/rainfall/day/2026-09-07/kauai?scale=extreme',
      '/viewer/temperature-max/month/2026-08/oahu',
    ])
    expect(screen.getByText(/Not published yet/)).toBeInTheDocument()
    expect(screen.getByText("Hurricane Lowell's peak day on Kauaʻi")).toBeInTheDocument()
  })

  it('treats /viewer/ the same way', async () => {
    renderAt('/viewer/')
    expect(screen.getByTestId('viewer-launcher')).toBeInTheDocument()
    await settle()
  })
})

// ── canonical spelling on load ──────────────────────────────────────────────
describe('an address spelled another way is rewritten to its canonical form', () => {
  it('resolves aliases, month names and ?stations=1, orders the keys, and replaces (once)', async () => {
    renderAt('/viewer/rain/daily/october/21/2025/big-island?stations=1&z=9&lat=19.6&lng=-155.5')
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2025-10-21/hawaii?layers=stations&lat=19.6000&lng=-155.5000&z=9'))
    expect(navType()).toBe('REPLACE')
    await settle()
    // The alias address, then the canonical one — and nothing after it.
    expect(visited).toEqual([
      '/viewer/rain/daily/october/21/2025/big-island?stations=1&z=9&lat=19.6&lng=-155.5',
      '/viewer/rainfall/day/2025-10-21/hawaii?layers=stations&lat=19.6000&lng=-155.5000&z=9',
    ])
    // The same map was asked for once, under the canonical request URL.
    expect(rasterCalls().map(([u]) => u)).toEqual(['/api/raster?dataset=rainfall&period=day&date=2025-10-21&extent=hawaii'])
    expect(screen.getByTestId('viewer-heading')).toHaveTextContent('Rainfall, October 21, 2025, Hawaiʻi Island')
  })

  it('keeps query keys that belong to another feature, and the hash', async () => {
    renderAt('/viewer/temp-max/monthly/2026/aug/oa?ask=hello%20there&units=F#map')
    await waitFor(() => expect(loc()).toBe('/viewer/temperature-max/month/2026-08/oahu?units=f&ask=hello+there'))
    await settle()
    expect(visited).toHaveLength(2)
    expect(visited[1]).toBe('/viewer/temperature-max/month/2026-08/oahu?units=f&ask=hello+there#map')
  })

  it('leaves a canonical address alone', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?units=in&lat=22.1000&lng=-159.6000&z=11')
    await settle()
    expect(visited).toEqual(['/viewer/rainfall/day/2026-09-07/kauai?units=in&lat=22.1000&lng=-159.6000&z=11'])
  })
})

// ── the one remembered preference: the unit system ──────────────────────────
describe('the remembered unit system', () => {
  it('fills in a link that names no units (replace) and is written by the toggle', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    await settle()
    expect(visited).toEqual(['/viewer/rainfall/day/2026-09-07/kauai'])        // nothing remembered: nothing added
    fireEvent.click(within(screen.getByTestId('units-toggle')).getByLabelText('in'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?units=in'))
    expect(localStorage.getItem('hcdp-units')).toBe('imperial')
    fireEvent.click(within(screen.getByTestId('units-toggle')).getByLabelText('mm'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai'))
    expect(localStorage.getItem('hcdp-units')).toBe('metric')
  })

  it('opens a plain link in the remembered system — inches for rainfall, °F for temperature, nothing for an index', async () => {
    localStorage.setItem('hcdp-units', 'imperial')
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?layers=stations')
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?units=in&layers=stations'))
    expect(navType()).toBe('REPLACE')
    expect(within(screen.getByTestId('units-toggle')).getByLabelText('in')).toBeChecked()
    expect(screen.getByTestId('legend')).toHaveTextContent('Rainfall (in)')
    await settle()
    expect(visited).toHaveLength(2)
  })

  it('a units key in the address always wins — even the default spelling', async () => {
    localStorage.setItem('hcdp-units', 'imperial')
    const { unmount } = renderAt('/viewer/rainfall/day/2026-09-07/kauai?units=mm')
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai'))   // canonical: the default leaves the address, and stays metric
    await settle()
    expect(within(screen.getByTestId('units-toggle')).getByLabelText('mm')).toBeChecked()
    unmount()
    renderAt('/viewer/temperature-max/month/2026-08/oahu')
    await waitFor(() => expect(loc()).toBe('/viewer/temperature-max/month/2026-08/oahu?units=f'))
    await settle()
  })

  it('does nothing for a unitless product and survives a browser that refuses storage', async () => {
    localStorage.setItem('hcdp-units', 'imperial')
    const { unmount } = renderAt('/viewer/spi-3/month/2026-08/statewide')
    await settle()
    expect(visited).toEqual(['/viewer/spi-3/month/2026-08/statewide'])
    unmount()
    const getItem = Storage.prototype.getItem
    const setItem = Storage.prototype.setItem
    Storage.prototype.getItem = () => { throw new Error('denied') }
    Storage.prototype.setItem = () => { throw new Error('denied') }
    try {
      renderAt('/viewer/rainfall/day/2026-09-07/kauai')
      await settle()
      expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai')
      fireEvent.click(within(screen.getByTestId('units-toggle')).getByLabelText('in'))
      await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?units=in'))
    } finally {
      Storage.prototype.getItem = getItem
      Storage.prototype.setItem = setItem
    }
  })
})

// ── a URL restores everything ───────────────────────────────────────────────
describe('a viewer URL restores the controls and the map', () => {
  it('restores dataset, period, month, place, ramp and units from the address', async () => {
    renderAt('/viewer/temperature-max/month/2026-08/oahu?units=f&ramp=turbo')
    expect(screen.getByTestId('viewer-heading')).toHaveTextContent('Maximum temperature, August 2026, Oʻahu')
    expect(screen.getByTestId('dataset-select')).toHaveValue('temperature-max')
    expect(within(screen.getByTestId('period-toggle')).getByLabelText('Monthly')).toBeChecked()
    expect(within(screen.getByTestId('units-toggle')).getByLabelText('°F')).toBeChecked()
    expect(screen.getByTestId('date-picker-month')).toHaveValue('08')
    expect(screen.getByTestId('date-picker-year')).toHaveValue('2026')
    expect(screen.getByTestId('extent-select')).toHaveValue('oahu')
    expect(screen.getByTestId('ramp-select')).toHaveValue('turbo')
    // Units convert the legend, not the data: −10…35 °C reads 14…95 °F.
    expect(screen.getByTestId('legend')).toHaveTextContent('Maximum Temperature (°F)')
    const labels = within(screen.getByTestId('legend-labels')).getAllByText(/./).map((n) => n.textContent)
    expect(labels[0]).toBe('+95+')
    expect(labels[labels.length - 1]).toBe('+14-')
    expect(screen.getByTestId('viewer-units')).toHaveTextContent('°F')
    expect(screen.getByTestId('viewer-source')).toHaveTextContent('Longman et al. 2019')
    // The map, the portal furniture and the raster request.
    expect(await screen.findByTestId('leaflet-map')).toBeInTheDocument()
    expect(screen.getByTestId('scale-control')).toBeInTheDocument()
    expect(screen.getByTestId('compass-rose')).toBeInTheDocument()
    expect(screen.getByTestId('tile-layer').dataset.url).toContain('google.com/maps/vt?lyrs=y')
    expect(rasterCalls()[0][0]).toBe('/api/raster?dataset=temperature-max&period=month&date=2026-08&extent=oahu')
    await waitFor(() => expect(fake.layers.length).toBeGreaterThan(0))
    const layer = fake.layers[fake.layers.length - 1]
    expect(layer.pane).toBe('climate-data')
    expect(layer.pixelValuesToColorFn([-9999])).toBeNull()
    expect(layer.pixelValuesToColorFn([20])).toMatch(/^rgb\(/)
    // Each layer gets its own tile cache (the library shares one by default).
    expect(fake.instances.every((l) => l.ownCache)).toBe(true)
  })

  it('draws a new layer with the new raster when the date changes', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    await waitFor(() => expect(fake.layers.length).toBeGreaterThan(0))
    const first = fake.layers[fake.layers.length - 1]
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(fake.layers[fake.layers.length - 1]).not.toBe(first))
    const second = fake.layers[fake.layers.length - 1]
    expect(second.georaster).not.toBe(first.georaster)
    expect(fake.map.removeLayer).toHaveBeenCalled()
  })

  it('opens at the exact view in lat/lng/z', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?lat=22.1&lng=-159.6&z=11')
    const map = await screen.findByTestId('leaflet-map')
    expect(map.dataset.center).toBe('22.1,-159.6')
    expect(map.dataset.zoom).toBe('11')
    expect(fake.map.getZoom()).toBe(11)
  })

  it('reads the value under the pointer in display units, with a tick on the legend', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?units=in')
    await waitFor(() => expect(fake.layers.length).toBeGreaterThan(0))
    // The mocked grid: 1° pixels from (−160, 23); the top-left pixel holds 5 mm.
    await act(async () => {
      fake.map.fire('mousemove', { latlng: { lat: 22.5, lng: -159.5 } })
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(screen.getByTestId('value-readout')).toHaveTextContent('0.20 in')
    expect(screen.getByTestId('legend-tick').style.bottom).toBe('25%') // 5 of 0–20 mm
    await act(async () => { fake.map.fire('mouseout') })
    expect(screen.queryByTestId('value-readout')).toBeNull()
    // A tap (click) keeps its readout; nodata says so.
    await act(async () => { fake.map.fire('click', { latlng: { lat: 21.5, lng: -159.5 } }) })
    expect(screen.getByTestId('value-readout')).toHaveTextContent('no data here')
  })

  it('titles the map with describeViewer, units and the data source', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    expect(screen.getByTestId('viewer-title')).toHaveTextContent('Rainfall, September 7, 2026, Kauaʻi')
    expect(screen.getByTestId('viewer-units')).toHaveTextContent('millimetres (mm)')
    expect(screen.getByTestId('viewer-source')).toHaveTextContent('HCDP gridded rainfall')
    expect(screen.getByTestId('legend')).toHaveTextContent('Rainfall (mm)')
    expect(screen.getByTestId('legend-labels')).toHaveTextContent('+20+')
    await settle()
  })
})

// ── controls change the URL ─────────────────────────────────────────────────
describe('controls write the URL', () => {
  it('pushes a new dataset, moving to its period and clamping to its published range', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?units=in')
    fireEvent.change(screen.getByTestId('dataset-select'), { target: { value: 'spi-3' } })
    await waitFor(() => expect(loc()).toBe('/viewer/spi-3/month/2026-08/kauai?units=in'))
    expect(navType()).toBe('PUSH')
    expect(screen.getByTestId('dataset-select')).toHaveValue('spi-3')
    expect(screen.queryByTestId('units-toggle')).toBeNull() // SPI has no units to switch
  })

  it('carries the unit system into temperature as °F', async () => {
    renderAt('/viewer/rainfall/month/2026-08/maui?units=in')
    fireEvent.change(screen.getByTestId('dataset-select'), { target: { value: 'temperature-mean' } })
    await waitFor(() => expect(loc()).toBe('/viewer/temperature-mean/month/2026-08/maui?units=f'))
  })

  it('pushes a period change and lands on a published month', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    fireEvent.click(within(screen.getByTestId('period-toggle')).getByLabelText('Monthly'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/month/2026-08/kauai'))
    expect(navType()).toBe('PUSH')
    expect(screen.getByTestId('date-picker-month')).toHaveValue('08')
  })

  it('offers only the periods a dataset has', async () => {
    renderAt('/viewer/humidity/day/2026-09-01/statewide')
    const group = screen.getByTestId('period-toggle')
    expect(within(group).getAllByRole('radio')).toHaveLength(1)
    expect(within(group).getByLabelText('Daily')).toBeChecked()
    await settle()
  })

  it('pushes a typed date once it is complete, and steps with previous / next', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    await waitFor(() => expect(screen.getByTestId('date-picker-input')).toHaveAttribute('max', '2026-09-23'))
    const input = screen.getByTestId('date-picker-input')
    fireEvent.change(input, { target: { value: '2026-09-06' } })
    fireEvent.blur(input)
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-06/kauai'))
    expect(navType()).toBe('PUSH')
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai'))
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-06/kauai'))
  })

  it('jumps to the first and last published maps and steps by a month (daily) or a year (monthly), inside the range', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    await waitFor(() => expect(screen.getByRole('button', { name: 'First day' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-08-07/kauai'))
    expect(navType()).toBe('PUSH')
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai'))
    // A month on would be 7 October, past the last map: the step stops at the last map.
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-23/kauai'))
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Last day' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'First day' }))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/1990-01-01/kauai'))
    expect(screen.getByRole('button', { name: 'First day' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Last day' }))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-23/kauai'))
  })

  it('steps a monthly map by a year, and 31 January − 1 month is the last day of December', async () => {
    renderAt('/viewer/spi-3/month/2026-08/statewide')
    await waitFor(() => expect(screen.getByRole('button', { name: 'First month' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))
    await waitFor(() => expect(loc()).toBe('/viewer/spi-3/month/2025-08/statewide'))
    fireEvent.click(screen.getByRole('button', { name: 'First month' }))
    await waitFor(() => expect(loc()).toBe('/viewer/spi-3/month/1990-01/statewide'))
    fireEvent.click(screen.getByRole('button', { name: 'Next year' }))
    await waitFor(() => expect(loc()).toBe('/viewer/spi-3/month/1991-01/statewide'))
    fireEvent.click(screen.getByRole('button', { name: 'Last month' }))
    await waitFor(() => expect(loc()).toBe('/viewer/spi-3/month/2026-08/statewide'))
    expect(screen.getByRole('button', { name: 'Next year' })).toBeDisabled()
  })

  it('refuses a date outside the published range and says why', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    await waitFor(() => expect(screen.getByTestId('date-picker-input')).toHaveAttribute('max', '2026-09-23'))
    const input = screen.getByTestId('date-picker-input')
    fireEvent.change(input, { target: { value: '2026-09-30' } })
    fireEvent.blur(input)
    expect(screen.getByTestId('date-picker-hint')).toHaveTextContent(/No map for Sep 30, 2026/)
    expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai')
  })

  it('changes the month and year of a monthly map', async () => {
    renderAt('/viewer/spi-3/month/2026-08/statewide')
    await waitFor(() => expect(screen.getByTestId('date-picker-hint')).toHaveTextContent('Aug 2026'))
    fireEvent.change(screen.getByTestId('date-picker-month'), { target: { value: '03' } })
    await waitFor(() => expect(loc()).toBe('/viewer/spi-3/month/2026-03/statewide'))
    fireEvent.change(screen.getByTestId('date-picker-year'), { target: { value: '2019' } })
    await waitFor(() => expect(loc()).toBe('/viewer/spi-3/month/2019-03/statewide'))
    expect(navType()).toBe('PUSH')
  })

  it('pushes a new place and drops the old exact view', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?lat=22.1&lng=-159.6&z=11')
    fireEvent.change(screen.getByTestId('extent-select'), { target: { value: 'oahu' } })
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/oahu'))
    expect(navType()).toBe('PUSH')
    // The map moves to Oʻahu's own view (urlGrammar EXTENTS) and writes nothing back.
    await waitFor(() => expect(fake.map.getCenter()).toEqual({ lat: 21.48, lng: -157.98 }))
  })

  it('replaces for ramp, units and scale, and drops options that are back at their default', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    fireEvent.change(screen.getByTestId('ramp-select'), { target: { value: 'turbo' } })
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?ramp=turbo'))
    expect(navType()).toBe('REPLACE')
    fireEvent.click(within(screen.getByTestId('units-toggle')).getByLabelText('in'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?ramp=turbo&units=in'))
    expect(screen.getByTestId('legend')).toHaveTextContent('Rainfall (in)')
    expect(screen.getByTestId('viewer-units')).toHaveTextContent('inches (in)')
    fireEvent.click(within(screen.getByTestId('scale-toggle')).getByLabelText(/Storm/))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?ramp=turbo&scale=extreme&units=in'))
    expect(screen.getByTestId('legend-labels')).toHaveTextContent('+9.84+')
    fireEvent.change(screen.getByTestId('ramp-select'), { target: { value: 'viridis_r' } })
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?scale=extreme&units=in'))
    fireEvent.click(within(screen.getByTestId('units-toggle')).getByLabelText('mm'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?scale=extreme'))
    expect(navType()).toBe('REPLACE')
  })

  it('replaces for base map, opacity and layers, draws them, and drops their defaults', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    await waitFor(() => expect(fake.layers.length).toBeGreaterThan(0))
    expect(screen.getByTestId('tile-layer')).toHaveClass('basemap-photo')
    fireEvent.change(screen.getByTestId('basemap-select'), { target: { value: 'topo' } })
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?basemap=topo'))
    expect(navType()).toBe('REPLACE')
    expect(screen.getByTestId('tile-layer').dataset.url).toContain('USGSTopo')
    expect(screen.getByTestId('tile-layer')).not.toHaveClass('basemap-photo')
    // Overlays: the island outlines are a GeoJSON layer in the data pane.
    expect(screen.queryByTestId('island-outlines')).toBeNull()
    fireEvent.click(screen.getByTestId('layer-outline'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?basemap=topo&layers=outline'))
    expect(navType()).toBe('REPLACE')
    expect(screen.getByTestId('island-outlines').dataset.pane).toBe('climate-data')
    fireEvent.click(screen.getByTestId('layer-stations'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?basemap=topo&layers=stations,outline'))
    // Opacity: the slider writes on commit (keyboard commits at once) and the layer follows.
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Data layer opacity' }), { key: 'End' })
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?basemap=topo&opacity=100&layers=stations,outline'))
    expect(navType()).toBe('REPLACE')
    expect(screen.getByTestId('opacity-value')).toHaveTextContent('100 %')
    await waitFor(() => expect(fake.instances[fake.instances.length - 1].opacity).toBe(1))
    // Back to the defaults: the keys leave the address (0 % is not a default).
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Data layer opacity' }), { key: 'Home' })
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?basemap=topo&opacity=0&layers=stations,outline'))
    fireEvent.change(screen.getByTestId('basemap-select'), { target: { value: 'satellite' } })
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?opacity=0&layers=stations,outline'))
    fireEvent.click(screen.getByTestId('layer-outline'))
    fireEvent.click(screen.getByTestId('layer-stations'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?opacity=0'))
    expect(screen.queryByTestId('island-outlines')).toBeNull()
  })

  it('offers the Stations layer only for datasets HCDP has station values for', async () => {
    renderAt('/viewer/spi-3/month/2026-08/statewide?layers=outline')
    expect(screen.queryByTestId('layer-stations')).toBeNull()
    expect(screen.getByTestId('layer-outline')).toBeChecked()
    expect(screen.getByTestId('basemap-select')).toHaveValue('satellite')
    await settle()
  })

  it('writes map moves into the URL after 400 ms (replace, 4 decimals, integer zoom) — and only real moves', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    await screen.findByTestId('leaflet-map')
    await waitFor(() => expect(fake.handlers.size).toBeGreaterThan(0))
    vi.useFakeTimers()
    // The map settling on the extent's own view is not a visitor's move.
    act(() => { vi.advanceTimersByTime(1000) })
    expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai')
    act(() => {
      fake.map.center = { lat: 22.123456, lng: -159.654321 }
      fake.map.zoom = 11
      fake.map.fire('moveend')
    })
    act(() => { vi.advanceTimersByTime(399) })
    expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai')
    act(() => { vi.advanceTimersByTime(1) })
    expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?lat=22.1235&lng=-159.6543&z=11')
    expect(navType()).toBe('REPLACE')
  })
})

// ── colours and scale: ?ramp=-r, ?log=1, ?range= ────────────────────────────
describe('the Colours and scale popover', () => {
  const labels = () => within(screen.getByTestId('legend-labels')).getAllByText(/./).map((n) => n.textContent)
  const openScale = () => { fireEvent.click(screen.getByTestId('scale-button')); return screen.getByTestId('scale-popover') }

  it('summarises the scale in effect and writes the reversed ramp on the ramp key (replace)', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?layers=stations')
    await waitFor(() => expect(screen.getAllByTestId('station-marker')).toHaveLength(2))
    expect(screen.getByTestId('scale-summary')).toHaveTextContent('0–20 mm')
    const before = screen.getAllByTestId('station-marker')[0].dataset.fill
    expect(screen.getByTestId('legend-gradient')).not.toHaveAttribute('data-reversed')
    const pop = openScale()
    fireEvent.click(within(pop).getByTestId('reverse-switch'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?ramp=viridis_r-r&layers=stations'))
    expect(navType()).toBe('REPLACE')
    expect(screen.getByTestId('legend-gradient')).toHaveAttribute('data-reversed', 'true')
    expect(screen.getByTestId('scale-summary')).toHaveTextContent('0–20 mm · reversed')
    // the markers take their colour from the same function as the grid, so they flip too
    await waitFor(() => expect(screen.getAllByTestId('station-marker')[0].dataset.fill).not.toBe(before))
    await waitFor(() => expect(fake.layers[fake.layers.length - 1].pixelValuesToColorFn([0])).toBe('rgb(68,1,84)'))
    // another ramp keeps the direction; the default ramp the right way round leaves the address
    fireEvent.change(screen.getByTestId('ramp-select'), { target: { value: 'turbo' } })
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?ramp=turbo-r&layers=stations'))
    fireEvent.change(screen.getByTestId('ramp-select'), { target: { value: 'viridis_r' } })
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?ramp=viridis_r-r&layers=stations'))
    fireEvent.click(within(screen.getByTestId('scale-popover')).getByTestId('reverse-switch'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?layers=stations'))
  })

  it('writes log=1 and reads the legend at the values the colours stand for', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?units=in')
    await waitFor(() => expect(fake.layers.length).toBeGreaterThan(0))
    expect(labels()).toEqual(['+0.79+', '+0.59', '+0.39', '+0.2', '0'])
    const pop = openScale()
    fireEvent.click(within(pop).getByTestId('log-switch'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?log=1&units=in'))
    expect(navType()).toBe('REPLACE')
    expect(labels()).toEqual(['+0.79+', '+0.35', '+0.14', '+0.04', '0'])    // 21^t − 1 mm, in inches
    expect(screen.getByTestId('scale-summary')).toHaveTextContent('0–0.79 in · log')
    // the tick under the pointer moves with the scale: 5 mm sits at ln 6 / ln 21 of the bar, not a quarter
    await act(async () => { fake.map.fire('mousemove', { latlng: { lat: 22.5, lng: -159.5 } }); await new Promise((r) => setTimeout(r, 50)) })
    expect(parseFloat(screen.getByTestId('legend-tick').style.bottom)).toBeCloseTo((Math.log1p(5) / Math.log1p(20)) * 100, 1)
    await waitFor(() => expect(fake.layers[fake.layers.length - 1].pixelValuesToColorFn([5])).toBe(interpolateColorRamp(NAMED_RAMPS.viridis_r, Math.log1p(5) / Math.log1p(20))))
    fireEvent.click(within(screen.getByTestId('scale-popover')).getByTestId('log-switch'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?units=in'))
  })

  it('locks the legend to two numbers typed in display units, written in native units, and resets to auto', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?units=in')
    const pop = openScale()
    const low = within(pop).getByTestId('range-low'), high = within(pop).getByTestId('range-high')
    expect(low).toHaveValue(0)
    expect(high).toHaveValue(0.79)                                               // the automatic 0–20 mm, in inches
    expect(within(pop).getByTestId('range-hint')).toHaveTextContent("Auto: HCDP's scale")
    expect(within(pop).getByTestId('range-reset')).toBeDisabled()
    fireEvent.change(high, { target: { value: '4' } })
    fireEvent.change(low, { target: { value: '1' } })
    fireEvent.keyDown(low, { key: 'Enter' })
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?range=25.4..101.6&units=in'))
    expect(navType()).toBe('REPLACE')
    expect(labels()).toEqual(['+4+', '+3.25', '+2.5', '+1.75', '+1-'])          // both ends open: values lie beyond the lock
    expect(within(pop).getByTestId('range-hint')).toHaveTextContent("Locked. HCDP's scale is 0–0.79 in.")
    expect(screen.getByTestId('scale-summary')).toHaveTextContent('1–4 in · locked')
    // the storm scale cannot override a lock; the lock wins
    fireEvent.click(within(screen.getByTestId('scale-toggle')).getByLabelText(/Storm/))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?scale=extreme&range=25.4..101.6&units=in'))
    expect(labels()[0]).toBe('+4+')
    // nonsense is refused with a word, and nothing is written
    fireEvent.change(high, { target: { value: '0.5' } })
    fireEvent.blur(high)
    expect(within(pop).getByTestId('range-hint')).toHaveTextContent('Two numbers, low below high.')
    await settle()
    expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?scale=extreme&range=25.4..101.6&units=in')
    fireEvent.click(within(pop).getByTestId('range-reset'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?scale=extreme&units=in'))
    expect(labels()[0]).toBe('+9.84+')
    expect(within(pop).getByTestId('range-high')).toHaveValue(9.84)
  })

  it('restores a locked, reversed, log scale from the address and drops the lock when the product changes', async () => {
    renderAt('/viewer/rainfall/month/2026-08/maui?ramp=turbo-r&range=0..300&log=1')
    expect(screen.getByTestId('ramp-select')).toHaveValue('turbo')
    expect(screen.getByTestId('legend-gradient')).toHaveAttribute('data-reversed', 'true')
    expect(labels()).toEqual(['+300+', '+71.26', '+16.35', '+3.17', '0'])
    const pop = openScale()
    expect(within(pop).getByTestId('reverse-switch')).toHaveAttribute('aria-checked', 'true')
    expect(within(pop).getByTestId('log-switch')).toHaveAttribute('aria-checked', 'true')
    expect(within(pop).getByTestId('range-low')).toHaveValue(0)
    expect(within(pop).getByTestId('range-high')).toHaveValue(300)
    // a lock is in one product's units and scale: changing the dataset or period drops it, the ramp and log travel
    fireEvent.click(within(screen.getByTestId('period-toggle')).getByLabelText('Daily'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-08-31/maui?ramp=turbo-r&log=1'))
    fireEvent.change(screen.getByTestId('dataset-select'), { target: { value: 'temperature-max' } })
    await waitFor(() => expect(loc()).toBe('/viewer/temperature-max/day/2026-08-31/maui?ramp=turbo-r&log=1'))
  })

  it('offers the same fields inline in the phone sheet', async () => {
    narrowScreen(true)
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    const sheet = screen.getByTestId('bottom-sheet')
    fireEvent.mouseDown(within(sheet).getByRole('tab', { name: 'Layers' }))
    const controls = await within(sheet).findByTestId('scale-controls')
    expect(screen.queryByTestId('scale-button')).toBeNull()
    fireEvent.click(within(controls).getByTestId('log-switch'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?log=1'))
  })
})

// ── error states ────────────────────────────────────────────────────────────
describe('error states', () => {
  it('explains a grammar error and offers three working examples', () => {
    renderAt('/viewer/wind/day/2026-08-01/statewide')
    expect(screen.getByTestId('viewer-grammar-error')).toBeInTheDocument()
    expect(screen.getByTestId('viewer-error')).toHaveTextContent('There is no dataset called "wind"')
    const links = screen.getAllByTestId('grammar-example')
    expect(links).toHaveLength(3)
    expect(links[0]).toHaveAttribute('href', '/viewer/rainfall/day/2026-09-07/kauai')
    expect(rasterCalls()).toHaveLength(0)
  })

  it('suggests the monthly map when a daily link carries a month', () => {
    renderAt('/viewer/rainfall/day/2026-08/statewide')
    expect(screen.getByTestId('viewer-error')).toHaveTextContent('A daily map needs a full date')
    expect(screen.getByRole('link', { name: 'Rainfall, August 2026, Statewide' })).toHaveAttribute('href', '/viewer/rainfall/month/2026-08/statewide')
  })

  it('refuses a day the calendar does not have', async () => {
    renderAt('/viewer/rainfall/day/2026-02-30/kauai')
    expect(screen.getByTestId('viewer-error')).toHaveTextContent('The calendar has no 2026-02-30')
    expect(rasterCalls()).toHaveLength(0)
  })

  it('says a partial link is incomplete', () => {
    renderAt('/viewer/rainfall')
    expect(screen.getByTestId('viewer-error')).toHaveTextContent('missing part of its address')
  })

  it('on a 404 says there is no map yet and links the latest date', async () => {
    rasterMode = 404
    renderAt('/viewer/rainfall/day/2026-09-25/kauai?units=in')
    expect(await screen.findByText('No map for that date yet')).toBeInTheDocument()
    const latest = await screen.findByTestId('latest-map-link')
    expect(latest).toHaveAttribute('href', '/viewer/rainfall/day/2026-09-23/kauai?units=in')
    expect(latest).toHaveTextContent('September 23, 2026')
  })

  it("treats HCDP's all-nodata answer as no map for that date", async () => {
    rasterMode = 'empty'
    renderAt('/viewer/rainfall/month/2026-09/statewide')
    expect(await screen.findByText('No map for that date yet')).toBeInTheDocument()
    expect(await screen.findByTestId('latest-map-link')).toHaveAttribute('href', '/viewer/rainfall/month/2026-08/statewide')
    expect(fake.layers).toHaveLength(0)
  })

  it('offers a retry after a network error, and the retry loads the map', async () => {
    rasterMode = 'network'
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    expect(await screen.findByText('The map service did not answer')).toBeInTheDocument()
    rasterMode = 'data'
    fireEvent.click(screen.getByTestId('retry'))
    await waitFor(() => expect(screen.queryByTestId('map-error')).toBeNull())
    expect(rasterCalls()).toHaveLength(2)
    await waitFor(() => expect(fake.layers.length).toBeGreaterThan(0))
  })

  it('treats a gateway error like a network error', async () => {
    rasterMode = 500
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    expect(await screen.findByText('The map service did not answer')).toBeInTheDocument()
    expect(screen.getByTestId('retry')).toBeInTheDocument()
  })

  it('allows any date when the date range cannot be fetched', async () => {
    const base = global.fetch
    global.fetch = vi.fn(async (url, init) => (String(url).startsWith('/api/dates') ? { ok: false, status: 502, json: async () => ({}) } : base(url, init)))
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => String(u).startsWith('/api/dates'))).toBe(true))
    const input = screen.getByTestId('date-picker-input')
    expect(input).not.toHaveAttribute('max')
    fireEvent.change(input, { target: { value: '2030-01-01' } })
    fireEvent.blur(input)
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2030-01-01/kauai'))
  })
})

// ── loading, cache and cancellation ─────────────────────────────────────────
describe('raster loading', () => {
  it('shows a loading state inside the fixed map frame, then the map', async () => {
    rasterMode = 'hang'
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    expect(screen.getByTestId('map-loading')).toBeInTheDocument()
    expect(screen.getByTestId('map-pane')).toBeInTheDocument()
    await waitFor(() => expect(hung).toHaveLength(1))
    await act(async () => { hung[0].resolve({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) }) })
    await waitFor(() => expect(screen.queryByTestId('map-loading')).toBeNull())
  })

  it('cancels the stale request when the URL changes', async () => {
    rasterMode = 'hang'
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    await waitFor(() => expect(hung).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(hung).toHaveLength(2))
    await waitFor(() => expect(hung[0].signal.aborted).toBe(true))
    expect(hung[1].url).toContain('date=2026-09-06')
    expect(hung[1].signal.aborted).toBe(false)
  })

  it('sends one request per map even when two panes or a remount ask for it', async () => {
    rasterMode = 'hang'
    const { unmount } = renderAt('/viewer/rainfall/month/2026-08/statewide')
    await waitFor(() => expect(hung).toHaveLength(1))
    unmount()
    renderAt('/viewer/rainfall/month/2026-08/statewide') // remounted at once: the request is kept
    await settle()
    expect(hung).toHaveLength(1)
    expect(hung[0].signal.aborted).toBe(false)
    await act(async () => { hung[0].resolve({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) }) })
    await waitFor(() => expect(screen.queryByTestId('map-loading')).toBeNull())
  })

  it('keeps parsed rasters by request URL, so going back does not fetch again', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    await waitFor(() => expect(fake.layers.length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(rasterCalls()).toHaveLength(2))
    await waitFor(() => expect(screen.queryByTestId('map-loading')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai'))
    expect(screen.queryByTestId('map-loading')).toBeNull()
    expect(rasterCalls()).toHaveLength(2)
  })
})

// ── banners ─────────────────────────────────────────────────────────────────
describe('banners on the map', () => {
  it('marks daily rainfall experimental, with a tooltip that says why', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    const badge = screen.getByTestId('experimental-badge')
    expect(badge).toHaveTextContent('Experimental')
    expect(screen.queryByTestId('viewer-caution')).toBeNull()
    fireEvent.focus(badge)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Daily rainfall and ignition products are experimental')
    await settle()
  })

  it('marks every ignition product experimental and adds the one-line caution under the title card', async () => {
    renderAt('/viewer/ignition-lead-2/day/2026-09-07/statewide')
    expect(screen.getByTestId('experimental-badge')).toBeInTheDocument()
    expect(screen.getByTestId('viewer-caution')).toHaveTextContent('Informational only — not an operational fire forecast (CC BY-NC-ND 4.0).')
    await settle()
  })

  it('shows neither for monthly rainfall or SPI', async () => {
    renderAt('/viewer/rainfall/month/2026-08/kauai')
    expect(screen.queryByTestId('experimental-badge')).toBeNull()
    expect(screen.queryByTestId('viewer-caution')).toBeNull()
    await settle()
  })
})

// ── station markers ─────────────────────────────────────────────────────────
describe('?layers=stations', () => {
  it('draws one marker per station in the view colours, with a tooltip, and a click selects it (push)', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?layers=stations')
    await waitFor(() => expect(screen.getAllByTestId('station-marker')).toHaveLength(2))
    expect(callsTo('/api/station-values')).toEqual(['/api/station-values?dataset=rainfall&period=day&date=2026-09-07'])
    const [hilo, kahului] = screen.getAllByTestId('station-marker')
    expect(hilo.dataset.center).toBe('19.72,-155.05')
    expect(hilo.dataset.pane).toBe('climate-data')
    expect(hilo.dataset.stroke).toBe('#000')
    expect(hilo.dataset.weight).toBe('1')
    expect(hilo.dataset.fill).toMatch(/^rgb\(/) // the ramp colour of 12.3 mm on 0–20
    expect(hilo.dataset.radius).toBe('6') // zoom 10
    expect(within(hilo).getByTestId('marker-tooltip')).toHaveTextContent('Hilo Airport · 12.3 mm')
    expect(kahului.dataset.fill).toBe('#9ca3af')
    expect(within(kahului).getByTestId('marker-tooltip')).toHaveTextContent('Kahului · no value')
    expect(screen.queryByTestId('selection-mark')).toBeNull()
    fireEvent.click(hilo)
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?layers=stations&station=1020.1'))
    expect(navType()).toBe('PUSH')
    expect(screen.getByTestId('selection-mark').dataset.center).toBe('19.72,-155.05')
    // Clicking the selected station again changes nothing.
    fireEvent.click(screen.getAllByTestId('station-marker')[0])
    await settle()
    expect(visited.filter((p) => p.endsWith('station=1020.1'))).toHaveLength(1)
  })

  it('shrinks the markers when zoomed out', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/statewide?layers=stations&lat=20.6&lng=-157.4&z=7')
    await waitFor(() => expect(screen.getAllByTestId('station-marker')).toHaveLength(2))
    expect(screen.getAllByTestId('station-marker')[0].dataset.radius).toBe('3')
  })

  it('marks a station named in the address even when the layer is off, from the station list', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?station=1075.0')
    await waitFor(() => expect(screen.getByTestId('selection-mark').dataset.center).toBe('20.02,-155.67'))
    expect(callsTo('/api/climate-stations')).toHaveLength(1)
    expect(callsTo('/api/station-values')).toHaveLength(0)
    expect(screen.queryByTestId('station-marker')).toBeNull()
  })

  it('says quietly when there are no station values for the date', async () => {
    stationsMode = 404
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?layers=stations')
    expect(await screen.findByTestId('stations-none')).toHaveTextContent('no station values for this date')
    expect(screen.queryByTestId('station-marker')).toBeNull()
  })

  it('shows a stations pill while loading and cancels the request when the date changes', async () => {
    stationsMode = 'hang'
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?layers=stations')
    expect(await screen.findByTestId('stations-loading')).toHaveTextContent('stations…')
    await waitFor(() => expect(hungStations).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(hungStations).toHaveLength(2))
    expect(hungStations[0].signal.aborted).toBe(true)
    expect(hungStations[1].url).toContain('date=2026-09-06')
  })

  it('asks nothing for a dataset without stations', async () => {
    renderAt('/viewer/spi-3/month/2026-08/statewide?layers=stations')
    await settle()
    expect(callsTo('/api/station-values')).toHaveLength(0)
    expect(screen.queryByTestId('stations-loading')).toBeNull()
  })
})

// ── the time series panel ───────────────────────────────────────────────────
const SEC = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000
describe('?station= and ?pin= open the time series', () => {
  it('shows a station: name, SKN, island and elevation; the whole record by default; values in display units with gaps', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?units=in&station=1020.1')
    const panel = await screen.findByRole('complementary', { name: /Hilo Airport: Rainfall, daily time series/ })
    expect(screen.getByTestId('timeseries-heading')).toHaveTextContent('Hilo Airport')
    expect(screen.getByTestId('timeseries-details')).toHaveTextContent('SKN 1020.1 · Hawaiʻi · 11 m')
    // The record is asked for over the published range of the dataset's daily maps.
    await waitFor(() => expect(callsTo('/api/timeseries')).toEqual(['/api/timeseries?dataset=rainfall&period=day&start=1990-01-01&end=2026-09-23&station=1020.1']))
    await waitFor(() => expect(fake.charts).toHaveLength(1))
    const chart = fake.charts[0]
    expect(chart.data[0]).toEqual([SEC('2026-09-01'), SEC('2026-09-02'), SEC('2026-09-03')])
    expect(chart.data[1]).toEqual([0.3, null, 0.06]) // 7.72 mm and 1.5 mm in inches, a gap between
    expect(chart.opts.series[1].spanGaps).toBe(false)
    expect(within(panel).getByTestId('timeseries-readout')).toHaveTextContent('Sep 1, 2026 to Sep 3, 2026')
    expect(within(panel).getByTestId('timeseries-csv')).toBeEnabled()
    // Default window is "All"; rainfall has both periods, so the series period can be switched.
    expect(within(screen.getByTestId('ts-window')).getByLabelText('All')).toBeChecked()
    expect(within(screen.getByTestId('ts-period')).getByLabelText('Daily')).toBeChecked()
  })

  it('shows the statistics of the points in view, tagged with where the numbers come from, and the network in the header', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?units=in&station=1020.1')
    const panel = await screen.findByTestId('timeseries-panel')
    await waitFor(() => expect(fake.charts).toHaveLength(1))
    expect(screen.getByTestId('timeseries-details')).toHaveTextContent('SKN 1020.1 · Hawaiʻi · 11 m · NWS')
    const stats = within(panel).getByTestId('timeseries-stats')
    expect(within(stats).getByTestId('stat-in-view')).toHaveTextContent('2 days')      // the gap on the 2nd is not a value
    expect(within(stats).getByTestId('stat-min')).toHaveTextContent('0.06 in')
    expect(within(stats).getByTestId('stat-max')).toHaveTextContent('0.3 in')
    expect(within(stats).getByTestId('stat-mean')).toHaveTextContent('0.18 in')
    expect(within(stats).getByTestId('stat-std-dev')).toHaveTextContent('0.12 in')     // population σ of 0.3 and 0.06
    expect(within(stats).getByTestId('stats-provenance')).toHaveTextContent('computed from HCDP station data')
    // the chart carries a dashed marker at the map's date and zooms by drag along x
    const chart = fake.charts[0]
    expect(chart.opts.hcdp.marker).toEqual({ x: SEC('2026-09-07'), label: 'Map date · Sep 7, 2026' })
    expect(chart.opts.hooks.draw).toHaveLength(1)
    expect(chart.opts.cursor.drag.x).toBe(true)
    // a zoom narrows the statistics to the dates in view, at most once per 500 ms
    await act(async () => { chart.opts.hooks.setScale[0]({ scales: { x: { min: SEC('2026-09-03'), max: SEC('2026-09-03') } } }, 'x') })
    await waitFor(() => expect(within(stats).getByTestId('stat-in-view')).toHaveTextContent('1 days'), { timeout: 1500 })
    expect(within(stats).getByTestId('stat-std-dev')).toHaveTextContent('0 in')
    expect(within(stats).getByTestId('stat-mean')).toHaveTextContent('0.06 in')
  })

  it('a grid cell says its numbers come from the gridded data', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?pin=22.1000,-159.6000')
    await screen.findByTestId('timeseries-panel')
    await waitFor(() => expect(fake.charts).toHaveLength(1))
    expect(screen.getByTestId('stats-provenance')).toHaveTextContent('computed from HCDP gridded data')
  })

  it('a drag-select or a wheel zoom on the chart writes ts= (replace) for the dates it covers; Zoom to the map\'s month writes the month', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1')
    await screen.findByTestId('timeseries-panel')
    await waitFor(() => expect(fake.charts).toHaveLength(1))
    const chart = fake.charts[0]
    // uPlot reports a selection in CSS pixels; a fake posToVal maps them to the record's days
    const u = { select: { left: 10, width: 50 }, posToVal: (px) => SEC('2026-09-01') + (px - 10) * 3600, scales: { x: {} } }
    await act(async () => { chart.opts.hooks.setSelect[0](u) })
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1&ts=2026-09-01..2026-09-03'))
    expect(navType()).toBe('REPLACE')
    await waitFor(() => expect(callsTo('/api/timeseries')).toContain('/api/timeseries?dataset=rainfall&period=day&start=2026-09-01&end=2026-09-03&station=1020.1'))
    // an empty selection (a click) writes nothing
    await act(async () => { chart.opts.hooks.setSelect[0]({ select: { left: 10, width: 0 }, posToVal: u.posToVal }) })
    await settle()
    expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1&ts=2026-09-01..2026-09-03')
    // the wheel: a fake plot area with a scale and an extent; wheel up zooms in about the cursor and writes the window
    const latest = fake.charts[fake.charts.length - 1]
    const over = document.createElement('div')
    over.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 200 })
    // (the record's two days in view, the cursor on the left edge: a step in keeps three quarters of them, to noon on the 2nd)
    const fakeU = { over, scales: { x: { min: SEC('2026-09-01'), max: SEC('2026-09-03') } }, posToVal: (px) => SEC('2026-09-01') + (px / 300) * 2 * 86400, setScale: vi.fn() }
    await act(async () => { latest.opts.hooks.ready[0](fakeU) })
    const wheel = new Event('wheel', { bubbles: true, cancelable: true })
    Object.assign(wheel, { deltaY: -100, clientX: 0, clientY: 50 })
    await act(async () => { over.dispatchEvent(wheel) })
    expect(fakeU.setScale).toHaveBeenCalledWith('x', { min: SEC('2026-09-01'), max: SEC('2026-09-01') + 1.5 * 86400 })
    expect(wheel.defaultPrevented).toBe(true)
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1&ts=2026-09-01..2026-09-02'))
    // the map's period: September 2026, clamped to the published record
    fireEvent.click(screen.getByTestId('ts-zoom-period'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1&ts=2026-09-01..2026-09-23'))
    expect(screen.getByTestId('ts-zoom-period')).toHaveTextContent("Zoom to the map's month")
    // the window buttons still work after a zoom
    fireEvent.click(within(screen.getByTestId('ts-window')).getByLabelText('All'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1'))
  })

  it('zooms a monthly series to the map\'s year', async () => {
    renderAt('/viewer/rainfall/month/2026-08/kauai?station=1020.1')
    await screen.findByTestId('timeseries-panel')
    await waitFor(() => expect(screen.getByTestId('ts-zoom-period')).toBeEnabled())
    expect(screen.getByTestId('ts-zoom-period')).toHaveTextContent("Zoom to the map's year")
    fireEvent.click(screen.getByTestId('ts-zoom-period'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/month/2026-08/kauai?station=1020.1&ts=2026-01..2026-08'))
  })

  it('writes the window with ts= (replace) from the Month / Year / All buttons, and Custom from two date fields', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1')
    await screen.findByTestId('timeseries-panel')
    await waitFor(() => expect(callsTo('/api/timeseries')).toHaveLength(1))
    fireEvent.click(within(screen.getByTestId('ts-window')).getByLabelText('Year'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1&ts=2025-09-07..2026-09-07'))
    expect(navType()).toBe('REPLACE')
    await waitFor(() => expect(callsTo('/api/timeseries')).toContain('/api/timeseries?dataset=rainfall&period=day&start=2025-09-07&end=2026-09-07&station=1020.1'))
    fireEvent.click(within(screen.getByTestId('ts-window')).getByLabelText('Month'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1&ts=2026-08-07..2026-09-07'))
    fireEvent.click(within(screen.getByTestId('ts-window')).getByLabelText('Custom'))
    const start = await screen.findByTestId('ts-start')
    expect(start).toHaveValue('2026-08-07')
    fireEvent.change(start, { target: { value: '2026-06-01' } })
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1&ts=2026-06-01..2026-09-07'))
    fireEvent.click(within(screen.getByTestId('ts-window')).getByLabelText('All'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1'))
    expect(screen.queryByTestId('ts-custom')).toBeNull()
  })

  it('switches the series period with tsp= (the daily window is dropped) and fetches the monthly record', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1&ts=2026-08-07..2026-09-07')
    await screen.findByTestId('timeseries-panel')
    fireEvent.click(within(screen.getByTestId('ts-period')).getByLabelText('Monthly'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1&tsp=month'))
    expect(navType()).toBe('REPLACE')
    await waitFor(() => expect(callsTo('/api/timeseries')).toContain('/api/timeseries?dataset=rainfall&period=month&start=1990-01&end=2026-08&station=1020.1'))
    expect(within(screen.getByTestId('ts-window')).queryByLabelText('Month')).toBeNull() // no "Month" window for a monthly series
  })

  it('a click on the map pushes pin= (4 decimals) and opens the grid cell; the ocean is ignored', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    await waitFor(() => expect(fake.layers.length).toBeGreaterThan(0))
    // nodata under the pointer (the mocked grid's bottom-left pixel): no pin.
    await act(async () => { fake.map.fire('click', { latlng: { lat: 21.5, lng: -159.5 } }) })
    await settle()
    expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai')
    expect(screen.queryByTestId('timeseries-panel')).toBeNull()
    await act(async () => { fake.map.fire('click', { latlng: { lat: 22.123456, lng: -159.654321 } }) })
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?pin=22.1235,-159.6543'))
    expect(navType()).toBe('PUSH')
    expect(await screen.findByTestId('timeseries-heading')).toHaveTextContent('Grid cell 22.1235, -159.6543')
    expect(screen.getByTestId('selection-mark').dataset.center).toBe('22.1235,-159.6543')
    await waitFor(() => expect(callsTo('/api/timeseries')).toEqual(['/api/timeseries?dataset=rainfall&period=day&start=1990-01-01&end=2026-09-23&lat=22.1235&lng=-159.6543']))
    // The same cell again is not pushed twice.
    await act(async () => { fake.map.fire('click', { latlng: { lat: 22.12349, lng: -159.65431 } }) })
    await settle()
    expect(visited.filter((p) => p.includes('pin=')).length).toBe(1)
  })

  it('a pin replaces a station and a station replaces a pin', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?layers=stations&station=1020.1&ts=2026-08-07..2026-09-07')
    await screen.findByTestId('timeseries-panel')
    await act(async () => { fake.map.fire('click', { latlng: { lat: 22.1, lng: -159.6 } }) })
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?layers=stations&pin=22.1000,-159.6000&ts=2026-08-07..2026-09-07'))
    await waitFor(() => expect(screen.getAllByTestId('station-marker')).toHaveLength(2))
    fireEvent.click(screen.getAllByTestId('station-marker')[1])
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?layers=stations&station=800.2&ts=2026-08-07..2026-09-07'))
    expect(screen.getByTestId('timeseries-heading')).toHaveTextContent('Kahului')
  })

  it('a long press on touch selects the cell under the finger', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    const press = (type, init) => {
      const e = new Event(type, { bubbles: true })
      Object.assign(e, { pointerType: 'touch', isPrimary: true, clientX: 50, clientY: 40, ...init })
      fake.container.dispatchEvent(e)
    }
    press('pointerdown')
    press('pointermove', { clientX: 53 }) // a 3 px wobble is still a press
    await act(async () => { await vi.advanceTimersByTimeAsync(449) })
    expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai')
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?pin=22.1000,-159.5000') // 40 px down, 50 px right of the corner
    // A press that moves on is a pan, not a selection.
    press('pointerdown')
    press('pointermove', { clientX: 80 })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(visited.filter((p) => p.includes('pin=')).length).toBe(1)
    vi.useRealTimers()
  })

  it('a dataset without station values drops the station (a pin survives); a period change drops the window', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1&ts=2026-08-07..2026-09-07')
    await screen.findByTestId('timeseries-panel')
    fireEvent.click(within(screen.getByTestId('period-toggle')).getByLabelText('Monthly'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/month/2026-08/kauai?station=1020.1'))
    fireEvent.change(screen.getByTestId('dataset-select'), { target: { value: 'spi-3' } })
    await waitFor(() => expect(loc()).toBe('/viewer/spi-3/month/2026-08/kauai'))
    expect(screen.queryByTestId('timeseries-panel')).toBeNull()
    await act(async () => { fake.map.fire('click', { latlng: { lat: 22.1, lng: -159.6 } }) })
    await waitFor(() => expect(loc()).toBe('/viewer/spi-3/month/2026-08/kauai?pin=22.1000,-159.6000'))
    fireEvent.change(screen.getByTestId('dataset-select'), { target: { value: 'temperature-mean' } })
    await waitFor(() => expect(loc()).toBe('/viewer/temperature-mean/month/2026-08/kauai?pin=22.1000,-159.6000'))
    expect(screen.getByTestId('timeseries-heading')).toHaveTextContent('Grid cell 22.1000, -159.6000')
  })

  it('closes with the × or Escape as a push that drops station, pin, ts and tsp', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?units=in&station=1020.1&ts=2026-08-07..2026-09-07&tsp=month')
    await screen.findByTestId('timeseries-panel')
    fireEvent.click(screen.getByTestId('timeseries-close'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?units=in'))
    expect(navType()).toBe('PUSH')
    expect(screen.queryByTestId('timeseries-panel')).toBeNull()
    await act(async () => { fake.map.fire('click', { latlng: { lat: 22.1, lng: -159.6 } }) })
    await screen.findByTestId('timeseries-panel')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('timeseries-panel')).toBeNull())
    expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?units=in')
  })

  it('downloads a date,value CSV in display units under a station or cell file name', async () => {
    const urls = []
    URL.createObjectURL = vi.fn((blob) => { urls.push(blob); return 'blob:csv' })
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { urls.push(this.download) })
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?units=in&station=1020.1')
    const button = await screen.findByTestId('timeseries-csv')
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    expect(urls[1]).toBe('station_1020.1_rainfall_day.csv')
    const blob = urls[0]
    expect(blob.type).toBe('text/csv;charset=utf-8')
    expect(blob.size).toBe('date,value\n2026-09-01,0.3\n2026-09-02,\n2026-09-03,0.06\n'.length)
    click.mockRestore()
  })

  it('says when the record is missing, and offers a retry when the service fails', async () => {
    seriesMode = 404
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1')
    expect(await screen.findByTestId('timeseries-notfound')).toHaveTextContent('no record')
    seriesMode = 500
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    await settle()
    // The window did not change, so the same record is shown; a new station asks again.
    await act(async () => { fake.map.fire('click', { latlng: { lat: 22.1, lng: -159.6 } }) })
    expect(await screen.findByTestId('timeseries-error')).toHaveTextContent('did not load')
    seriesMode = 'data'
    fireEvent.click(within(screen.getByTestId('timeseries-error')).getByRole('button', { name: /Try again/ }))
    await waitFor(() => expect(fake.charts.length).toBeGreaterThan(0))
  })
})

// ── the Stations tab ────────────────────────────────────────────────────────
describe('the Stations tab', () => {
  const rows = () => screen.getAllByTestId('station-row')
  const names = () => rows().map((r) => within(r).getByTestId('station-pick').textContent)

  it('lists the stations with a value for the date, sortable by column, and a row selects the station and pans to it (one push)', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    expect(screen.getByTestId('rail-tabs')).toBeInTheDocument()
    expect(callsTo('/api/station-values')).toHaveLength(0)
    fireEvent.mouseDown(screen.getByTestId('rail-tab-stations'))
    const list = await screen.findByTestId('station-list')
    await waitFor(() => expect(names()).toEqual(['Hilo Airport', 'Kahului']))
    expect(callsTo('/api/station-values')).toEqual(['/api/station-values?dataset=rainfall&period=day&date=2026-09-07'])
    expect(callsTo('/api/climate-stations')).toHaveLength(1)
    expect(within(list).getByTestId('station-count')).toHaveTextContent('2 of 2 stations')
    const hilo = rows()[0]
    expect(within(hilo).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Hilo Airport', '1020.1', 'Hawaiʻi', '11', '12.3 mm'])
    expect(within(rows()[1]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Kahului', '800.2', 'Maui', '15', '—'])
    // sort by value: highest first, a missing value last; again flips the order
    fireEvent.click(within(list).getByTestId('station-sort-value'))
    expect(names()).toEqual(['Hilo Airport', 'Kahului'])
    expect(within(list).getByTestId('station-sort-value').closest('th')).toHaveAttribute('aria-sort', 'descending')
    fireEvent.click(within(list).getByTestId('station-sort-elevation'))
    expect(names()).toEqual(['Kahului', 'Hilo Airport'])
    fireEvent.click(within(list).getByTestId('station-sort-elevation'))
    expect(names()).toEqual(['Hilo Airport', 'Kahului'])
    // the map has not been moved yet; nothing of the chrome is in the address
    expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai')
    // choosing a row: the station is selected and the camera moves to it in the same push
    fireEvent.click(within(rows()[1]).getByTestId('station-pick'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?station=800.2&lat=20.9000&lng=-156.4300&z=10'))
    expect(navType()).toBe('PUSH')
    expect(visited.filter((p) => p.includes('station=800.2'))).toHaveLength(1)
    await waitFor(() => expect(fake.map.getCenter()).toEqual({ lat: 20.9, lng: -156.43 }))
    expect(await screen.findByTestId('timeseries-heading')).toHaveTextContent('Kahului')
    expect(screen.getByTestId('timeseries-details')).toHaveTextContent('SKN 800.2 · Maui · 15 m · NWS')
    expect(rows()[1]).toHaveAttribute('data-selected', 'true')
    expect(within(rows()[1]).getByTestId('station-pick')).toHaveAttribute('aria-pressed', 'true')
    // clicking anywhere on the already selected row changes nothing
    fireEvent.click(rows()[1])
    await settle()
    expect(visited.filter((p) => p.includes('station=800.2'))).toHaveLength(1)
  })

  it('filters by island, name, elevation and value with exclude switches — chrome that never reaches the address', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?units=in')
    fireEvent.mouseDown(screen.getByTestId('rail-tab-stations'))
    const list = await screen.findByTestId('station-list')
    await waitFor(() => expect(names()).toEqual(['Hilo Airport', 'Kahului']))
    fireEvent.click(within(list).getByTestId('station-filters-toggle'))
    fireEvent.change(within(list).getByTestId('filter-text'), { target: { value: 'kah' } })
    expect(names()).toEqual(['Kahului'])
    expect(within(list).getByTestId('station-count')).toHaveTextContent('1 of 2 stations')
    fireEvent.click(within(list).getByTestId('filter-text-negate'))
    expect(names()).toEqual(['Hilo Airport'])
    fireEvent.click(within(list).getByTestId('station-filters-clear'))
    expect(names()).toEqual(['Hilo Airport', 'Kahului'])
    // islands are offered with their counts, from the data
    fireEvent.click(within(list).getByTestId('filter-island-Maui'))
    expect(names()).toEqual(['Kahului'])
    fireEvent.click(within(list).getByTestId('filter-islands-negate'))
    expect(names()).toEqual(['Hilo Airport'])
    fireEvent.click(within(list).getByTestId('station-filters-clear'))
    fireEvent.change(within(list).getByTestId('filter-elev-min'), { target: { value: '12' } })
    expect(names()).toEqual(['Kahului'])
    fireEvent.click(within(list).getByTestId('station-filters-clear'))
    // value bounds are in the display units: 0.4 in = 10.16 mm
    fireEvent.change(within(list).getByTestId('filter-value-min'), { target: { value: '0.4' } })
    expect(names()).toEqual(['Hilo Airport'])
    expect(within(rows()[0]).getAllByRole('cell')[4]).toHaveTextContent('0.48 in')
    expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?units=in')
    await settle()
    expect(visited).toEqual(['/viewer/rainfall/day/2026-09-07/kauai?units=in'])
  })

  it('has no Stations tab for a gridded-only product, and says so on the phone', async () => {
    renderAt('/viewer/spi-3/month/2026-08/statewide')
    expect(screen.queryByTestId('rail-tabs')).toBeNull()
    expect(screen.getByTestId('viewer-controls')).toBeInTheDocument()
    await settle()
  })

  it('on the phone, a gridded-only product offers no list, only the press-and-hold hint', async () => {
    narrowScreen(true)
    renderAt('/viewer/spi-3/month/2026-08/statewide')
    const sheet = screen.getByTestId('bottom-sheet')
    fireEvent.mouseDown(within(sheet).getByRole('tab', { name: 'Stations' }))
    expect(await within(sheet).findByTestId('station-hint')).toHaveTextContent('no station values')
    expect(screen.queryByTestId('station-list')).toBeNull()
    expect(callsTo('/api/station-values')).toHaveLength(0)
  })

  it('on the phone, a station row opens its record, and no values for the date is said plainly', async () => {
    narrowScreen(true)
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    const sheet = screen.getByTestId('bottom-sheet')
    fireEvent.mouseDown(within(sheet).getByRole('tab', { name: 'Stations' }))
    await within(sheet).findByTestId('station-list')
    await waitFor(() => expect(names()).toEqual(['Hilo Airport', 'Kahului']))
    expect(within(sheet).getByTestId('station-hint')).toHaveTextContent('Tap a station below')
    fireEvent.click(within(rows()[0]).getByTestId('station-pick'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1&lat=19.7200&lng=-155.0500&z=10'))
    expect(await within(sheet).findByTestId('timeseries-panel')).toBeInTheDocument()
    expect(within(sheet).queryByTestId('station-list')).toBeNull()
    fireEvent.click(within(sheet).getByTestId('timeseries-close'))
    expect(await within(sheet).findByTestId('station-list')).toBeInTheDocument()
  })

  it('says when there are no station values for the date', async () => {
    stationsMode = 404
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    fireEvent.mouseDown(screen.getByTestId('rail-tab-stations'))
    const list = await screen.findByTestId('station-list')
    await waitFor(() => expect(within(list).getByTestId('station-count')).toHaveTextContent('No station values for this date.'))
    expect(screen.queryByTestId('station-table')).toBeNull()
  })
})

// ── phone layout: the bottom sheet ──────────────────────────────────────────
describe('below 768 px', () => {
  // jsdom has no PointerEvent: a plain event carrying the pointer fields.
  const press = (el, type, init) => act(() => {
    const e = new Event(type, { bubbles: true })
    Object.assign(e, { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 160, ...init })
    el.dispatchEvent(e)
  })
  // Radix tabs change on mousedown, as a pointer does.
  const pickTab = (sheet, name) => fireEvent.mouseDown(within(sheet).getByRole('tab', { name }))

  it('moves the controls into a bottom sheet with four tabs and runs the map edge to edge', async () => {
    narrowScreen(true)
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?units=in')
    expect(screen.getByTestId('viewer').dataset.layout).toBe('sheet')
    const sheet = screen.getByTestId('bottom-sheet')
    expect(sheet.dataset.snap).toBe('peek')
    expect(within(sheet).getByTestId('viewer-heading')).toHaveTextContent('Rainfall, September 7, 2026, Kauaʻi')
    expect(within(sheet).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Dataset', 'Date', 'Layers', 'Stations'])
    expect(screen.queryByTestId('viewer-controls')).toBeNull() // no rail
    expect(screen.getByTestId('map-pane')).toHaveClass('border-y')
    expect(screen.getByTestId('map-pane')).not.toHaveClass('rounded-lg')
    // Dataset tab first: dataset, period, units, place, sharing.
    expect(within(sheet).getByTestId('dataset-select')).toHaveValue('rainfall')
    expect(within(sheet).getByTestId('extent-select')).toHaveValue('kauai')
    expect(within(sheet).getByTestId('copy-link')).toBeInTheDocument()
    expect(within(sheet).queryByTestId('date-picker')).toBeNull()
    pickTab(sheet, 'Date')
    expect(await within(sheet).findByTestId('date-picker')).toBeInTheDocument()
    expect(within(sheet).getByTestId('compare-control')).toBeInTheDocument()
    pickTab(sheet, 'Layers')
    expect(await within(sheet).findByTestId('basemap-select')).toBeInTheDocument()
    expect(within(sheet).getByTestId('ramp-select')).toBeInTheDocument()
    expect(within(sheet).getByTestId('layer-stations')).toBeInTheDocument()
    pickTab(sheet, 'Stations')
    expect(await within(sheet).findByTestId('station-hint')).toHaveTextContent('press and hold')
    // The controls still write the address.
    pickTab(sheet, 'Dataset')
    fireEvent.change(await within(sheet).findByTestId('extent-select'), { target: { value: 'oahu' } })
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/oahu?units=in'))
  })

  it('taps on the handle cycle peek → half → full → peek; a drag settles on the nearest rest', async () => {
    narrowScreen(true)
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    const sheet = screen.getByTestId('bottom-sheet')
    const handle = screen.getByTestId('sheet-handle')
    fireEvent.click(handle)
    expect(sheet.dataset.snap).toBe('half')
    fireEvent.click(handle)
    expect(sheet.dataset.snap).toBe('full')
    fireEvent.click(handle)
    expect(sheet.dataset.snap).toBe('peek')
    // Drag the handle 300 px up from peek (124 px): nearer to half (384 px of 768) than to full.
    press(handle, 'pointerdown', { clientY: 640 })
    press(handle, 'pointermove', { clientY: 500 })
    press(handle, 'pointermove', { clientY: 340 })
    press(handle, 'pointerup', { clientY: 340 })
    expect(sheet.dataset.snap).toBe('half')
    fireEvent.click(handle) // the click that follows a drag is not a tap
    expect(sheet.dataset.snap).toBe('half')
    // A tiny wobble is a tap.
    press(handle, 'pointerdown', { clientY: 400 })
    press(handle, 'pointermove', { clientY: 398 })
    press(handle, 'pointerup', { clientY: 398 })
    fireEvent.click(handle)
    expect(sheet.dataset.snap).toBe('full')
    // Dragged all the way down → peek.
    press(handle, 'pointerdown', { clientY: 100 })
    press(handle, 'pointermove', { clientY: 700 })
    press(handle, 'pointerup', { clientY: 700 })
    expect(sheet.dataset.snap).toBe('peek')
    await settle()
  })

  it('selecting a station opens the Station tab at half height, with the time series inside the sheet', async () => {
    narrowScreen(true)
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?layers=stations')
    const sheet = screen.getByTestId('bottom-sheet')
    await waitFor(() => expect(screen.getAllByTestId('station-marker')).toHaveLength(2))
    fireEvent.click(screen.getAllByTestId('station-marker')[0])
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?layers=stations&station=1020.1'))
    await waitFor(() => expect(within(sheet).getByRole('tab', { name: 'Stations' })).toHaveAttribute('aria-selected', 'true'))
    expect(sheet.dataset.snap).toBe('half')
    expect(await within(sheet).findByTestId('timeseries-panel')).toBeInTheDocument()
    expect(within(sheet).getByTestId('timeseries-heading')).toHaveTextContent('Hilo Airport')
    // Closing leaves the Stations tab on the list of the day's stations.
    fireEvent.click(within(sheet).getByTestId('timeseries-close'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?layers=stations'))
    expect(within(sheet).getByRole('tab', { name: 'Stations' })).toHaveAttribute('aria-selected', 'true')
    expect(await within(sheet).findByTestId('station-list')).toBeInTheDocument()
  })

  it('a station in the address opens the Station tab on arrival, at peek height', async () => {
    narrowScreen(true)
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?station=1020.1')
    const sheet = screen.getByTestId('bottom-sheet')
    expect(within(sheet).getByRole('tab', { name: 'Stations' })).toHaveAttribute('aria-selected', 'true')
    expect(sheet.dataset.snap).toBe('peek')
    expect(await within(sheet).findByTestId('timeseries-panel')).toBeInTheDocument()
  })

  it('keeps the rail at 768 px and above', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai')
    expect(screen.getByTestId('viewer').dataset.layout).toBe('rail')
    expect(screen.queryByTestId('bottom-sheet')).toBeNull()
    expect(screen.getByTestId('viewer-controls')).toBeInTheDocument()
    await settle()
  })
})

// ── sharing and comparing ───────────────────────────────────────────────────
describe('sharing', () => {
  it('copies the canonical link with the clipboard API, whatever spelling the page was opened with', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderAt('/viewer/rain/daily/2026-09-07/ka?stations=1&units=in')
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/day/2026-09-07/kauai?units=in&layers=stations'))
    fireEvent.click(screen.getByTestId('copy-link'))
    await waitFor(() => expect(screen.getByTestId('copy-link')).toHaveTextContent('Link copied'))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/viewer/rainfall/day/2026-09-07/kauai?units=in&layers=stations`)
  })

  it('offers the system share sheet only where the browser has one, with the map title and the canonical link', async () => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true, writable: true })
    const { unmount } = renderAt('/viewer/rainfall/day/2026-09-07/kauai?units=in')
    expect(screen.queryByTestId('share-link')).toBeNull()
    unmount()
    const share = vi.fn(async () => {})
    Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true })
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?units=in')
    fireEvent.click(screen.getByTestId('share-link'))
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: 'Rainfall, September 7, 2026, Kauaʻi', url: `${window.location.origin}/viewer/rainfall/day/2026-09-07/kauai?units=in` }))
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true, writable: true })
  })

  it('QR / short link asks /api/shorten for the canonical path and shows the short link with a QR code of it', async () => {
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?units=in')
    fireEvent.click(screen.getByTestId('qr-link'))
    const field = await screen.findByTestId('short-link')
    await waitFor(() => expect(field).toHaveValue('http://localhost/s/k7Qz2'))
    const post = global.fetch.mock.calls.find(([u]) => String(u) === '/api/shorten')
    expect(post[1].method).toBe('POST')
    expect(JSON.parse(post[1].body)).toEqual({ path: '/viewer/rainfall/day/2026-09-07/kauai?units=in' })
    const qr = await screen.findByTestId('qr-code')
    expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(decodeURIComponent(qr.getAttribute('src'))).toContain('<svg')
    expect(qr).toHaveAttribute('alt', 'QR code that opens http://localhost/s/k7Qz2')
    expect(screen.getByText(/Print this page/)).toBeInTheDocument()
  })

  it('falls back to the long link (and a QR code of it) when the shortener fails', async () => {
    shortenMode = 500
    renderAt('/viewer/spi-3/month/2026-08/statewide')
    fireEvent.click(screen.getByTestId('qr-link'))
    const field = await screen.findByTestId('short-link')
    await waitFor(() => expect(field).toHaveValue(`${window.location.origin}/viewer/spi-3/month/2026-08/statewide`))
    expect(screen.getByTestId('short-link-fallback')).toHaveTextContent('did not answer')
    expect(await screen.findByTestId('qr-code')).toHaveAttribute('alt', `QR code that opens ${window.location.origin}/viewer/spi-3/month/2026-08/statewide`)
  })

  it('shows the address to copy by hand when the clipboard is refused', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied') }) }, configurable: true })
    renderAt('/viewer/spi-3/month/2026-08/statewide')
    fireEvent.click(screen.getByTestId('copy-link'))
    const fallback = await screen.findByTestId('copy-fallback')
    expect(within(fallback).getByRole('textbox')).toHaveValue(`${window.location.origin}/viewer/spi-3/month/2026-08/statewide`)
  })

  it('links out to the HCDP data portal in a new tab', async () => {
    renderAt('/viewer/spi-3/month/2026-08/statewide')
    const a = screen.getByTestId('portal-link')
    expect(a).toHaveAttribute('href', 'https://www.hawaii.edu/climate-data-portal/data-portal/')
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveTextContent('Open in the HCDP data portal')
    await settle()
  })
})

describe('compare=', () => {
  it('shows the second date side by side', async () => {
    renderAt('/viewer/rainfall/month/2026-08/statewide?compare=2025-08')
    const panes = screen.getAllByTestId('map-pane')
    expect(panes).toHaveLength(2)
    expect(within(panes[1]).getByTestId('viewer-title')).toHaveTextContent('Rainfall, August 2025, Statewide')
    await waitFor(() => expect(rasterCalls().map(([u]) => u)).toContain('/api/raster?dataset=rainfall&period=month&date=2025-08&extent=statewide'))
  })

  it('turns comparing on and off from the controls', async () => {
    renderAt('/viewer/rainfall/month/2026-08/statewide')
    fireEvent.click(screen.getByTestId('compare-switch'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/month/2026-08/statewide?compare=2025-08'))
    expect(screen.getAllByTestId('map-pane')).toHaveLength(2)
    fireEvent.click(screen.getByTestId('compare-switch'))
    await waitFor(() => expect(loc()).toBe('/viewer/rainfall/month/2026-08/statewide'))
  })
})
