// The review-period feedback (F1–F5, 13 Oct): the vocabulary the composer, the panel and the admin page share. The ids
// are what backend/feedback.py stores (FEATURES, KINDS, STATUSES); the labels are what reviewers and the team read.

// F1 A: the composer's feature picker.
export const FEATURES = [
  { id: 'answer', label: 'AI answer' },
  { id: 'navigation', label: 'Navigation result' },
  { id: 'overview', label: 'AI Overview' },
  { id: 'viewer', label: 'Visualize Data' },   // the map viewer (18 Oct: its name for visitors)
  { id: 'downloads', label: 'Downloads' },
  { id: 'feedback', label: 'Feedback itself' },
  { id: 'page', label: 'A page' },
  { id: 'other', label: 'Other' },
]
export const FEATURE_LABEL = Object.fromEntries(FEATURES.map((f) => [f.id, f.label]))
// The features that are about something the AI said: the last question and answer ride along with them (F2 A).
export const EXCHANGE_FEATURES = new Set(['answer', 'navigation', 'overview'])

export const KINDS = [
  { id: 'thumbs', label: 'Thumbs' },
  { id: 'selection', label: 'Selected text' },
  { id: 'tab', label: 'Feedback tab' },
  { id: 'wrong_page', label: 'Wrong page?' },
]
export const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label]))

export const STATUSES = [
  { id: 'new', label: 'New' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'fixed', label: 'Fixed' },
  { id: 'wontfix', label: 'Won’t fix' },
]
export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]))

// The server's field limits (backend/app.py FeedbackBody): the client clips to them instead of meeting a 422.
export const LIMITS = { quote: 500, ask: 500, reply: 2000, text: 2000, name: 60, title: 200, path: 1000, wanted: 500 }

/** A string cut to `n` characters on a word where it can be, with an ellipsis (`keepLines` keeps paragraph breaks). */
export function clip(s, n, { keepLines = false } = {}) {
  const raw = String(s ?? '')
  const t = (keepLines ? raw.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n') : raw.replace(/\s+/g, ' ')).trim()
  if (t.length <= n) return t
  const cut = t.slice(0, n - 1)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`
}

/** The feature a page is most likely about, for the tab's first guess. */
export function featureForPath(pathname = '') {
  if (pathname.startsWith('/viewer/')) return 'viewer'
  if (pathname === '/download' || pathname.startsWith('/download/')) return 'downloads'
  if (pathname.startsWith('/admin/feedback')) return 'feedback'
  return 'page'
}

/** The feature a selected passage is about: the AI overview, an AI answer, the feedback UI, else the page's. */
export function featureForNode(node, pathname = '') {
  const el = node?.nodeType === 1 ? node : node?.parentElement
  if (el?.closest?.('[data-testid="ai-summary"]')) return 'overview'
  if (el?.closest?.('[data-testid="conversation"], [data-testid="reply-strip"], [data-testid="chat-history"]')) return 'answer'   // chat-history: the viewer's Ask AI popup (18 Oct)
  if (el?.closest?.('[data-feedback-ui]')) return 'feedback'
  return featureForPath(pathname)
}

/** "2 h ago", "yesterday", "12 Oct" — for the panel's lists. */
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso || '')
  if (Number.isNaN(t)) return ''
  const mins = Math.round((now - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  if (h < 48) return 'yesterday'
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Pacific/Honolulu' })
}
