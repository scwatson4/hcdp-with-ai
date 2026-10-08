import { describe, it, expect } from 'vitest'
import { shiftMonths } from './viewerModel'

describe('shiftMonths', () => {
  it('keeps the day when it exists and clamps it to the month otherwise', () => {
    expect(shiftMonths('2026-09-07', 'day', -1)).toBe('2026-08-07')
    expect(shiftMonths('2026-03-31', 'day', -1)).toBe('2026-02-28')
    expect(shiftMonths('2024-01-31', 'day', 1)).toBe('2024-02-29')
    expect(shiftMonths('2026-01-31', 'day', -1)).toBe('2025-12-31')
    expect(shiftMonths('2026-09-07', 'day', -12)).toBe('2025-09-07')
  })
  it('moves a month by whole months', () => {
    expect(shiftMonths('2026-08', 'month', -12)).toBe('2025-08')
    expect(shiftMonths('2026-08', 'month', 12)).toBe('2027-08')
    expect(shiftMonths('2026-01', 'month', -1)).toBe('2025-12')
  })
})
import {
  parseDateRange, dateForPeriod, shiftDate, clampDate, isRealDate, yearBefore, hawaiiYesterday, hawaiiLastMonth,
  legendFor, domainFor, autoDomainFor, rangeAbsoluteFor, legendValuesFor, legendLabelsFor, fromDisplay, convertDisplay, displayUnit, toDisplay,
  formatValue, unitsForDataset, selectedUnit, rampNameFor,
  rampOptionsFor, specFor, rasterRequestUrl, pathWith, compareDateFor, sourceLineFor, unitsLineFor, portalLabelFor,
} from './viewerModel'
import { NAMED_RAMPS, COLORMAP_OPTIONS, makeColorFn, makeScale, pseudoLog, rampGradient, rampPosition, hasData, valueAtLatLng, isNoData } from './ramps'
import { portalLegendLabels } from '../portalDatasets.reference'

const v = (dataset, period, date, extent = 'statewide', opts = {}) => ({ dataset, period, date, extent, opts })

describe('the /api/dates answer, whatever its shape', () => {
  it('reads the HCDP two-timestamp list (HST midnight is 10:00 UTC)', () => {
    const json = ['1990-01-01T10:00:00.000Z', '2026-09-23T10:00:00.000Z']
    expect(parseDateRange(json, 'day')).toEqual({ start: '1990-01-01', end: '2026-09-23' })
    expect(parseDateRange(['1990-01-01T10:00:00.000Z', '2026-08-01T10:00:00.000Z'], 'month')).toEqual({ start: '1990-01', end: '2026-08' })
  })
  it('reads {start, end}, {min, max} and nested objects', () => {
    expect(parseDateRange({ start: '2002-01-01', end: '2026-09-20' }, 'day')).toEqual({ start: '2002-01-01', end: '2026-09-20' })
    expect(parseDateRange({ min: '1990-03', max: '2026-08' }, 'month')).toEqual({ start: '1990-03', end: '2026-08' })
    expect(parseDateRange({ result: { range: { startDate: '2000-03-10T10:00:00Z', endDate: '2026-09-20T10:00:00Z' } } }, 'day'))
      .toEqual({ start: '2000-03-10', end: '2026-09-20' })
    expect(parseDateRange({ data: [{ date: '2026-09-01' }, { date: '1999-12-31' }, { date: '2010-06-15' }] }, 'day'))
      .toEqual({ start: '1999-12-31', end: '2026-09-01' })
  })
  it('turns a month-only answer into whole days, and gives up on nonsense', () => {
    expect(parseDateRange(['1990-01', '2026-02'], 'day')).toEqual({ start: '1990-01-01', end: '2026-02-28' })
    expect(parseDateRange({ min: 0, max: 5 }, 'day')).toBeNull()
    expect(parseDateRange(null, 'day')).toBeNull()
    expect(parseDateRange('no data', 'day')).toBeNull()
  })
})

