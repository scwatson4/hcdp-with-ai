// R6 D (13 Oct): the typeahead's matcher. While the visitor types, the catalogue's titles are matched locally
// — no AI call — from the index scripts/catalog-index.mjs builds at build time (catalog.index.json, committed).
// Ranking: a title that starts with the typed text, then a title word that does, then a tag, then an example
// ask; every typed word must match somewhere. At most MAX_MATCHES rows. Diacritics and the ʻokina are folded
// ("kauai" finds "Kauaʻi"). QB-Q4 B / the date rule (13 Oct): suggestions start from the SECOND character; a
// viewer template's {date} and {extent} are filled at match time with the latest available date — yesterday for a
// daily product, the last complete month for a monthly one, in Hawaiʻi time — and statewide, and the row's title
// names that date ("Daily rainfall map · 12 Oct 2026", "Drought index SPI-3 map · September 2026"), never a
// hard-coded one.
import INDEX from './catalog.index.json'
import { formatDate, hawaiiToday, lastCompleteMonth, yesterday } from '../pages/content/contentUtils'

export const MIN_CHARS = 2
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

/** The latest available date for a viewer template: yesterday (daily) or the last complete month (monthly), Hawaiʻi time. */
export const latestDateFor = (path, now = new Date()) => (/\/month\//.test(path || '') ? lastCompleteMonth(now) : yesterday(now))

/** "12 Oct 2026" for a day, "September 2026" for a month. */
export function dateLabel(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number)
  if (!y || !m) return String(iso || '')
  return d ? `${d} ${formatDate(iso, { short: true }).split(' ')[1]} ${y}` : formatDate(iso)
}

/** A viewer template with its {date} and {extent} filled: yesterday or the last complete month, statewide. */
export function fillTemplate(path, now = new Date()) {
  if (!path || !path.includes('{')) return path
  return path.replace('{date}', latestDateFor(path, now)).replace('{extent}', 'statewide')
}

/** A dated row title for a viewer template: "Daily rainfall map · 12 Oct 2026". */
export const datedTitle = (title, path, now = new Date()) => `${shortTitle(title)} · ${dateLabel(latestDateFor(path, now))}`

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
    if (e.path) {
      row.path = fillTemplate(e.path, now)
      if (e.path.includes('{date}')) { row.title = datedTitle(e.title, e.path, now); row.date = latestDateFor(e.path, now) }
    } else row.url = e.url
    return row
  })
}

export { hawaiiToday }
