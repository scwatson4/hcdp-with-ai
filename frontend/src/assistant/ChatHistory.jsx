import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ExternalLink, Link2 } from 'lucide-react'
import { PAGE_LOAD, useAssistant } from './AssistantProvider'
import { HandoffReply } from './AssistantPanel'
import { SummaryBlock } from './AISummary'
import TileChoice from './TileChoice'
import { AnswerFeedback } from '../feedback/Thumbs'
import { cn } from '../lib/utils'

// 18 Oct (the user: "In the Visualize Data tool the AI overview should not appear automatically … I'd rather it appear
// inside the 'Ask AI' popup. Also that popup should keep conversation history."): on the viewer's pages the Ask AI popup —
// the phone's sheet, the docked bar's dropdown, the full-screen map's mini box — shows the conversation kept for the visit
// (the provider's `log`, in sessionStorage): every question and its reply, oldest first, the newest at the bottom; a reply
// that opened a page carries that page's AI overview (its sources and sentences; the newest open, the earlier ones closed
// to "AI Overview ›", each with the chevron), the question being answered shows the staged wait line under it, and the
// address's follow-up asks sit as chips under the newest reply (a tap asks it). Nothing here is sent anywhere.
export const CHAT_SCROLL = 'data-chat-scroll'   // the attribute on the box that scrolls the history (the sheet's body, the dropdown's list)

/** An exchange as the message the reply components know (a kept one from an earlier load never matches this load's ids). */
export const messageOf = (x) => ({
  id: x.load === PAGE_LOAD && x.mid != null ? x.mid : `kept-${x.key}`, role: 'assistant', content: x.reply || '', intent: x.intent,
  actions: Array.isArray(x.actions) ? x.actions : [], alternatives: Array.isArray(x.alternatives) ? x.alternatives : [], options: Array.isArray(x.options) ? x.options : undefined,
})

/** An exchange's overview in SummaryBlock's shape. */
const overviewOf = (x) => ({
  id: `chat:${x.key}`, path: x.path || '', page: false, status: x.overview.status === 'ready' ? 'ready' : 'pending', ask: x.ask || '', reply: x.reply || '',
  requestId: x.overview.requestId || null, chunks: x.overview.chunks || [], cites: x.overview.cites || [], more: x.overview.more || [], moreCites: x.overview.moreCites || [],
  sources: x.overview.sources || [], followups: [], alternatives: [],
})

function CopyAskLink({ q }) {
  const copy = (ev) => {
    const href = `${window.location.origin}/?ask=${encodeURIComponent(q)}`
    const b = ev.currentTarget
    navigator.clipboard?.writeText(href).then(() => { b.dataset.copied = '1'; setTimeout(() => { delete b.dataset.copied }, 1500) }).catch(() => window.prompt('Copy this link', href))
  }
  return (
    <button type="button" title="Copy a link that asks this" aria-label="Copy a link that asks this" onClick={copy}
      className="group ml-1 inline-grid h-6 w-6 place-items-center rounded align-middle text-accent-foreground/70 hover:bg-white/10 hover:text-accent-foreground data-[copied]:text-accent-foreground">
      <Link2 className="h-3.5 w-3.5 group-data-[copied]:hidden" aria-hidden="true" /><span className="hidden text-[12px] group-data-[copied]:inline">Copied</span>
    </button>
  )
}

