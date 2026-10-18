import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, ChevronRight, ChevronUp, ExternalLink } from 'lucide-react'
import { prefersReducedMotion, useAssistantOptional } from './AssistantProvider'
import { cn } from '../lib/utils'
import { OverviewFeedback } from '../feedback/Thumbs'

// 13 Oct: the AI overview at the top of the page the navigator just opened. A quiet block, no card: a 3 px vertical
// spectrum rule on the left; a header row in the "AI Overview" manner — a four-point star filled with the logo's
// spectrum and the words "AI Overview" with a chevron (18 Oct, the user's pick: "instead of X, offer an arrow to close and
// reopen the AI overview" — the header is one toggle: open reads "AI Overview ⌄" over the content, closed is the header
// line alone, "AI Overview ›", and a tap opens it again; there is no ✕ and nothing is dismissed); then the numbered
// sources FIRST ("From HCDP: ¹ Hurricane Lowell report · ² Access Data", external, new tab; the visible ↗ went on
// 15 Oct: the underline already says link, and screen readers still hear "(opens in a new tab)"); then the
// summary's sentences, each fading and rising CHUNK_STAGGER_MS apart (reduced motion: all at once), each ending in
// small superscript links to the sources it rests on; then "Show more ⌄", which unfolds (same fade) the "more"
// sentences, "Also:" (the navigator's alternatives for this answer) and the follow-up asks as tappable rows (a tap
// sends that question), and reads "Show less ⌃" open. Show more is collapsed on every new overview; nothing persisted.
// It renders while the provider holds an overview for this very pathname (or the page's own, `fallback`), keyed by the
// overview's id, so a new answer for the same page fades in again. While the overview is still being written the block
// shows its header and a small comet ring.
// Open or closed (18 Oct): a navigation's overview opens by itself; a page's own overview (a direct load) waits closed.
// The visitor's toggle holds for that overview while they stay on the page; the next answer's overview opens again.
// P4 A (13 Oct): at the bottom, after Show more, a small "Wrong page?" link unfolds a two-tap chooser inside the block —
// "Which page did you want?" with the answer's alternatives as rows (title + why) and an "Other…" row that reveals a
// one-line field and Send. A row reports the want (reportWrongPage) and opens that page with no AI call (choose);
// Other reports the text and asks the assistant with it. The visitor's next page is attached to the report by the provider.
// F1 A (13 Oct): the review-period 👍 / 👎 sit at the right of that last row (feedback/Thumbs.jsx, OverviewFeedback).
export const CHUNK_STAGGER_MS = 350
// 15 Oct: a cached page overview (a mirrored or app page opened directly) waits closed — "AI Overview ›" — for a tap, and
// then plays the same beat as a live one — the header, then
// "Writing an overview of this page…" with the comet ring for PAGE_REVEAL.ms, then the sources and the sentences fading in
// one after another — so it reads as written for this visit. Reduced motion, or ms = 0 (tests), shows it at once.
export const PAGE_REVEAL = { ms: 700 }
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
export const superscript = (n) => String(n).split('').map((d) => SUP[Number(d)] ?? d).join('')

// 14 Oct (QB-O1 B): a mirrored HCDP page opened directly, with no ask, shows its cached overview instead — `fallback`, the
// same shape with `page: true` (written once per copy of the page; no "Wrong page?", there was no question); a navigation's
// per-question overview replaces it. 18 Oct: the app pages (the storm reports, the Climate Summary, the Mesonet's viewers,
// the Guam viewer) have one too, written by the mirror's job from the catalog. Key terms: the model wraps up to three in
// **…** (summary.py keeps at most three); they render bold, stray asterisks go.
export default function AISummary({ className, scrollIntoView = false, fallback = null }) {
  const assistant = useAssistantOptional()
  const { pathname } = useLocation()
  // the visitor's toggle for the overview on screen ({ id, open }); this component lives as long as the page visit
  const [choice, setChoice] = useState(null)
  const summary = assistant?.summary
  const answer = summary && summary.path === pathname ? summary : null
  const shown = answer || (fallback && fallback.path === pathname ? fallback : null)
  if (!shown) return null
  const open = choice && choice.id === shown.id ? choice.open : defaultOpen(shown)
  const toggle = () => setChoice({ id: shown.id, open: !open })
  return (
    <SummaryBlock key={shown.id} summary={shown} open={open} onToggle={toggle} send={assistant?.send} choose={assistant?.choose}
      reportWrongPage={answer ? assistant.reportWrongPage : null} className={className} scrollIntoView={Boolean(answer) && scrollIntoView} />
  )
}

