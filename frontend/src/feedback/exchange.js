// What the AI said, for the feedback that is about it (F2 A: "the last question and answer attached automatically").
// An answer's thumbs and an overview's thumbs register their exchange on their own element, so a passage selected inside
// them carries the right exchange too (a WeakMap: nothing is written into the page).
import { LIMITS, clip } from './features'

const byElement = new WeakMap()

export function registerExchange(el, exchange) {
  if (el && exchange) byElement.set(el, exchange)
}

/** The exchange registered on `node` or its nearest ancestor that has one. */
export function exchangeForNode(node) {
  let el = node?.nodeType === 1 ? node : node?.parentElement
  while (el) {
    if (byElement.has(el)) return byElement.get(el)
    el = el.parentElement
  }
  return null
}

// (an analysis reply's content is already the fixed hand-off sentence, as the backend writes it)
const replyText = (m) => String(m?.content || '')

/** One answer: its text, the question that led to it, its alternatives (and did-you-mean options) for the 👎 chooser. */
export function answerExchange(message, ask = '') {
  if (!message || message.role !== 'assistant') return null
  const pages = [...(Array.isArray(message.options) ? message.options : []), ...(Array.isArray(message.alternatives) ? message.alternatives : [])]
    .filter((a) => a && typeof a.url === 'string' && a.url && a.title)
  const seen = new Set()
  return {
    source: 'answer', ask: String(ask || ''), reply: replyText(message), overview: '', overview_id: null,
    alternatives: pages.filter((a) => (seen.has(a.url) ? false : seen.add(a.url))).slice(0, 5),
  }
}

/** The newest answer in the conversation and the question before it (the welcome line does not count). */
export function lastExchange(messages = []) {
  for (let i = messages.length - 1; i > 0; i -= 1) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    let ask = ''
    for (let k = i - 1; k >= 0; k -= 1) if (messages[k].role === 'user') { ask = messages[k].content; break }
    return answerExchange(m, ask)
  }
  return null
}

/** The AI overview on screen: the ask, the navigator's reply, the overview's sentences and its request id. */
export function overviewExchange(summary) {
  if (!summary || summary.status !== 'ready') return null
  return {
    source: 'overview', ask: String(summary.ask || ''), reply: String(summary.reply || ''),
    overview: [...(summary.chunks || []), ...(summary.more || [])].join(' ').trim(), overview_id: summary.requestId || null,
    alternatives: (summary.alternatives || []).filter((a) => a && typeof a.url === 'string' && a.url && a.title).slice(0, 5),
  }
}

/** The exchange as the API's ask / reply / overview_id (an overview's sentences ride in the reply after the navigator's). */
export function exchangeFields(ex) {
  if (!ex) return { ask: null, reply: null, overview_id: null }
  const reply = ex.overview ? `${ex.reply ? `${ex.reply}\n\n` : ''}AI Overview: ${ex.overview}` : ex.reply
  return { ask: clip(ex.ask, LIMITS.ask) || null, reply: clip(reply, LIMITS.reply, { keepLines: true }) || null, overview_id: ex.overview_id || null }
}
