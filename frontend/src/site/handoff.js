// The one builder of links into the HCDP AI interface (the data-analysis tool).
// The contract, shared with the AI interface:
//   ${AI_INTERFACE}/?ask=<question>&ctx=viewer:<canonical viewer path>&from=website
// `ask`  — the question text, URL-encoded, at most 500 characters; omitted when empty.
// `ctx`  — present only when the visitor was on a viewer page: `viewer:` plus the
//          canonical website viewer path (no origin, no query), e.g.
//          ctx=viewer:/viewer/rainfall/day/2026-09-07/kauai
// `from` — always `website`.
// backend/navigator.py (`Navigator.handoff_url`) emits the same shape; keep the two in step.
export const AI_INTERFACE = (import.meta.env.VITE_AI_INTERFACE_URL || 'https://hcdp-ai-interface.cis251375.projects.jetstream-cloud.org').replace(/\/+$/, '')

export const ASK_MAX = 500

/** The hostname of the AI interface (for "did the visitor come from there?"). */
export function aiInterfaceHost() {
  try { return new URL(AI_INTERFACE).host } catch { return '' }
}

/**
 * Build a hand-off link. `question` is optional; `viewerPath` is a website viewer
 * address (path, or path + query — the query is dropped: the context is the view's
 * identity, not its colours).
 */
export function handoffUrl({ question = '', viewerPath = null } = {}) {
  const parts = []
  const ask = String(question || '').trim().slice(0, ASK_MAX)
  if (ask) parts.push(`ask=${encodeURIComponent(ask)}`)
  const path = typeof viewerPath === 'string' ? viewerPath.split('?')[0].split('#')[0] : ''
  if (path.startsWith('/viewer/')) parts.push(`ctx=${encodeURIComponent(`viewer:${path}`)}`)
  parts.push('from=website')
  return `${AI_INTERFACE}/?${parts.join('&')}`
}