/** Open by default right after a navigation (an answer's overview); a page's own overview waits closed. */
export const defaultOpen = (summary) => !summary?.page

/** "**daily rainfall map**" → the words in bold; any other asterisk is dropped. */
export function renderTerms(text) {
  const out = []
  const s = String(text ?? '')
  const re = /\*\*([^*]+?)\*\*/g
  let last = 0
  let m
  let k = 0
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index).replace(/\*/g, ''))
    out.push(<strong key={`t${k++}`} className="font-semibold text-foreground" data-testid="ai-summary-term">{m[1].trim()}</strong>)
    last = m.index + m[0].length
  }
  if (last < s.length) out.push(s.slice(last).replace(/\*/g, ''))
  return out
}

/** "Wrong page?" → "Which page did you want?": the alternatives as rows, then "Other…" with a line of text (P4 A). */
function WrongPage({ summary, send, choose, reportWrongPage }) {
  const [open, setOpen] = useState(false)
  const [other, setOther] = useState(false)
  const [text, setText] = useState('')
  const [state, setState] = useState('idle')   // 'idle' | 'sending' | 'sent'
  const alternatives = (summary.alternatives || []).filter((a) => a && a.url && a.title)
  const pickRow = async (a) => {
    if (state !== 'idle') return
    setState('sending')
    await reportWrongPage?.({ title: a.title, url: a.url })
    setState('sent')
    choose?.({ title: a.title, url: a.url }, { ask: summary.ask || '', echoAsk: false, docked: true })
  }
  const sendOther = async (e) => {
    e?.preventDefault()
    const t = text.trim()
    if (!t || state !== 'idle') return
    setState('sending')
    await reportWrongPage?.({ text: t })
    setState('sent')
    send?.(t)
  }
  return (
    <div className="mt-2" data-testid="wrong-page">
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="text-[12px] text-subtle underline-offset-2 hover:text-foreground hover:underline [@media(pointer:coarse)]:min-h-11" data-testid="wrong-page-link">Wrong page?</button>
      )}
      {open && (
        <div className="rounded-lg border border-border bg-surface/60 p-3" role="group" aria-labelledby="wrong-page-q" data-testid="wrong-page-chooser">
          <p id="wrong-page-q" className="text-[13px] font-medium">Which page did you want?</p>
          <ul className="mt-2 divide-y divide-border rounded-md border border-border bg-card" aria-label="Pages you may have wanted">
            {alternatives.map((a) => (
              <li key={a.url}>
                <button type="button" onClick={() => pickRow(a)} disabled={state !== 'idle'} className="flex min-h-9 w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[13px] hover:bg-muted disabled:opacity-60 [@media(pointer:coarse)]:min-h-11" data-testid="wrong-page-row">
                  <span className="min-w-0"><span className="font-medium">{a.title}</span>{a.why && <span className="text-subtle"> · {a.why}</span>}</span>
                  {!a.url.startsWith('/') && <ExternalLink className="h-3 w-3 shrink-0 text-subtle" aria-label="opens in a new tab" />}
                </button>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => setOther(true)} aria-expanded={other} className="flex min-h-9 w-full items-center px-3 py-1.5 text-left text-[13px] hover:bg-muted [@media(pointer:coarse)]:min-h-11" data-testid="wrong-page-other">Other…</button>
            </li>
          </ul>
          {other && (
            <form onSubmit={sendOther} className="mt-2 flex items-stretch gap-2" data-testid="wrong-page-other-form">
              <input type="text" value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} maxLength={500} placeholder="What were you looking for?" aria-label="What were you looking for?" autoFocus
                className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-[13px] text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="wrong-page-text" />
              <button type="submit" disabled={!text.trim() || state !== 'idle'} className="hcdp-send min-h-11 rounded-md px-4 text-[13px] font-medium text-accent-foreground disabled:opacity-40" data-testid="wrong-page-send">Send</button>
            </form>
          )}
          {state === 'sent' && <p className="mt-2 text-[12px] text-subtle" role="status" data-testid="wrong-page-thanks">Thanks — noted.</p>}
        </div>
      )}
    </div>
  )
}

