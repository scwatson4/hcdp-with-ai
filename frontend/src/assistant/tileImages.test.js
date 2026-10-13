import { describe, it, expect } from 'vitest'
import { FALLBACK, FALLBACK_SRC, STORM_MAPS, mapImage, tileImageFor } from './tileImages'

// R5 C (13 Oct): which picture a did-you-mean tile wears.
describe('tileImageFor', () => {
  it('a tool slug gets the portal’s own tile picture (and the AI door its own)', () => {
    expect(tileImageFor({ url: '/tools/h-rip' })).toMatchObject({ src: '/tools/h-rip.jpg', width: 663, height: 500 })
    expect(tileImageFor({ url: '/tools/rainfall-atlas' }).src).toBe('/tools/rainfall-atlas.jpg')
    expect(tileImageFor({ url: '/tools/ai-data-analysis' }).src).toBe('/tiles/ai-data-analysis.jpg')
    expect(tileImageFor({ url: '/tools/no-such-tool' })).toEqual(FALLBACK)
  })
  it('a viewer address gets a rendered map over the hero’s ocean, with the backdrop as its fallback', () => {
    const img = tileImageFor({ url: '/viewer/ignition/day/2026-10-12/statewide' })
    expect(img.src).toBe('/api/map.webp?dataset=ignition&period=day&date=2026-10-12&extent=statewide&w=800&bg=bfe0f7')
    expect(img.fallback).toBe(FALLBACK_SRC)
    expect(tileImageFor({ path: '/viewer/spi-3/month/2026-09/statewide?units=in' }).src).toContain('dataset=spi-3&period=month&date=2026-09&extent=statewide')
    expect(tileImageFor({ url: '/viewer/rain/day/2026-09-07/ka' }).src).toContain('dataset=rainfall&period=day&date=2026-09-07&extent=kauai')   // aliases resolve
    expect(tileImageFor({ url: '/viewer/nope/day/2026-09-07/kauai' })).toEqual(FALLBACK)
  })
  it('a storm report gets its peak-day map; pages and external links the backdrop', () => {
    expect(tileImageFor({ url: '/extreme-events/lowell' })).toEqual(mapImage(...STORM_MAPS.lowell))
    expect(tileImageFor({ url: '/extreme-events#lala' }).src).toContain('date=2026-08-15&extent=hawaii')
    expect(tileImageFor({ url: '/extreme-events/kona-low-1' }).src).toContain('period=month&date=2026-03')
    expect(tileImageFor({ url: '/extreme-events' })).toEqual(FALLBACK)
    expect(tileImageFor({ url: '/data' })).toEqual(FALLBACK)
    expect(tileImageFor({ url: 'https://www.hawaii.edu/climate-data-portal/fire-and-rain/' })).toEqual(FALLBACK)
    expect(tileImageFor(null)).toEqual(FALLBACK)
  })
})
