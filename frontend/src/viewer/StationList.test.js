import { describe, it, expect } from 'vitest'
import { EMPTY_FILTERS, filterStations, filtersActive, joinStations, sortStations } from './StationList'

const VALUES = { stations: [
  { skn: '1020.1', name: 'Hilo Airport', island: 'BI', lat: 19.72, lng: -155.05, value: 12.3 },
  { skn: '800.2', name: 'Kahului', island: 'MA', lat: 20.9, lng: -156.43, value: 0 },
  { skn: '1075', name: 'Waimea', island: 'BI', lat: 20.02, lng: -155.67, value: 40.6 },
] }
const META = { stations: [
  { skn: '1020.1', name: 'Hilo Airport', island: 'BI', elevation_m: 11, network: 'NWS', observer: null },
  { skn: '800.2', name: 'Kahului', island: 'MA', elevation_m: 15, network: 'NWS', observer: 'FAA' },
] }

describe('the stations list', () => {
  const all = joinStations(VALUES, META)
  it('joins the day\'s values with the station list by SKN and tolerates a station the list lacks', () => {
    expect(all).toHaveLength(3)
    expect(all[0]).toMatchObject({ skn: '1020.1', name: 'Hilo Airport', island: 'BI', value: 12.3, elevation_m: 11, network: 'NWS' })
    expect(all[2]).toMatchObject({ skn: '1075', elevation_m: null, network: null })
    expect(joinStations(null, null)).toEqual([])
  })
  it('filters by island, name or SKN, elevation and value, each with an exclude switch', () => {
    const f = (patch) => filterStations(all, { ...EMPTY_FILTERS, ...patch }, 'rainfall', {}).map((s) => s.skn)
    expect(f({})).toEqual(['1020.1', '800.2', '1075'])
    expect(f({ islands: ['MA'] })).toEqual(['800.2'])
    expect(f({ islands: ['MA'], islandsNegate: true })).toEqual(['1020.1', '1075'])
    expect(f({ text: 'kah' })).toEqual(['800.2'])
    expect(f({ text: '1020' })).toEqual(['1020.1'])
    expect(f({ text: 'kah', textNegate: true })).toEqual(['1020.1', '1075'])
    expect(f({ elevMin: '12' })).toEqual(['800.2'])                           // Waimea has no elevation: never matches a range
    expect(f({ elevMin: '12', elevNegate: true })).toEqual(['1020.1'])
    expect(f({ elevMin: '', elevMax: '' })).toHaveLength(3)                     // blank bounds are no filter
    expect(f({ valueMin: '10', valueMax: '20' })).toEqual(['1020.1'])
    expect(f({ valueMin: '20', valueMax: '10' })).toEqual(['1020.1'])          // bounds in any order
    expect(f({ valueMin: '10', valueMax: '20', valueNegate: true })).toEqual(['800.2', '1075'])
    // value bounds are typed in display units: 1 in = 25.4 mm
    expect(filterStations(all, { ...EMPTY_FILTERS, valueMin: '1' }, 'rainfall', { units: 'in' }).map((s) => s.skn)).toEqual(['1075'])
    expect(filtersActive(EMPTY_FILTERS)).toBe(false)
    expect(filtersActive({ ...EMPTY_FILTERS, elevMax: '100' })).toBe(true)
    expect(filtersActive({ ...EMPTY_FILTERS, elevMax: 'abc' })).toBe(false)
  })
  it('sorts by any column, a missing field last either way', () => {
    const by = (key, dir) => sortStations(all, key, dir).map((s) => s.skn)
    expect(by('name', 'asc')).toEqual(['1020.1', '800.2', '1075'])
    expect(by('name', 'desc')).toEqual(['1075', '800.2', '1020.1'])
    expect(by('skn', 'asc')).toEqual(['800.2', '1020.1', '1075'])             // numeric, not alphabetic
    expect(by('island', 'asc')).toEqual(['1020.1', '1075', '800.2'])          // Hawaiʻi before Maui
    expect(by('elevation', 'desc')).toEqual(['800.2', '1020.1', '1075'])
    expect(by('elevation', 'asc')).toEqual(['1020.1', '800.2', '1075'])
    expect(by('value', 'desc')).toEqual(['1075', '1020.1', '800.2'])
  })
})
