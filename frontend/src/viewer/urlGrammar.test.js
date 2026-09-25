import { describe, it, expect } from 'vitest'
import { parseViewerPath, formatViewerPath, parseDateSegments, apiParamsFor, describeViewer } from './urlGrammar'

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
    expect(path).toBe('/viewer/rainfall/month/2026-09/kauai?units=in&stations=1&lat=22.0612&lng=-159.5000&z=11')
    const [pathname, search] = path.split('?')
    expect(parseViewerPath(pathname, '?' + search)).toMatchObject({ ...p, opts: { units: 'in', stations: true, view: { lat: 22.0612, lng: -159.5, z: 11 } } })
  })
  it('rejects what it cannot show, with a reason', () => {
    expect(parseViewerPath('/viewer/humidity/month/2026-08/statewide').error).toMatch(/not available by month/)
    expect(parseViewerPath('/viewer/rainfall/day/2026-08/statewide').error).toMatch(/full date/)
    expect(parseViewerPath('/viewer/rainfall/month/2026-08-01/statewide').error).toMatch(/YYYY-MM/)
    expect(parseViewerPath('/viewer/wind/day/2026-08-01/statewide').error).toMatch(/unknown dataset/)
    expect(parseViewerPath('/viewer/rainfall/day/2026-08-01/bigisland').error).toMatch(/unknown extent/)
    expect(parseViewerPath('/about')).toBeNull()
  })
  it('maps to the HCDP API parameters', () => {
    expect(apiParamsFor({ dataset: 'temperature-max', period: 'day', date: '2026-09-01', extent: 'maui' })).toEqual({ datatype: 'temperature', aggregation: 'max', period: 'day', date: '2026-09-01', extent: 'mn' })
    expect(apiParamsFor({ dataset: 'spi-12', period: 'month', date: '2026-08', extent: 'statewide' })).toEqual({ datatype: 'spi', timescale: 'timescale012', period: 'month', date: '2026-08', extent: 'statewide' })
  })
  it('describes a view in plain words', () => {
    expect(describeViewer({ dataset: 'rainfall', period: 'day', date: '2026-09-07', extent: 'kauai' })).toBe('Rainfall, September 7, 2026, Kauaʻi')
    expect(describeViewer({ dataset: 'spi-3', period: 'month', date: '2026-08', extent: 'statewide' })).toBe('Drought index (SPI, 3 months), August 2026, Statewide')
  })
})
