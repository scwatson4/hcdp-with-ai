import { describe, it, expect } from 'vitest'
import { parseViewerPath, formatViewerPath, parseDateSegments, apiParamsFor, describeViewer, isRealDate, canonicalize, isCanonical, foreignQuery, parseRange, parseLegendRange, formatLegendRange, parseRamp, formatRamp, QUERY_KEYS, RAMP_NAMES } from './urlGrammar'
import { NAMED_RAMPS } from './map/ramps'

describe('viewer URL grammar', () => {
  it('parses the canonical forms', () => {
    expect(parseViewerPath('/viewer/rainfall/day/2025-10-21/hawaii')).toMatchObject({ dataset: 'rainfall', period: 'day', date: '2025-10-21', extent: 'hawaii' })
    expect(parseViewerPath('/viewer/spi-3/month/2026-08/statewide')).toMatchObject({ dataset: 'spi-3', period: 'month', date: '2026-08', extent: 'statewide' })
  })
  it('accepts month names in either order, as people type them', () => {
    expect(parseDateSegments(['october', '21', '2025'])).toBe('2025-10-21')
    expect(parseDateSegments(['2025', 'october', '21'])).toBe('2025-10-21')
    expect(parseDateSegments(['oct', '2025'])).toBe('2025-10')
    expect(parseDateSegments(['2025', '10'])).toBe('2025-10')
    expect(parseDateSegments(['2025-10-21'])).toBe('2025-10-21')
    expect(parseViewerPath('/viewer/rainfall/day/october/21/2025/hawaii')).toMatchObject({ date: '2025-10-21', extent: 'hawaii' })
  })
  it('round-trips options', () => {
    const p = { dataset: 'rainfall', period: 'month', date: '2026-09', extent: 'kauai', opts: { units: 'in', stations: true, view: { lat: 22.0612, lng: -159.5, z: 11 } } }
    const path = formatViewerPath(p)
    expect(path).toBe('/viewer/rainfall/month/2026-09/kauai?units=in&layers=stations&lat=22.0612&lng=-159.5000&z=11')
    const [pathname, search] = path.split('?')
    expect(parseViewerPath(pathname, '?' + search)).toMatchObject({ ...p, opts: { units: 'in', layers: ['stations'], view: { lat: 22.0612, lng: -159.5, z: 11 } } })
    // the first grammar's ?stations=1 still reads, and canonicalises to layers=
    expect(parseViewerPath(pathname, '?stations=1').opts.layers).toEqual(['stations'])
  })
  it('rejects what it cannot show, with a reason', () => {
    expect(parseViewerPath('/viewer/humidity/month/2026-08/statewide').error).toMatch(/not available by month/)
    expect(parseViewerPath('/viewer/rainfall/day/2026-08/statewide').error).toMatch(/full date/)
    expect(parseViewerPath('/viewer/rainfall/month/2026-08-01/statewide').error).toMatch(/YYYY-MM/)
    expect(parseViewerPath('/viewer/wind/day/2026-08-01/statewide').error).toMatch(/unknown dataset/)
    expect(parseViewerPath('/viewer/rainfall/day/2026-08-01/mars').error).toMatch(/unknown extent/)
    expect(parseViewerPath('/viewer/rainfall/day/2026-08-01/bigisland').extent).toBe('hawaii')   // an alias, not an error
    expect(parseViewerPath('/about')).toBeNull()
  })
  it('only accepts real calendar dates', () => {
    expect(parseDateSegments(['2026-02-30'])).toBeNull()
    expect(parseDateSegments(['february', '29', '2024'])).toBe('2024-02-29')
    expect(parseDateSegments(['february', '29', '2026'])).toBeNull()
    expect(parseViewerPath('/viewer/rainfall/day/2026-02-30/oahu').error).toBe('no such date 2026-02-30')
    expect(isRealDate('2026-09-31')).toBe(false)
    expect(parseViewerPath('/viewer/rainfall/day/2026-09-07/kauai', '?compare=2026-09-06').opts.compare).toBe('2026-09-06')
    expect(parseViewerPath('/viewer/rainfall/day/2026-09-07/kauai', '?compare=2026-13').opts.compare).toBeUndefined()
  })
  it('maps to the HCDP API parameters', () => {
    expect(apiParamsFor({ dataset: 'temperature-max', period: 'day', date: '2026-09-01', extent: 'maui' })).toEqual({ datatype: 'temperature', aggregation: 'max', period: 'day', date: '2026-09-01', extent: 'mn' })
    expect(apiParamsFor({ dataset: 'spi-12', period: 'month', date: '2026-08', extent: 'statewide' })).toEqual({ datatype: 'spi', timescale: 'timescale012', period: 'month', date: '2026-08', extent: 'statewide' })
    expect(apiParamsFor({ dataset: 'spi-3', period: 'month', date: '2026-08', extent: 'maui' }).extent).toBe('statewide')   // SPI: statewide grid, zoomed
  })
  it('describes a view in plain words', () => {
    expect(describeViewer({ dataset: 'rainfall', period: 'day', date: '2026-09-07', extent: 'kauai' })).toBe('Rainfall, September 7, 2026, Kauaʻi')
    expect(describeViewer({ dataset: 'spi-3', period: 'month', date: '2026-08', extent: 'statewide' })).toBe('Drought index (SPI, 3 months), August 2026, Statewide')
  })
  it('reads the new keys, drops bad values, and writes them in one order', () => {
    const v = parseViewerPath('/viewer/rainfall/day/2026-09-07/kauai', '?z=10&lng=-159.5&lat=22.05&opacity=60&basemap=street&layers=outline,stations,bogus&station=1020.1&ts=2025-10-01..2026-09-30&ramp=turbo')
    expect(v.opts).toEqual({ ramp: 'turbo', basemap: 'street', opacity: 60, layers: ['stations', 'outline'], station: '1020.1', ts: { start: '2025-10-01', end: '2026-09-30' }, view: { lat: 22.05, lng: -159.5, z: 10 } })
    expect(formatViewerPath(v)).toBe('/viewer/rainfall/day/2026-09-07/kauai?ramp=turbo&basemap=street&opacity=60&layers=stations,outline&station=1020.1&ts=2025-10-01..2026-09-30&lat=22.0500&lng=-159.5000&z=10')
    // defaults vanish; a pin needs no station; ts without a selection is dropped
    expect(formatViewerPath({ dataset: 'rainfall', period: 'day', date: '2026-09-07', extent: 'kauai', opts: { basemap: 'satellite', opacity: 75, units: 'mm', pin: { lat: 22.0512, lng: -159.5001 }, tsp: 'day' } })).toBe('/viewer/rainfall/day/2026-09-07/kauai?pin=22.0512,-159.5001')
    expect(parseViewerPath('/viewer/rainfall/day/2026-09-07/kauai', '?ts=2025-10..2026-09').opts.ts).toBeUndefined()
    expect(parseViewerPath('/viewer/rainfall/day/2026-09-07/kauai', '?opacity=140&basemap=mars&pin=5,5&station=abc').opts).toEqual({})
    expect(parseRange('2026-09-30..2025-10-01')).toEqual({ start: '2025-10-01', end: '2026-09-30' })
    expect(parseRange('2026-02-30..2026-03-01')).toBeNull()
  })
  it('resolves aliases and canonicalises hand-typed links', () => {
    expect(canonicalize('/viewer/rain/daily/october/21/2025/big-island', '?z=9&units=mm&lat=19.6&lng=-155.5&stations=1')).toBe('/viewer/rainfall/day/2025-10-21/hawaii?layers=stations&lat=19.6000&lng=-155.5000&z=9')
    expect(canonicalize('/viewer/spi3/month/2026-08/bi')).toBe('/viewer/spi-3/month/2026-08/hawaii')
    expect(canonicalize('/viewer/temp-max/day/2026-09-01/oa')).toBe('/viewer/temperature-max/day/2026-09-01/oahu')
    expect(canonicalize('/viewer/wind/day/2026-09-01/oahu')).toBeNull()
    expect(isCanonical('/viewer/rainfall/day/2025-10-21/hawaii', '?lat=19.6000&lng=-155.5000&z=9')).toBe(true)
    expect(isCanonical('/viewer/rainfall/day/2025-10-21/hawaii', '?z=9&lat=19.6000&lng=-155.5000')).toBe(false)
    expect(foreignQuery('?ask=hello&z=9&stations=1&utm_source=x')).toBe('ask=hello&utm_source=x')
  })
  it('reads the colour-scale modifiers: a reversed ramp, a locked legend range and pseudo-log, in their place after scale', () => {
    expect(QUERY_KEYS.slice(0, 5)).toEqual(['ramp', 'scale', 'range', 'log', 'units'])
    expect(RAMP_NAMES).toEqual(Object.keys(NAMED_RAMPS))
    const v = parseViewerPath('/viewer/rainfall/day/2026-09-07/kauai', '?log=1&units=in&range=0..100&scale=extreme&ramp=viridis-r')
    expect(v.opts).toEqual({ ramp: 'viridis', reverse: true, scale: 'extreme', range: { min: 0, max: 100 }, log: true, units: 'in' })
    expect(formatViewerPath(v)).toBe('/viewer/rainfall/day/2026-09-07/kauai?ramp=viridis-r&scale=extreme&range=0..100&log=1&units=in')
    expect(isCanonical('/viewer/rainfall/day/2026-09-07/kauai', '?ramp=viridis-r&scale=extreme&range=0..100&log=1&units=in')).toBe(true)
    // the range is written in the dataset's native units with up to two decimals, no trailing zeros, ends in order
    expect(canonicalize('/viewer/temperature-max/month/2026-08/oahu', '?range=35.00..-10.50&units=f')).toBe('/viewer/temperature-max/month/2026-08/oahu?range=-10.5..35&units=f')
    expect(parseLegendRange('0.25..1')).toEqual({ min: 0.25, max: 1 })
    expect(formatLegendRange({ min: -0, max: 20.1 })).toBe('0..20.1')
    expect(formatLegendRange({ min: 5, max: 5 })).toBeNull()
    // the reverse flag travels on the ramp key, so without a ramp it cannot be written
    expect(parseRamp('turbo-r')).toEqual({ ramp: 'turbo', reverse: true })
    expect(parseRamp('viridis_r')).toEqual({ ramp: 'viridis_r', reverse: false })
    expect(formatRamp('viridis_r', true)).toBe('viridis_r-r')
    expect(formatViewerPath({ dataset: 'rainfall', period: 'day', date: '2026-09-07', extent: 'kauai', opts: { reverse: true } })).toBe('/viewer/rainfall/day/2026-09-07/kauai')
    // bad values vanish silently: an unknown ramp (reversed or not), a one-ended or equal range, three decimals, log=2, scale=huge
    expect(parseViewerPath('/viewer/rainfall/day/2026-09-07/kauai', '?ramp=rainbow&range=0..0&log=2&scale=huge').opts).toEqual({})
    expect(parseViewerPath('/viewer/rainfall/day/2026-09-07/kauai', '?ramp=rainbow-r&range=abc&log=true').opts).toEqual({})
    expect(parseViewerPath('/viewer/rainfall/day/2026-09-07/kauai', '?range=0..1.234').opts).toEqual({})
    expect(parseViewerPath('/viewer/rainfall/day/2026-09-07/kauai', '?range=0..').opts).toEqual({})
    expect(parseViewerPath('/viewer/rainfall/day/2026-09-07/kauai', '?range=1e3..2e3').opts).toEqual({})
    expect(canonicalize('/viewer/rainfall/day/2026-09-07/kauai', '?ramp=rainbow&log=2&range=x..y&units=in')).toBe('/viewer/rainfall/day/2026-09-07/kauai?units=in')
    // they are the grammar's own keys, so a canonical rewrite keeps nothing of theirs as foreign
    expect(foreignQuery('?range=0..1&log=1&ask=hi')).toBe('ask=hi')
  })
  it('knows the added products', () => {
    expect(apiParamsFor({ dataset: 'spi-36', period: 'month', date: '2025-09', extent: 'maui' })).toEqual({ datatype: 'spi', timescale: 'timescale036', period: 'month', date: '2025-09', extent: 'statewide' })
    expect(apiParamsFor({ dataset: 'ignition-lead-2', period: 'day', date: '2026-09-29', extent: 'statewide' })).toEqual({ datatype: 'ignition_probability', lead: 'lead02', period: 'day', date: '2026-09-29', extent: 'statewide' })
    expect(apiParamsFor({ dataset: 'rainfall-legacy', period: 'month', date: '1950-03', extent: 'oahu' })).toEqual({ datatype: 'rainfall', production: 'legacy', period: 'month', date: '1950-03', extent: 'statewide' })
    expect(parseViewerPath('/viewer/rainfall-legacy/day/1950-03-01/statewide').error).toMatch(/not available by day/)
    expect(describeViewer({ dataset: 'ignition-lead-1', period: 'day', date: '2026-09-29', extent: 'statewide' })).toBe('Ignition probability, 1 day ahead, September 29, 2026, Statewide')
  })
})
