import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fold, fillTemplate, kindWord, localMatch, shortTitle, MAX_MATCHES, MIN_CHARS } from './localMatch'
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
    expect(INDEX.find((e) => e.id === 'rainfall-mapping-history').url).toMatch(/rainfall-mapping-history/)
    expect(INDEX.every((e) => !e.tags.includes('hilo') && !e.tags.includes('rainfall'))).toBe(true)   // generic tags are left out
    const bytes = Buffer.byteLength(JSON.stringify(INDEX))
    expect(bytes).toBeLessThan(60 * 1024)
  })
})

describe('localMatch', () => {
  it('needs three characters and never returns more than five rows', () => {
    expect(localMatch('')).toEqual([]); expect(localMatch('lo')).toEqual([]); expect(localMatch('  Lo ')).toEqual([])
    expect(MIN_CHARS).toBe(3)
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
  it('fills a viewer template with yesterday or the last complete month (Hawaiʻi time) and statewide', () => {
    expect(fillTemplate('/viewer/rainfall/day/{date}/{extent}', NOW)).toBe('/viewer/rainfall/day/2026-10-12/statewide')
    expect(fillTemplate('/viewer/spi-3/month/{date}/statewide', NOW)).toBe('/viewer/spi-3/month/2026-09/statewide')
    expect(fillTemplate('/data', NOW)).toBe('/data')
    const map = localMatch('daily rainfall map', { now: NOW })[0]
    expect(map.path).toBe('/viewer/rainfall/day/2026-10-12/statewide')
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