describe('date arithmetic', () => {
  it('steps days and months across boundaries', () => {
    expect(shiftDate('2026-03-01', 'day', -1)).toBe('2026-02-28')
    expect(shiftDate('2024-12-31', 'day', 1)).toBe('2025-01-01')
    expect(shiftDate('2026-01', 'month', -1)).toBe('2025-12')
  })
  it('converts between periods inside the published range', () => {
    const month = { start: '1990-01', end: '2026-08' }
    const day = { start: '1990-01-01', end: '2026-09-23' }
    expect(dateForPeriod('2026-09-07', 'month', month)).toBe('2026-08')
    expect(dateForPeriod('2026-07-15', 'month', month)).toBe('2026-07')
    expect(dateForPeriod('2026-08', 'day', day)).toBe('2026-08-31')
    expect(dateForPeriod('2026-09', 'day', day)).toBe('2026-09-23')
    expect(dateForPeriod('2026-09', 'day', null)).toBe('2026-09-30')
    expect(clampDate('1980-01-01', day)).toBe('1990-01-01')
  })
  it('knows a real date and the year before', () => {
    expect(isRealDate('2026-02-29', 'day')).toBe(false)
    expect(isRealDate('2024-02-29', 'day')).toBe(true)
    expect(isRealDate('2026-13', 'month')).toBe(false)
    expect(yearBefore('2024-02-29')).toBe('2023-02-28')
    expect(yearBefore('2026-08')).toBe('2025-08')
  })
  it('counts yesterday and last month in Hawaiʻi time', () => {
    // 05:00 UTC on 25 Sep is still 24 Sep (19:00) in Honolulu.
    expect(hawaiiYesterday(new Date('2026-09-25T05:00:00Z'))).toBe('2026-09-23')
    expect(hawaiiYesterday(new Date('2026-09-25T20:00:00Z'))).toBe('2026-09-24')
    expect(hawaiiLastMonth(new Date('2026-01-10T20:00:00Z'))).toBe('2025-12')
  })
})