function Exchange({ x, open, onToggle }) {
  const { send, choose } = useAssistant()
  const m = messageOf(x)
  const tiles = x.intent === 'clarify' && Array.isArray(x.options) && x.options.length >= 2
  const opens = m.actions.filter((a) => a.type === 'open' && a.url)
  return (
    <li className="space-y-2" data-testid="chat-exchange" data-pending={x.pending ? 'true' : undefined}>
      {x.ask && (
        <div className="flex justify-end" data-testid="user-bubble">
          <div className="max-w-[88%] rounded-lg bg-accent px-3 py-2 text-sm leading-relaxed text-accent-foreground">{x.ask}<CopyAskLink q={x.ask} /></div>
        </div>
      )}
      {!x.pending && (
        <div className="flex justify-start" data-testid="assistant-bubble">
          <div className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-relaxed">
            {x.intent === 'analysis' ? <HandoffReply m={m} /> : <p data-testid="chat-reply">{x.reply}</p>}
            {opens.map((a, j) => (
              <div key={j} className="mt-2"><a className="inline-flex items-center gap-1 rounded-md border border-border bg-canvas px-2.5 py-1 text-xs font-medium hover:border-foreground [@media(pointer:coarse)]:min-h-11" href={a.url} target="_blank" rel="noopener noreferrer">{a.blocked ? 'Your browser blocked the new tab — open it here' : 'Opened in a new tab — open again'} <ExternalLink className="h-3 w-3" aria-hidden="true" /></a></div>
            ))}
            {tiles && <TileChoice options={x.options} onChoose={(o) => choose(o, { ask: x.ask || '', echoAsk: false, docked: true })} />}
            {!tiles && m.alternatives.length > 0 && (
              <div className="mt-1.5 text-xs text-subtle" data-testid="chat-also">Also: {m.alternatives.slice(0, 3).map((a, j) => (
                <span key={j}>{j > 0 && ' · '}{a.url?.startsWith('/') ? <Link to={a.url} className="underline underline-offset-2 hover:text-foreground">{a.title}</Link> : <a href={a.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">{a.title}</a>}</span>
              ))}</div>
            )}
            {x.overview && <SummaryBlock variant="chat" className="mt-2.5" summary={overviewOf(x)} open={open} onToggle={onToggle} send={send} />}
            <AnswerFeedback message={m} ask={x.ask || ''} />
          </div>
        </div>
      )}
    </li>
  )
}

/** The kept conversation, for the viewer's Ask AI popup. `showWait` puts the staged wait line under the question being
 *  answered (the mini box keeps its own under its field); `chips` the address's follow-ups under the newest reply. */
export default function ChatHistory({ className, showWait = true, chips = true }) {
  const { log, wait, busy, travelling, send, followupsFor } = useAssistant()
  const { pathname, search } = useLocation()
  const [toggled, setToggled] = useState({})   // exchange key → open, where the visitor used the chevron
  const boxRef = useRef(null)
  const newest = log.length ? log[log.length - 1].key : null
  const followups = chips ? (followupsFor(pathname, search) || []).slice(0, 3) : []
  const pending = log.some((x) => x.pending)
  // the newest at the bottom, in view: on every change the box that holds the history scrolls to its end — or, when the
  // newest exchange is taller than the box, to that exchange's question, so the answer reads from its start
  const last = log[log.length - 1]
  const lastState = last ? `${last.key}:${last.pending ? 'p' : ''}:${last.overview?.status || ''}` : ''
  useEffect(() => {
    const el = boxRef.current
    const scroller = el?.closest(`[${CHAT_SCROLL}]`) || el
    if (!scroller) return
    const items = el.querySelectorAll('[data-testid="chat-exchange"]')
    const newestEl = items[items.length - 1]
    const end = scroller.scrollHeight - scroller.clientHeight
    if (!newestEl || !scroller.getBoundingClientRect) { scroller.scrollTop = scroller.scrollHeight; return }
    const top = newestEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 8
    scroller.scrollTop = Math.max(0, Math.min(end, top))
  }, [log.length, lastState, wait, followups.length])
  if (!log.length) return null
  return (
    <div ref={boxRef} className={cn('space-y-3', className)} data-testid="chat-history" aria-live="polite">
      <ol className="space-y-4" aria-label="Your questions and the answers">
        {log.map((x) => (
          <Exchange key={x.key} x={x} open={toggled[x.key] ?? x.key === newest} onToggle={() => setToggled((t) => ({ ...t, [x.key]: !(t[x.key] ?? x.key === newest) }))} />
        ))}
      </ol>
      {showWait && wait && pending && (
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-[14px] text-foreground/85" data-testid="chat-working">
          <span className="hcdp-comet-ring hcdp-comet-ring-sm" aria-hidden="true" /><span key={wait} className="hcdp-status-in">{wait}</span>
        </p>
      )}
      {followups.length > 0 && !busy && !travelling && (
        <ul role="list" aria-label="Follow-up questions" className="flex flex-wrap gap-2" data-testid="chat-followups">
          {followups.map((f) => (
            <li key={f} className="max-w-full">
              <button type="button" onClick={() => send(f, { docked: true })} data-testid="chat-followup"
                className="min-h-9 max-w-full rounded-full border border-border bg-card px-3.5 py-1.5 text-left text-[13px] leading-snug text-foreground shadow-sm hover:border-foreground [@media(pointer:coarse)]:min-h-11">{f}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