/** The logo's spectrum as a four-point star (the AI Overview mark). */
function Star({ id }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0" data-testid="ai-overview-star">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c9503c" /><stop offset="0.2" stopColor="#cb6f24" /><stop offset="0.4" stopColor="#e8b84b" />
          <stop offset="0.6" stopColor="#86b45f" /><stop offset="0.8" stopColor="#3f8f8b" /><stop offset="1" stopColor="#303078" />
        </linearGradient>
      </defs>
      <path d="M12 1.5 C13.2 7.6 16.4 10.8 22.5 12 C16.4 13.2 13.2 16.4 12 22.5 C10.8 16.4 7.6 13.2 1.5 12 C7.6 10.8 10.8 7.6 12 1.5 Z" fill={`url(#${id})`} />
    </svg>
  )
}

/** The superscript source links after a sentence. */
function Cites({ cites, sources, testid }) {
  const list = (cites || []).filter((k) => sources[k - 1])
  if (!list.length) return null
  return (
    <span className="ml-0.5 whitespace-nowrap" data-testid={testid}>
      {list.map((k) => (
        <a key={k} href={sources[k - 1].url} target="_blank" rel="noopener noreferrer" className="ml-px text-[10px] text-subtle hover:underline" title={sources[k - 1].title} data-testid="ai-summary-cite">
          {superscript(k)}<span className="sr-only"> source {k}: {sources[k - 1].title} (opens in a new tab)</span>
        </a>
      ))}
    </span>
  )
}

function Chunks({ chunks, cites, sources, reduce, testid, chunkTestid, small = false }) {
  return (
    <div className={cn('max-w-3xl leading-relaxed', small ? 'text-[14px]' : 'text-[15px]')} data-testid={testid}>
      {chunks.map((c, i) => (
        <p key={i} className="hcdp-ai-chunk" style={reduce ? undefined : { animationDelay: `${i * CHUNK_STAGGER_MS}ms` }} data-testid={chunkTestid}>
          {renderTerms(c)}<Cites cites={cites?.[i]} sources={sources} testid={`${chunkTestid}-cites`} />
        </p>
      ))}
    </div>
  )
}

/**
 * One overview. `open` / `onToggle` are the header's chevron (controlled by the parent, AISummary or the Ask AI history);
 * `variant` 'chat' is the compact form inside the Ask AI popup's history (no "Wrong page?" or thumbs of its own — the
 * reply's bubble has them —, and its Show more unfolds the further sentences only).
 */
