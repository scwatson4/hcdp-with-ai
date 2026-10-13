// The AI-prepared download's client side of CONTRACT.md "The AI-prepared download" (13 Oct): the two endpoints, the
// package address, the picks, the estimate and the Export-form prefill derived from a plan. Pure functions apart from
// the two fetches; the visitor's HCDP API key only ever travels in the prepare request's body.

export const PLAN_URL = '/api/download/plan'
export const PREPARE_URL = '/api/download/prepare'
export const INSTANT_MAX_FILES = 150

async function readDetail(resp) {
  try {
    const b = await resp.json()
    return typeof b?.detail === 'string' ? b.detail : (typeof b?.message === 'string' ? b.message : null)
  } catch { return null }
}

/** POST /api/download/plan → the verified plan; throws an Error whose message is for the visitor. */
export async function fetchPlan({ ask, hints = {}, context = {}, extra = '', previous = [], signal } = {}) {
  let resp
  try {
    resp = await fetch(PLAN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ask, hints, context, extra, previous }), signal })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new Error('The planner did not answer. Check your connection and try again.')
  }
  if (!resp.ok) throw new Error((await readDetail(resp)) || `The planner answered ${resp.status}. Try again in a moment.`)
  const plan = await resp.json()
  if (!plan || !Array.isArray(plan.items)) throw new Error('The planner sent nothing usable. Try again in a moment.')
  return plan
}

function filenameFrom(disposition, fallback) {
  const m = /filename="?([^";]+)"?/i.exec(disposition || '')
  return m ? m[1] : fallback
}

/**
 * POST /api/download/prepare. `body` = {ask, reading, items, api_key, email?, event, place, primary_view}. Resolves
 * {kind: 'zip', blob, filename, files} or {kind: 'email', ...the 202 body}; throws an Error in plain words.
 */
export async function preparePackage(body, { signal } = {}) {
  let resp
  try {
    resp = await fetch(PREPARE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new Error('HCDP did not answer. Check your connection and try again.')
  }
  if (!resp.ok) throw new Error((await readDetail(resp)) || `The package could not be made (${resp.status}). Try again in a moment.`)
  if (resp.status === 202) return { kind: 'email', ...(await resp.json()) }
  const blob = await resp.blob()
  return { kind: 'zip', blob, filename: filenameFrom(resp.headers.get('content-disposition'), 'hcdp_package.zip'), files: Number(resp.headers.get('x-hcdp-files')) || null, packagePath: resp.headers.get('x-package-path') || null }
}

/** Save a blob through a temporary link; false when the browser offers no object URLs (tests). */
export function saveBlob(blob, filename) {
  if (typeof URL.createObjectURL !== 'function') return false
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The shareable address of a prepared list: /download?ask=…&picks=id,id (the ids are the server's content ids). */
export function packagePath(ask, picks = []) {
  const ids = (picks || []).filter((p) => typeof p === 'string' && ID_RE.test(p))
  return `/download?ask=${encodeURIComponent(String(ask || '').trim().slice(0, 500))}${ids.length ? `&picks=${ids.join(',')}` : ''}`
}

/** The picks named in an address's search string, or null when there are none. */
export function parsePicks(search) {
  const raw = new URLSearchParams(search || '').get('picks')
  if (!raw) return null
  const ids = raw.split(',').map((s) => s.trim()).filter((s) => ID_RE.test(s))
  return ids.length ? ids : null
}

/** Which items start ticked: the address's picks when any of them name an item of this plan, else the AI's own ticks. */
export function pickedIds(plan, picks = null) {
  const ids = new Set((plan?.items || []).map((i) => i.id))
  const fromAddress = (picks || []).filter((p) => ids.has(p))
  if (fromAddress.length) return new Set(fromAddress)
  return new Set((plan?.items || []).filter((i) => i.ticked).map((i) => i.id))
}

/** Files and bytes over the picked items (each item carries the server's verified count and size estimate). */
export function estimateFor(items, picked) {
  const chosen = (items || []).filter((i) => picked.has(i.id))
  const files = chosen.reduce((n, i) => n + (Number(i.count) || 0), 0)
  return { files, bytes: chosen.reduce((n, i) => n + (Number(i.bytes) || 0), 0), overInstant: files > INSTANT_MAX_FILES }
}

/** '420 KB', '12 MB', '1.3 GB'. */
export function formatBytes(n) {
  const b = Number(n) || 0
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${Math.round(b / 1024)} KB`
  if (b < 1073741824) return `${(b / 1048576).toLocaleString('en-US', { maximumFractionDigits: b < 10485760 ? 1 : 0 })} MB`
  return `${(b / 1073741824).toLocaleString('en-US', { maximumFractionDigits: 1 })} GB`
}

/**
 * What the Export form should tick for a plan (D1 D): the first picked grid item gives dataset, period, dates, extents and
 * files; a picked station item of the same product and period adds its fills; a station-only plan ticks the station files
 * alone. Null when the plan has no data items.
 */
export function prefillFromPlan(plan, picked = null) {
  const items = (plan?.items || []).filter((i) => i.group === 'grid' || i.group === 'station')
  const chosen = picked ? items.filter((i) => picked.has(i.id)) : items.filter((i) => i.ticked)
  const pool = chosen.length ? chosen : items
  const grid = pool.find((i) => i.group === 'grid')
  const station = pool.find((i) => i.group === 'station' && (!grid || (i.product === grid.product && i.period === grid.period)))
  const lead = grid || station
  if (!lead) return null
  return {
    dataset: lead.product,
    period: lead.period,
    start: lead.start,
    end: lead.end,
    extents: grid ? [...(grid.extents || [])] : [],
    files: grid ? [...(grid.files || [])] : [],
    stationFiles: station ? [...(station.station_fills || [])] : [],
  }
}

/** The prepare body for a plan and the picked items. */
export function prepareBody(plan, picked, apiKey, email = '') {
  const body = {
    ask: plan.ask,
    reading: plan.reading || '',
    items: (plan.items || []).filter((i) => picked.has(i.id)),
    api_key: apiKey,
    event: plan.event || null,
    place: plan.place || null,
    primary_view: plan.primary_view || null,
  }
  if (email && email.trim()) body.email = email.trim()
  return body
}
