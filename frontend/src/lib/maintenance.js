// The nightly maintenance notice (4 Nov 2026): the HCDP team restarts the AI tools only between
// 11:30 pm and 5:00 am Hawaiʻi time. From 11:00 pm to 5:00 am the shell shows one quiet line above the
// header — the same sentence before and during the window (one line, 5 Nov 2026) — and nothing the
// rest of the day. Hawaiʻi keeps standard time all year (UTC−10), so the clock needs no zone tables.

const HST_OFFSET_MS = -10 * 3600 * 1000
export const WARN_FROM_MIN = 23 * 60          // 11:00 pm
export const START_MIN = 23 * 60 + 30         // 11:30 pm
export const END_MIN = 5 * 60                 // 5:00 am

export const NOTICE_TEXT = 'Services may be interrupted during scheduled maintenance from 11:30pm to 5am HST'

function hst(now) {
  return new Date(now + HST_OFFSET_MS)       // read with the UTC getters: Hawaiʻi wall-clock
}

/** The HST date the night belongs to ("2026-11-04" for 11 pm on the 4th AND 3 am on the 5th), so one
 *  dismissal covers the whole night. */
export function nightKey(now = Date.now()) {
  const d = hst(now)
  if (d.getUTCHours() < END_MIN / 60) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** null outside 11:00 pm–5:00 am HST; otherwise { phase: 'before' | 'during', text, night }. */
export function maintenanceNotice(now = Date.now()) {
  const d = hst(now)
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()
  if (minutes >= START_MIN || minutes < END_MIN) return { phase: 'during', text: NOTICE_TEXT, night: nightKey(now) }
  if (minutes >= WARN_FROM_MIN) return { phase: 'before', text: NOTICE_TEXT, night: nightKey(now) }
  return null
}
