// The reviewer side of the feedback API (backend/app.py, CONTRACT.md "Feedback"). The admin side lives with the admin page.

async function body(r) { try { return await r.json() } catch { return null } }

function failure(r, d, fallback) {
  const e = new Error(typeof d?.detail === 'string' ? d.detail : fallback)
  e.status = r.status
  return e
}

/** POST /api/feedback → { id }. Throws with the server's words on a refusal (429 says to wait a minute). */
export async function postFeedback(item) {
  const r = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) })
  const d = await body(r)
  if (!r.ok || !d || typeof d.id !== 'string') throw failure(r, d, 'Your feedback could not be sent. Try again in a moment.')
  return d
}

/** GET /api/feedback/mine?name= → the reviewer's own items, newest first. */
export async function fetchMine(name) {
  if (!String(name || '').trim()) return []
  const r = await fetch(`/api/feedback/mine?name=${encodeURIComponent(name.trim())}`, { cache: 'no-store' })
  const d = await body(r)
  if (!r.ok) throw failure(r, d, 'Your feedback could not be loaded.')
  return Array.isArray(d?.rows) ? d.rows : []
}

/** GET /api/feedback/others?name= → everyone else's items as titles + status (never a name). */
export async function fetchOthers(name) {
  const q = String(name || '').trim() ? `?name=${encodeURIComponent(name.trim())}` : ''
  const r = await fetch(`/api/feedback/others${q}`, { cache: 'no-store' })
  const d = await body(r)
  if (!r.ok) throw failure(r, d, 'The others’ feedback could not be loaded.')
  return Array.isArray(d?.rows) ? d.rows : []
}

/** POST /api/feedback/rename {from, to} → how many items now carry the new name. */
export async function renameReviewer(from, to) {
  const r = await fetch('/api/feedback/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to }) })
  const d = await body(r)
  if (!r.ok) throw failure(r, d, 'The name could not be changed.')
  return Number(d?.changed) || 0
}
