// Small helpers shared by the content pages.
//
// Dates for deep links are computed in Hawaiʻi time: HCDP daily maps are HST
// days, so "yesterday" for a visitor in New York at 1 a.m. is still the HST
// day before, not a day whose map does not exist yet.

import { NAV, TOOL_CARDS } from '../../site/nav'

const HST = 'Pacific/Honolulu'
const pad = (n) => String(n).padStart(2, '0')

/** Today's calendar date in Hawaiʻi as { y, m, d } (m is 1-12). */
export function hawaiiToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: HST, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now)
  const get = (type) => Number(parts.find((p) => p.type === type)?.value)
  return { y: get('year'), m: get('month'), d: get('day') }
}

/** The last complete month (the month before the current one), as YYYY-MM. */
export function lastCompleteMonth(now = new Date()) {
  const { y, m } = hawaiiToday(now)
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`
}

/** YYYY-MM-DD for `n` days before today in Hawaiʻi. */
export function daysAgo(n, now = new Date()) {
  const { y, m, d } = hawaiiToday(now)
  return isoDay(new Date(Date.UTC(y, m - 1, d - n)))
}

/** Yesterday in Hawaiʻi (today − 1), as YYYY-MM-DD. */
export const yesterday = (now = new Date()) => daysAgo(1, now)

/** YYYY-MM-DD of a Date's UTC calendar day. */
export function isoDay(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** Every day from `start` to `end` inclusive (YYYY-MM-DD strings), at most `max` days. */
export function dayRange(start, end, max = 31) {
  const out = []
  const [y, m, d] = start.split('-').map(Number)
  for (let i = 0; i < max; i += 1) {
    const day = isoDay(new Date(Date.UTC(y, m - 1, d + i)))
    if (day > end) break
    out.push(day)
  }
  return out
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "24 September 2026" for YYYY-MM-DD, "August 2026" for YYYY-MM. */
export function formatDate(iso, { short = false } = {}) {
  const [y, m, d] = String(iso).split('-').map(Number)
  const month = short ? MONTHS[m - 1].slice(0, 3) : MONTHS[m - 1]
  if (!d) return `${month} ${y}`
  return short ? `${d} ${month}` : `${d} ${month} ${y}`
}

// ----- "Related" link lists, taken from the site's own navigation -----------

const toItem = (it) => (it.external ? { label: it.label, href: it.external } : { label: it.label, to: it.to })
const without = (items, current) => items.filter((it) => it.to !== current).map(toItem)

/** Sibling pages in the About menu. */
export function aboutRelated(current) {
  return without(NAV.find((n) => n.label === 'About')?.items || [], current)
}

/** Sibling pages in the Data Portal menu. */
export function dataRelated(current) {
  const items = without(NAV.find((n) => n.label === 'Data Portal')?.items || [], current)
  const seen = new Set()
  return items.filter((it) => (seen.has(it.label) ? false : seen.add(it.label)))
}

/** The portal's six sections (the landing page's tool cards). */
export function sectionRelated(current) {
  return TOOL_CARDS.filter((c) => c.to !== current).map((c) => ({ label: c.title, to: c.to }))
}
