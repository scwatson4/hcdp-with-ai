#!/usr/bin/env node
// R6 D (13 Oct): the typeahead's local index. Reads ../backend/data/catalog.json and writes
// src/assistant/catalog.index.json — one small record per catalog entry that leads somewhere:
//   { id, title, kind, path | url, tags, examples }
// `path` is this site's address (a viewer template keeps its {date}/{extent} placeholders; the client
// fills them with yesterday / the last complete month and statewide); `url` is the HCDP page for an
// entry this site does not replicate (opened in a new tab). Tags shared by GENERIC_MIN or more entries
// (place names, "rainfall", "map" …) say nothing about one entry and are left out, the rest are capped
// (TAGS_MAX), and the first EXAMPLES_MAX example asks are kept: about 42 KB raw, 10 KB gzipped. The file is committed;
// `npm run build` and `npm run dev` rebuild it first (prebuild / predev), and a test asserts it is in
// step with the catalog. Without the catalog in reach (the Docker web stage copies frontend/ alone) the
// committed file is kept.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const TAGS_MAX = 8
export const EXAMPLES_MAX = 3
export const GENERIC_MIN = 12   // the navigator's GENERIC_TAG_MIN_ENTRIES
// Templates the client can fill on its own; others (a station id, a year/month, a question) fall back to
// the page the template lives on, or are left out when that is the home page.
const FILLABLE = /^\{(date|extent)\}$/

export function indexEntry(e, generic = new Set()) {
  const out = { id: e.id, title: e.title, kind: e.kind }
  const ip = typeof e.internal_path === 'string' ? e.internal_path : ''
  if (ip && !ip.includes('{')) out.path = ip
  else if (ip) {
    const placeholders = ip.match(/\{[^}]*\}/g) || []
    if (placeholders.every((p) => FILLABLE.test(p))) out.path = ip
    else {
      const base = ip.split('#')[0].split('?')[0]
      if (base && base !== '/') out.path = base
    }
  }
  if (!out.path && typeof e.url === 'string' && /^https?:\/\//.test(e.url)) out.url = e.url
  if (!out.path && !out.url) return null
  out.tags = (Array.isArray(e.tags) ? e.tags : []).filter((t) => typeof t === 'string' && t.trim() && !generic.has(t)).slice(0, TAGS_MAX)
  out.examples = (Array.isArray(e.example_queries) ? e.example_queries : []).filter((q) => typeof q === 'string' && q.trim()).slice(0, EXAMPLES_MAX)
  return out
}

export function buildIndex(catalog) {
  const entries = Array.isArray(catalog) ? catalog : (catalog && Array.isArray(catalog.entries) ? catalog.entries : [])
  const df = new Map()
  for (const e of entries) for (const t of new Set(Array.isArray(e.tags) ? e.tags : [])) df.set(t, (df.get(t) || 0) + 1)
  const generic = new Set([...df].filter(([, n]) => n >= GENERIC_MIN).map(([t]) => t))
  return entries.map((e) => indexEntry(e, generic)).filter(Boolean)
}

const here = path.dirname(fileURLToPath(import.meta.url))
export const CATALOG_PATH = path.resolve(here, '../../backend/data/catalog.json')
export const INDEX_PATH = path.resolve(here, '../src/assistant/catalog.index.json')

export function main() {
  if (!fs.existsSync(CATALOG_PATH)) {
    console.log(`catalog-index: ${CATALOG_PATH} not found; keeping the committed ${path.relative(process.cwd(), INDEX_PATH)}`)
    return
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'))
  const index = buildIndex(catalog)
  const text = JSON.stringify(index) + '\n'
  const before = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, 'utf8') : null
  if (before !== text) fs.writeFileSync(INDEX_PATH, text)
  console.log(`catalog-index: ${index.length} entries, ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB${before === text ? ' (unchanged)' : ''}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
