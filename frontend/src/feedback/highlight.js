// Marking a passage on the page without touching the page's DOM: the CSS Custom Highlight API paints a Range
// (`::highlight(hcdp-feedback)`, styled by FeedbackLayer). Used while the composer holds a quote (the native selection
// dies the moment the text field takes focus) and when "My feedback" takes the reviewer back to the spot. Browsers
// without the API simply show no mark.
export const HIGHLIGHT_NAME = 'hcdp-feedback'

const supported = () => typeof window !== 'undefined' && typeof window.Highlight === 'function' && !!window.CSS?.highlights

export function showRange(range) {
  if (!range || !supported()) return () => {}
  try {
    window.CSS.highlights.set(HIGHLIGHT_NAME, new window.Highlight(range))
  } catch { return () => {} }
  return () => { try { window.CSS.highlights.delete(HIGHLIGHT_NAME) } catch { /* gone */ } }
}

export function clearHighlight() {
  if (!supported()) return
  try { window.CSS.highlights.delete(HIGHLIGHT_NAME) } catch { /* gone */ }
}

const SKIP = 'script, style, textarea, input, select, [data-feedback-ui]'

/** A Range over the first occurrence of `quote` under `root`, whitespace-insensitive, across inline elements. */
export function rangeForQuote(root, quote) {
  const want = String(quote || '').replace(/\s+/g, ' ').trim().replace(/…$/, '')
  if (!root || !want || typeof document === 'undefined') return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const map = []   // for each character of the normalised text: [node, offset]
  let text = ''
  let node
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest(SKIP)) continue
    const s = node.textContent
    for (let i = 0; i < s.length; i += 1) {
      const ch = /\s/.test(s[i]) ? ' ' : s[i]
      if (ch === ' ' && (text.endsWith(' ') || text === '')) continue
      text += ch
      map.push([node, i])
    }
  }
  const at = text.indexOf(want)
  if (at < 0) return null
  const [sn, so] = map[at]
  const [en, eo] = map[at + want.length - 1]
  const range = document.createRange()
  range.setStart(sn, so)
  range.setEnd(en, eo + 1)
  return range
}

/** Find `quote` on the page (retrying while a page that just opened renders), scroll to it and mark it for `ms`. */
export function flashQuote(quote, { root = () => document.querySelector('#main') || document.body, tries = 12, every = 200, ms = 2600 } = {}) {
  let n = 0
  let timer = null
  let stop = () => {}
  const attempt = () => {
    const range = rangeForQuote(typeof root === 'function' ? root() : root, quote)
    if (range) {
      const el = range.startContainer.parentElement
      try { el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }) } catch { el?.scrollIntoView?.() }
      stop = showRange(range)
      timer = setTimeout(stop, ms)
      return
    }
    n += 1
    if (n < tries) timer = setTimeout(attempt, every)
  }
  attempt()
  return () => { clearTimeout(timer); stop() }
}