export function SummaryBlock({ summary, open = true, onToggle, send, choose, reportWrongPage, className, scrollIntoView, variant = 'page' }) {
  const ref = useRef(null)
  const gradId = useId().replace(/:/g, '')
  const bodyId = `ai-overview-${useId().replace(/:/g, '')}`
  const chat = variant === 'chat'
  const [more, setMore] = useState(false)   // Show more: collapsed on every new overview
  // The data page shows the block above its Export form, further down the page: bring it into view on arrival
  // (after the shell's scroll-to-top, which runs in a parent effect).
  useEffect(() => {
    if (!scrollIntoView) return undefined
    const t = window.setTimeout(() => ref.current?.scrollIntoView?.({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }), 80)
    return () => window.clearTimeout(t)
  }, [scrollIntoView])
  const reduce = prefersReducedMotion()
  const { status, chunks = [], cites = [], more: moreChunks = [], moreCites = [], sources = [], followups = [], alternatives = [] } = summary
  // 15 Oct: a page overview opened for the first time plays the writing beat (PAGE_REVEAL.ms) before its sentences, so it
  // reads as written for this visit; an answer's overview was written live, and a reopened one shows at once.
  const revealed = useRef(open)
  const [warming, setWarming] = useState(false)
  useEffect(() => {
    if (!warming) return undefined
    const t = window.setTimeout(() => setWarming(false), PAGE_REVEAL.ms)
    return () => window.clearTimeout(t)
  }, [warming])
  const toggle = () => {
    if (!open && !revealed.current) {
      revealed.current = true
      if (summary.page && status === 'ready' && PAGE_REVEAL.ms > 0 && !reduce) setWarming(true)
    }
    onToggle?.()
  }
  const shown = !open ? 'collapsed' : warming ? 'pending' : status
  const extra = chat ? [] : alternatives
  const rows = chat ? [] : followups
  const hasMore = moreChunks.length > 0 || extra.length > 0 || rows.length > 0
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <section ref={ref} aria-label="AI Overview" data-testid="ai-summary" data-status={shown} data-open={open ? 'true' : 'false'} data-kind={summary.page ? 'page' : 'answer'} data-variant={variant}
      className={cn('hcdp-ai-summary relative pl-4', className)} style={{ scrollMarginTop: 'calc(var(--hcdp-sticky-h, 7rem) + 1rem)' }}>
      <span aria-hidden="true" className="hcdp-ai-summary-rule" />
      <div className="flex items-center gap-2" data-testid="ai-summary-header">
        {/* 18 Oct: the header is the toggle — "AI Overview ⌄" open, "AI Overview ›" closed — in place of the ✕ */}
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={bodyId} data-testid="ai-overview-toggle"
          className="inline-flex items-center gap-2 rounded-md py-1 pr-1 text-[13px] font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11">
          <Star id={gradId} /><span data-testid="ai-overview-title">AI Overview</span>
          <Chevron className="-ml-1 h-4 w-4 shrink-0 text-subtle" aria-hidden="true" data-testid="ai-overview-chevron" data-direction={open ? 'down' : 'right'} />
        </button>
      </div>
      <div id={bodyId} hidden={!open} data-testid="ai-summary-body">
      {shown === 'pending' && (
        <p className="mt-1.5 flex items-center gap-2 text-sm text-subtle" role="status" data-testid="ai-summary-pending">
          <span className="hcdp-comet-ring hcdp-comet-ring-sm" aria-hidden="true" />Writing an overview of this page…
        </p>
      )}
      {shown === 'ready' && (
        <>
          {sources.length > 0 && (
            <p className="mt-1.5 text-[13px] text-subtle" data-testid="ai-summary-sources">
              From HCDP:{' '}
              {sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && ' · '}
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
                    <span className="sr-only">source {i + 1}: </span><span aria-hidden="true">{superscript(i + 1)} </span>{s.title}<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </span>
              ))}
            </p>
          )}
          <div className="mt-1.5">
            <Chunks chunks={chunks} cites={cites} sources={sources} reduce={reduce} testid="ai-summary-text" chunkTestid="ai-summary-chunk" small={chat} />
          </div>
          {hasMore && (
            <>
              {more && (
                <div className="mt-3 space-y-3" data-testid="ai-summary-more">
                  {moreChunks.length > 0 && <Chunks chunks={moreChunks} cites={moreCites} sources={sources} reduce={reduce} testid="ai-summary-more-text" chunkTestid="ai-summary-more-chunk" small={chat} />}
                  {extra.length > 0 && (
                    <p className="hcdp-ai-chunk text-[13px] text-subtle" style={reduce ? undefined : { animationDelay: `${moreChunks.length * CHUNK_STAGGER_MS}ms` }} data-testid="ai-summary-also">
                      Also:{' '}
                      {extra.map((a, j) => (
                        <span key={`${a.url}-${j}`}>
                          {j > 0 && ' · '}
                          {a.url.startsWith('/')
                            ? <Link to={a.url} className="underline underline-offset-2 hover:text-foreground">{a.title}</Link>
                            : <a href={a.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">{a.title}<ExternalLink className="ml-0.5 inline h-3 w-3" aria-label="opens in a new tab" /></a>}
                        </span>
                      ))}
                    </p>
                  )}
                  {rows.length > 0 && (
                    <ul className="hcdp-ai-chunk divide-y divide-border rounded-lg border border-border" style={reduce ? undefined : { animationDelay: `${(moreChunks.length + (extra.length ? 1 : 0)) * CHUNK_STAGGER_MS}ms` }} aria-label="Follow-up questions" data-testid="ai-summary-followups">
                      {rows.map((f) => (
                        <li key={f}>
                          <button type="button" onClick={() => send?.(f)} className="flex min-h-9 w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[13px] hover:bg-muted [@media(pointer:coarse)]:min-h-11" data-testid="ai-summary-followup">
                            <span>{f}</span><span aria-hidden="true" className="text-subtle">↵</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <button type="button" onClick={() => setMore((o) => !o)} aria-expanded={more}
                className={cn('mt-3 flex w-full items-center justify-center gap-1 rounded-full border border-border text-[13px] text-foreground hover:bg-muted [@media(pointer:coarse)]:min-h-11', chat ? 'h-8' : 'h-9')} data-testid="ai-summary-toggle">
                {more ? <>Show less <ChevronUp className="h-4 w-4" aria-hidden="true" /></> : <>Show more <ChevronDown className="h-4 w-4" aria-hidden="true" /></>}
              </button>
            </>
          )}
          {!chat && <OverviewFeedback summary={summary}>{reportWrongPage && <WrongPage summary={summary} send={send} choose={choose} reportWrongPage={reportWrongPage} />}</OverviewFeedback>}
        </>
      )}
      </div>
    </section>
  )
}