describe('the portal facts behind the legend', () => {
  it('uses the portal ranges, the extreme daily-rainfall scale, and SPI timescales', () => {
    expect(domainFor(v('rainfall', 'day', '2026-09-07'))).toEqual({ min: 0, max: 20 })
    expect(domainFor(v('rainfall', 'day', '2026-09-07', 'kauai', { scale: 'extreme' }))).toEqual({ min: 0, max: 250 })
    expect(domainFor(v('rainfall', 'month', '2026-08', 'kauai', { scale: 'extreme' }))).toEqual({ min: 0, max: 650 })
    expect(domainFor(v('spi-3', 'month', '2026-08'))).toEqual({ min: -3, max: 3 })
    expect(specFor(v('spi-12', 'month', '2026-08')).timescale).toBe(12)
    expect(portalLabelFor(v('spi-3', 'month', '2026-08'))).toBe('3-Month Standardized Precipitation Index (SPI-3)')
  })
  it('writes legend labels in the display units only', () => {
    expect(legendFor(v('rainfall', 'month', '2026-08'))).toEqual({ header: 'Rainfall (mm)', labels: ['+650+', '+487.5', '+325', '+162.5', '0'] })
    expect(legendFor(v('rainfall', 'day', '2026-09-07', 'kauai', { units: 'in' })).header).toBe('Rainfall (in)')
    expect(legendFor(v('rainfall', 'day', '2026-09-07', 'kauai', { units: 'in' })).labels[0]).toBe('+0.79+')
    expect(legendFor(v('temperature-mean', 'day', '2026-09-07', 'maui', { units: 'f' })).labels).toEqual(['+95+', '+74.75', '+54.5', '+34.25', '+14-'])
    expect(legendFor(v('spi-3', 'month', '2026-08')).labels).toEqual(['+3+', '+1.5', '0', '-1.5', '-3-'])
    expect(legendFor(v('humidity', 'day', '2026-09-01')).header).toBe('Relative Humidity (%)')
  })
  it('lets a locked ?range= win over the portal scale and marks its open ends', () => {
    const locked = v('rainfall', 'month', '2026-08', 'kauai', { range: { min: 0, max: 300 } })
    expect(domainFor(locked)).toEqual({ min: 0, max: 300 })
    expect(autoDomainFor(locked)).toEqual({ min: 0, max: 650 })
    expect(domainFor(v('rainfall', 'day', '2026-09-07', 'kauai', { scale: 'extreme', range: { min: 0, max: 400 } }))).toEqual({ min: 0, max: 400 })
    expect(legendFor(locked).labels).toEqual(['+300+', '+225', '+150', '+75', '0'])                   // 0 is the portal's closed end, 300 is open
    expect(rangeAbsoluteFor(v('rainfall', 'month', '2026-08', 'kauai', { range: { min: 10, max: 300 } }))).toEqual([false, false])
    expect(legendFor(v('humidity', 'day', '2026-09-01', 'oahu', { range: { min: 20, max: 100 } })).labels).toEqual(['+100', '+80', '+60', '+40', '+20-'])
    expect(legendFor(v('temperature-max', 'month', '2026-08', 'oahu', { range: { min: 0, max: 30 }, units: 'f' })).labels).toEqual(['+86+', '+72.5', '+59', '+45.5', '+32-'])
    // a nonsense range object (min ≥ max) falls back to the automatic domain
    expect(domainFor(v('rainfall', 'month', '2026-08', 'kauai', { range: { min: 5, max: 5 } }))).toEqual({ min: 0, max: 650 })
  })
  it('reads pseudo-log legends at the values the colours stand for', () => {
    const log = v('rainfall', 'day', '2026-09-07', 'kauai', { log: true })
    expect(legendFor(log).labels).toEqual(['+20+', '+8.81', '+3.58', '+1.14', '0'])                    // 21^t − 1 at t = 1, ¾, ½, ¼, 0
    expect(legendValuesFor(v('spi-3', 'month', '2026-08', 'statewide', { log: true })).map((x) => Math.round(x * 100) / 100)).toEqual([3, 1, 0, -1, -3])
    expect(legendFor(v('spi-3', 'month', '2026-08', 'statewide', { log: true })).labels).toEqual(['+3+', '+1', '0', '-1', '-3-'])
    // the linear labels are the portal's own, to the character
    for (const view of [v('rainfall', 'month', '2026-08'), v('spi-3', 'month', '2026-08'), v('humidity', 'day', '2026-09-01')]) {
      const { min, max } = domainFor(view)
      expect(legendFor(view).labels).toEqual(portalLegendLabels([min, max], rangeAbsoluteFor(view)))
    }
    expect(legendLabelsFor([0.001, -0.001])).toEqual(['0', '0'])                                       // never "-0"
  })
  it('converts display units both ways', () => {
    expect(fromDisplay(1, 'rainfall', { units: 'in' })).toBeCloseTo(25.4)
    expect(fromDisplay(50, 'temperature-max', { units: 'f' })).toBeCloseTo(10)
    expect(fromDisplay(7, 'rainfall', {})).toBe(7)
    expect(fromDisplay(0.5, 'spi-3', { units: 'in' })).toBe(0.5)
    expect(convertDisplay(20, 'rainfall', { units: 'in' })).toBeCloseTo(0.7874, 4)
    expect(toDisplay(20, 'rainfall', { units: 'in' })).toBe(0.79)
  })
  it('converts readouts and keeps a unit system across datasets', () => {
    expect(displayUnit('rainfall', { units: 'in' })).toBe('in')
    expect(displayUnit('temperature-min', { units: 'in' })).toBe('°F')
    expect(displayUnit('ndvi', { units: 'in' })).toBe('')
    expect(toDisplay(25.4, 'rainfall', { units: 'in' })).toBe(1)
    expect(toDisplay(100, 'temperature-max', { units: 'f' })).toBe(212)
    expect(formatValue(12.345, 'rainfall', {})).toBe('12.3 mm')
    expect(formatValue(12.7, 'rainfall', { units: 'in' })).toBe('0.50 in')
    expect(formatValue(0.4567, 'ndvi', {})).toBe('0.46')
    expect(formatValue(55.2, 'humidity', {})).toBe('55%')
    expect(unitsForDataset('temperature-mean', { units: 'in' })).toBe('f')
    expect(unitsForDataset('rainfall', { units: 'c' })).toBeUndefined()
    expect(unitsForDataset('spi-3', { units: 'in' })).toBe('in')
    expect(selectedUnit('rainfall', { units: 'f' })).toBe('in')
    expect(selectedUnit('spi-3', {})).toBeNull()
  })
  it('names the ramp in effect and marks the portal default first', () => {
    expect(rampNameFor(v('rainfall', 'day', '2026-09-07'))).toBe('viridis_r')
    expect(rampNameFor(v('temperature-max', 'month', '2026-08'))).toBe('viridis')
    expect(rampNameFor(v('rainfall', 'day', '2026-09-07', 'kauai', { ramp: 'turbo' }))).toBe('turbo')
    expect(rampNameFor(v('rainfall', 'day', '2026-09-07', 'kauai', { ramp: 'nope' }))).toBe('viridis_r')
    const opts = rampOptionsFor('ignition')
    expect(opts[0]).toMatchObject({ value: 'viridis' })
    expect(opts[0].label).toBe('Viridis reversed (HCDP default)')
    expect(rampOptionsFor('rainfall')[0].label).toBe('Viridis (HCDP default)')
    expect(opts).toHaveLength(COLORMAP_OPTIONS.length)
    expect(COLORMAP_OPTIONS.every((o) => NAMED_RAMPS[o.value])).toBe(true)
  })
  it('titles the units and the source', () => {
    expect(unitsLineFor(v('rainfall', 'day', '2026-09-07'))).toBe('Units: millimetres (mm)')
    expect(unitsLineFor(v('spi-3', 'month', '2026-08'))).toBe('Units: none (an index)')
    expect(unitsLineFor(v('ignition', 'day', '2026-09-01'))).toBe('Units: probability, 0 to 1')
    expect(sourceLineFor(v('rainfall', 'month', '2026-08'))).toMatch(/Frazier et al\. 2016/)
    expect(sourceLineFor(v('spi-3', 'month', '2026-08'))).toMatch(/McKee et al\. 1993/)
  })
})

