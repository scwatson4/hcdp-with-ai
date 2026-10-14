// F4 A (13 Oct): the reviewer's name, remembered in this browser for the review period — the one review-period exception
// to "nothing persisted" (localStorage key `hcdp-reviewer-name`; read and written in try/catch, so a private window
// still sends feedback, just without remembering the name). It labels the reviewer's own feedback; it is not an identity.
import { LIMITS } from './features'

export const NAME_KEY = 'hcdp-reviewer-name'

export function readReviewerName() {
  try { return (window.localStorage.getItem(NAME_KEY) || '').slice(0, LIMITS.name) } catch { return '' }
}

export function writeReviewerName(name) {
  const v = String(name ?? '').trim().slice(0, LIMITS.name)
  try { if (v) window.localStorage.setItem(NAME_KEY, v); else window.localStorage.removeItem(NAME_KEY) } catch { /* no storage */ }
  return v
}
