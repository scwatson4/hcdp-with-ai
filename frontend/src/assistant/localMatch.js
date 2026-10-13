// R6 D (13 Oct): the typeahead's matcher. While the visitor types, the catalogue's titles are matched locally
// — no AI call — from the index scripts/catalog-index.mjs builds at build time (catalog.index.json, committed).
// Ranking: a title that starts with the typed text, then a title word that does, then a tag, then an example
// ask; every typed word must match somewhere. At most MAX_MATCHES rows. Diacritics and the ʻokina are folded
// ("kauai" finds "Kauaʻi"). A viewer template's {date} and {extent} are filled with yesterday (daily) or the
// last complete month (monthly) in Hawaiʻi time, and statewide.
import INDEX from './catalog.index.json'
import { hawaiiToday, lastCompleteMonth, yesterday } from '../pages/content/contentUtils'

export const MIN_CHARS = 3
export const MAX_MATCHES = 5
export const DEBOUNCE_MS = 80

/** Lower-case ASCII-ish text: diacritics and the ʻokina gone, so typed and catalogued spellings meet. */
export const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ʻ'’`]/g, '')

/** The grey word beside a row: what kind of thing opens. An entry this site does not replicate is "external". */
export function kindWord(entry) {
  if (!entry || !entry.path) return 'external'
  switch (entry.kind) {
    case 'viewer': return 'map'
    case 'event': return 'report'
    case 'tool': case 'atlas': return 'tool'
    default: return 'page'
  }
}

/** A title without its trailing parenthetical, for "Opening …" (the backend's short_title does the same). */
export function shortTitle(title) {
  const t = String(title || '').replace(/\s*\([^()]*\)\s*$/, '').trim()
  return t || String(title || '').trim()
}

/** A viewer template with its {date} and {extent} filled: yesterday or the last complete month, statewide. */
export function fillTemplate(path, now = new Date()) {
  if (!path || !path.includes('{')) return path
  const monthly = /\/month\//.test(path)
  return path.replace('{date}', monthly ? lastCompleteMonth(now) : yesterday(now)).replace('{extent}', 'statewide')
}

const words = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean)

function termScore(term, title, titleWords, tags, examples) {
  if (title.startsWith(term)) return 4
  if (titleWords.some((w) => w.startsWith(term))) return 3
  if (tags.some((t) => t === term || t.startsWith(term) || t.split(/[^a-z0-9]+/).some((w) => w.startsWith(term)))) return 2
  if (examples.some((x) => x.includes(term))) return 1
  return 0
}

/** The best catalogue matches for what has been typed: [{ id, title, kind, kindWord, path | url }], ranked, at most
 *  `limit`; [] under MIN_CHARS. The score of an entry is the weakest of its typed words' matches (title prefix 4 ·
 *  title word 3 · tag 2 · example 1); ties keep the catalogue's order. */
export function localMatch(query, { index = INDEX, limit = MAX_MATCHES, now = new Date() } = {}) {
  const q = fold(query).trim()
  if (q.length < MIN_CHARS) return []
  const terms = q.split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const scored = []
  index.forEach((e, i) => {
    const title = fold(e.title)
    const titleWords = words(e.title)
    const tags = (e.tags || []).map(fold)
    const examples = (e.examples || []).map(fold)
    let score = Infinity
    for (const term of terms) {
      const s = termScore(term, title, titleWords, tags, examples)
      if (!s) { score = 0; break }
      score = Math.min(score, s)
    }
    if (score > 0) scored.push({ score, i, e })
  })
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  return scored.slice(0, limit).map(({ e }) => {
    const row = { id: e.id, title: e.title, kind: e.kind, kindWord: kindWord(e) }
    if (e.path) row.path = fillTemplate(e.path, now)
    else row.url = e.url
    return row
  })
}

export { hawaiiToday }
