import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom'
import ViewerPage from './ViewerPage'
import { clearRasterCache } from './map/rasterCache'
import { clearDateRanges } from './map/dateRanges'

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
    getContainer() { return null },
    on() {}, off() {},
    fire(name, e = {}) { for (const h of [...handlers]) h[name]?.(e) },
  }
  return { map, handlers, layers: [], instances: [], mapProps: [] }
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
    TileLayer: ({ url }) => <div data-testid="tile-layer" data-url={url} />,
    ScaleControl: () => <div data-testid="scale-control" />,
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
    constructor(opts) { this.opts = opts; this.ownCache = false; fake.layers.push(opts); fake.instances.push(this) }
    clearCache() { this.ownCache = true }
    addTo() { return this }
    setOpacity() {}
  },
}))

// ── fetch ───────────────────────────────────────────────────────────────────
const DAY_RANGE = ['1990-01-01T10:00:00.000Z', '2026-09-23T10:00:00.000Z']
const MONTH_RANGE = ['1990-01-01T10:00:00.000Z', '2026-08-01T10:00:00.000Z']

let rasterMode = 'data' // 'data' | 'empty' | 404 | 500 | 'network' | 'hang'
let hung = []
function installFetch() {
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = new URL(url, 'http://localhost')
    if (u.pathname === '/api/dates') {
      const body = u.searchParams.get('period') === 'month' ? MONTH_RANGE : DAY_RANGE
      return { ok: true, status: 200, json: async () => body }
    }
    if (u.pathname === '/api/raster') {
      if (rasterMode === 'network') throw new TypeError('Failed to fetch')
      if (rasterMode === 404) return { ok: false, status: 404, json: async () => ({ detail: 'no map for that date' }) }
      if (rasterMode === 500) return { ok: false, status: 502, json: async () => ({ detail: 'HCDP API returned 500' }) }
      if (rasterMode === 'hang') {
        return new Promise((resolve, reject) => {
          hung.push({ url: String(url), signal: init.signal, resolve })
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
      }
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(rasterMode === 'empty' ? 8 : 16) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}
const rasterCalls = () => global.fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/raster'))

// ── rendering at a URL ──────────────────────────────────────────────────────
function Probe() {
  const loc = useLocation()
  const type = useNavigationType()
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

beforeEach(() => {
  rasterMode = 'data'
  hung = []
  fake.handlers.clear()
  fake.layers.length = 0
  fake.instances.length = 0
  fake.mapProps.length = 0
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

// ── sharing and comparing ───────────────────────────────────────────────────
describe('sharing', () => {
  it('copies the link with the clipboard API', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderAt('/viewer/rainfall/day/2026-09-07/kauai?units=in')
    fireEvent.click(screen.getByTestId('copy-link'))
    await waitFor(() => expect(screen.getByTestId('copy-link')).toHaveTextContent('Link copied'))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/viewer/rainfall/day/2026-09-07/kauai?units=in`)
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