describe('requests and next URLs', () => {
  it('asks the backend with the viewer names, one URL per map', () => {
    expect(rasterRequestUrl(v('rainfall', 'day', '2026-09-07', 'kauai'))).toBe('/api/raster?dataset=rainfall&period=day&date=2026-09-07&extent=kauai')
  })
  it('builds the next path through formatViewerPath, dropping unset options', () => {
    const cur = v('rainfall', 'day', '2026-09-07', 'kauai', { units: 'in', view: { lat: 22.1, lng: -159.6, z: 11 } })
    expect(pathWith(cur, { extent: 'oahu', opts: { view: undefined } })).toBe('/viewer/rainfall/day/2026-09-07/oahu?units=in')
    expect(pathWith(cur, { opts: { ramp: 'turbo' } })).toBe('/viewer/rainfall/day/2026-09-07/kauai?ramp=turbo&units=in&lat=22.1000&lng=-159.6000&z=11')
  })
  it('accepts a compare date only in the map period format', () => {
    expect(compareDateFor(v('rainfall', 'month', '2026-08', 'statewide', { compare: '2025-08' }))).toBe('2025-08')
    expect(compareDateFor(v('rainfall', 'day', '2026-09-07', 'statewide', { compare: '2025-08' }))).toBeNull()
    expect(compareDateFor(v('rainfall', 'day', '2026-09-07', 'statewide', { compare: '2025-09-07' }))).toBe('2025-09-07')
  })
})

describe('pixels', () => {
  const g = { xmin: -160, ymax: 23, pixelWidth: 1, pixelHeight: 1, width: 2, height: 2, noDataValue: -9999, values: [[[0, 20], [-9999, 3.4e38]]] }
  it('colours values on the ramp and leaves nodata transparent', () => {
    const fn = makeColorFn(NAMED_RAMPS.viridis_r, { min: 0, max: 20 }, -9999)
    expect(fn([0])).toBe('rgb(253,231,37)') // viridis_r: yellow = low
    expect(fn([20])).toBe('rgb(68,1,84)')
    expect(fn([500])).toBe('rgb(68,1,84)') // past the end clamps, like the portal
    expect(fn([-9999])).toBeNull()
    expect(fn([-3.4e38])).toBeNull()
  })
  it('runs a ramp the other way and on a pseudo-log scale', () => {
    const reversed = makeColorFn(NAMED_RAMPS.viridis_r, { min: 0, max: 20 }, -9999, { reverse: true })
    expect(reversed([0])).toBe('rgb(68,1,84)')
    expect(reversed([20])).toBe('rgb(253,231,37)')
    expect(reversed([-9999])).toBeNull()
    const log = makeColorFn(NAMED_RAMPS.viridis_r, { min: 0, max: 20 }, -9999, { log: true })
    const linear = makeColorFn(NAMED_RAMPS.viridis_r, { min: 0, max: 20 }, -9999)
    expect(log([0])).toBe(linear([0]))
    expect(log([20])).toBe(linear([20]))
    expect(log([5])).toBe(linear([20 * Math.log1p(5) / Math.log1p(20)]))                              // 5 mm sits where 11.8 mm does linearly
    expect(pseudoLog(-3)).toBe(-pseudoLog(3))
    const scale = makeScale({ min: -3, max: 3 }, { log: true })
    expect(scale.position(0)).toBeCloseTo(0.5)
    expect(scale.valueAt(scale.position(1.7))).toBeCloseTo(1.7)
    expect(rampPosition(5, 0, 20)).toBe(0.25)
    expect(rampPosition(5, 0, 20, true)).toBeCloseTo(Math.log1p(5) / Math.log1p(20))
    expect(rampGradient([[0, '#000000'], [0.25, '#444444'], [1, '#ffffff']])).toBe('linear-gradient(to top, #000000 0%, #444444 25%, #ffffff 100%)')
    expect(rampGradient([[0, '#000000'], [0.25, '#444444'], [1, '#ffffff']], true)).toBe('linear-gradient(to top, #ffffff 0%, #444444 75%, #000000 100%)')
  })
  it('reads a value at a point and knows an all-nodata grid', () => {
    expect(valueAtLatLng(g, 22.5, -158.5)).toBe(20)
    expect(valueAtLatLng(g, 21.5, -159.5)).toBeNull()
    expect(valueAtLatLng(g, 30, -150)).toBeNull()
    expect(hasData(g)).toBe(true)
    expect(hasData({ ...g, values: [[[-9999, -9999], [-3.4e38, NaN]]] })).toBe(false)
    expect(isNoData(null)).toBe(true)
  })
})
