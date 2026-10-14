import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { dateLabel, datedTitle, fold, fillTemplate, kindWord, latestDateFor, localMatch, shortTitle, MAX_MATCHES, MIN_CHARS } from './localMatch'
import { hawaiiToday, lastCompleteMonth, yesterday } from '../pages/content/contentUtils'
import { examplesFor } from './AssistantPanel'
import INDEX from './catalog.index.json'
import { buildIndex } from '../../scripts/catalog-index.mjs'

// R6 D (13 Oct): the typeahead's local index and matcher.
const CATALOG = path.resolve(__dirname, '../../../backend/data/catalog.json')
const NOW = new Date('2026-10-13T20:00:00Z')   // 10:00 HST on 13 Oct 2026

describe('the committed catalog index', () => {
  it('is in step with backend/data/catalog.json (run `node scripts/catalog-index.mjs` after a catalog change)', () => {
    const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'))
    expect(INDEX).toEqual(buildIndex(catalog))
    expect(INDEX.length).toBeGreaterThan(100)
  })
  it('keeps only entries that lead somewhere, each with a path or a url, short tags and at most three examples', () => {
    for (const e of INDEX) {
      expect(typeof e.id).toBe('string'); expect(typeof e.title).toBe('string'); expect(typeof e.kind).toBe('string')
      expect(Boolean(e.path) !== Boolean(e.url)).toBe(true)
      expect(e.tags.length).toBeLessThanOrEqual(8); expect(e.examples.length).toBeLessThanOrEqual(3)
      if (e.url) expect(e.url).toMatch(/^https:\/\//)
    }
    expect(INDEX.find((e) => e.id === 'ask-link')).toBeUndefined()                        // a question link is not a place
    expect(INDEX.find((e) => e.id === 'mesonet-station-live').path).toBe('/mesonet')       // a station template falls back to its page
    expect(INDEX.find((e) => e.id === 'rainfall-daily-map').path).toBe('/viewer/rainfall/day/{date}/{extent}')
    expect(INDEX.find((e) => e.id === 'solar-radiation-atlas').url).toMatch(/solar-radiation-atlas/)        // an HCDP page this site does not mirror
    expect(INDEX.find((e) => e.id === 'rainfall-mapping-history').path).toBe('/about/rainfall-mapping-history')   // a mirrored one (14 Oct)
    expect(INDEX.every((e) => !e.tags.includes('hilo') && !e.tags.includes('rainfall'))).toBe(true)   // generic tags are left out
    const bytes = Buffer.byteLength(JSON.stringify(INDEX))
    expect(bytes).toBeLessThan(60 * 1024)
  })
})

describe('localMatch', () => {
  it('needs two characters (QB-Q4 B) and never returns more than five rows', () => {
    expect(localMatch('')).toEqual([]); expect(localMatch('l')).toEqual([]); expect(localMatch('  L ')).toEqual([])
    expect(MIN_CHARS).toBe(2)
    expect(localMatch('lo', { now: NOW }).length).toBeGreaterThan(0)
    expect(localMatch('rain', { now: NOW }).length).toBeLessThanOrEqual(MAX_MATCHES)
    expect(localMatch('rain', { now: NOW }).length).toBe(5)
  })
  it('ranks a title prefix over a title word over a tag over an example, keeping the catalogue order among equals', () => {
    const idx = [
      { id: 'a', title: 'Something about rain', kind: 'page', path: '/a', tags: [], examples: [] },
      { id: 'b', title: 'Lowell winds', kind: 'page', path: '/b', tags: [], examples: ['rain totals from lowell'] },
      { id: 'c', title: 'Storm viewers', kind: 'page', path: '/c', tags: ['rainfall totals'], examples: [] },
      { id: 'd', title: 'Rainfall Atlas', kind: 'atlas', url: 'https://rainfall.geography.hawaii.edu/', tags: [], examples: [] },
      { id: 'e', title: 'Daily rainfall map', kind: 'viewer', path: '/viewer/rainfall/day/{date}/{extent}', tags: [], examples: [] },
    ]
    expect(localMatch('rain', { index: idx, now: NOW }).map((r) => r.id)).toEqual(['d', 'a', 'e', 'c', 'b'])
    expect(localMatch('rain', { index: idx, now: NOW, limit: 2 }).map((r) => r.id)).toEqual(['d', 'a'])
  })
  it('every typed word must match; the weakest word decides the rank', () => {
    const rows = localMatch('hurricane lowell', { now: NOW })
    expect(rows[0].title).toBe('Hurricane Lowell report')
    expect(rows.every((r) => /lowell/i.test(r.title))).toBe(true)
    expect(localMatch('lowell zzzz', { now: NOW })).toEqual([])
  })
  it('finds the Lowell report first for "Lowe", with its kind word', () => {
    const rows = localMatch('Lowe', { now: NOW })
    expect(rows[0]).toMatchObject({ id: 'lowell', title: 'Hurricane Lowell report', kind: 'event', kindWord: 'report', path: '/extreme-events/lowell' })
    expect(rows.map((r) => r.kindWord)).toContain('map')
  })
  it('folds diacritics and the ʻokina, so "kauai" meets "Kauaʻi"', () => {
    expect(fold('Kauaʻi Lānaʻi')).toBe('kauai lanai')
    expect(localMatch('kauai', { now: NOW }).some((r) => /Kauaʻi/.test(r.title))).toBe(true)
  })
  it('fills a viewer template with yesterday or the last complete month (Hawaiʻi time) and statewide, and names the date in the row', () => {
    expect(fillTemplate('/viewer/rainfall/day/{date}/{extent}', NOW)).toBe('/viewer/rainfall/day/2026-10-12/statewide')
    expect(fillTemplate('/viewer/spi-3/month/{date}/statewide', NOW)).toBe('/viewer/spi-3/month/2026-09/statewide')
    expect(fillTemplate('/data', NOW)).toBe('/data')
    const map = localMatch('daily rainfall map', { now: NOW })[0]
    expect(map.path).toBe('/viewer/rainfall/day/2026-10-12/statewide')
    expect(map.title).toBe('Daily rainfall map · 12 Oct 2026'); expect(map.date).toBe('2026-10-12')
    const monthly = localMatch('monthly rainfall map', { now: NOW }).find((r) => r.id === 'rainfall-monthly-map')
    expect(monthly.title).toBe('Monthly rainfall map · September 2026'); expect(monthly.path).toBe('/viewer/rainfall/month/2026-09/statewide')
    expect(localMatch('lowell rainfall map', { now: NOW })[0].title).toBe('Hurricane Lowell rainfall map (7 Sept 2026, Kauaʻi)')   // a fixed date keeps its title
    expect(datedTitle('Drought index SPI-3 map (viewer)', '/viewer/spi-3/month/{date}/statewide', NOW)).toBe('Drought index SPI-3 map · September 2026')
  })

  it('the date rule: yesterday and the last complete month in Hawaiʻi time, across month ends and New Year', () => {
    // 10:00 HST on 13 Oct 2026
    expect(hawaiiToday(NOW)).toEqual({ y: 2026, m: 10, d: 13 })
    expect(yesterday(NOW)).toBe('2026-10-12'); expect(lastCompleteMonth(NOW)).toBe('2026-09')
    // 1 Jan 2027, 00:30 HST (10:30 UTC): yesterday is 31 Dec 2026, the last complete month December 2026
    const newYear = new Date('2027-01-01T10:30:00Z')
    expect(yesterday(newYear)).toBe('2026-12-31'); expect(lastCompleteMonth(newYear)).toBe('2026-12')
    // 1 Mar 2028 in Hawaiʻi while it is already 2 Mar in UTC: a leap day yesterday, February the last month
    const march = new Date('2028-03-02T08:00:00Z')
    expect(hawaiiToday(march)).toEqual({ y: 2028, m: 3, d: 1 })
    expect(yesterday(march)).toBe('2028-02-29'); expect(lastCompleteMonth(march)).toBe('2028-02')
    expect(latestDateFor('/viewer/rainfall/day/{date}/{extent}', march)).toBe('2028-02-29')
    expect(latestDateFor('/viewer/spi-3/month/{date}/statewide', march)).toBe('2028-02')
    expect(dateLabel('2026-10-12')).toBe('12 Oct 2026'); expect(dateLabel('2026-09')).toBe('September 2026'); expect(dateLabel('')).toBe('')
    // the landing example that names a month names the last complete one at render time
    expect(examplesFor(NOW)).toContain('Show me the drought map for September 2026')
    expect(examplesFor(newYear)).toContain('Show me the drought map for December 2026')
    expect(examplesFor(NOW).some((e) => /August 2026/.test(e))).toBe(false)
  })
  it('kind words: map · page · tool · report · external', () => {
    expect(kindWord({ kind: 'viewer', path: '/viewer/x' })).toBe('map')
    expect(kindWord({ kind: 'event', path: '/extreme-events/lowell' })).toBe('report')
    expect(kindWord({ kind: 'tool', path: '/tools/h-rip' })).toBe('tool'); expect(kindWord({ kind: 'atlas', path: '/tools/rainfall-atlas' })).toBe('tool')
    expect(kindWord({ kind: 'page', path: '/data' })).toBe('page'); expect(kindWord({ kind: 'dataset', path: '/data' })).toBe('page')
    expect(kindWord({ kind: 'page', url: 'https://www.hawaii.edu/x/' })).toBe('external')
  })
  it('shortTitle drops a trailing parenthetical', () => {
    expect(shortTitle('Daily rainfall map (viewer)')).toBe('Daily rainfall map')
    expect(shortTitle('Access Data (interactive data portal)')).toBe('Access Data')
    expect(shortTitle('Hurricane Lowell report')).toBe('Hurricane Lowell report')
  })
})
