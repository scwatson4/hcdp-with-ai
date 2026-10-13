import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowUp, ExternalLink, Link2 } from 'lucide-react'
import { useAssistant } from './AssistantProvider'
import { cn } from '../lib/utils'
import { handoffUrl } from '../site/handoff'
import { DEBOUNCE_MS, MIN_CHARS, fold, localMatch } from './localMatch'
import TileChoice from './TileChoice'

// T2 pick B (2026-10-08): the hand-off moment. The sentence is fixed (the backend writes the
// same words into the conversation history); "here" is the link; a grey line says what to
// expect; the newest analysis reply counts down five seconds and opens the tab by itself.
export const HANDOFF_SENTENCE = 'This is better answered by our AI data analysis tool. Try it out here'
export const HANDOFF_NOTE = 'Opens in a new tab · your question comes with you · sign in there with a code or an HCDP API key'

export const MAX_LINES = 3

export const EXAMPLES = [
  'How do I download Hurricane Lowell rainfall data?',
  'Which stations are on Kauai?',
  'Show me the Tropical Storm Nolo tracker',
  'How do I get station data through the API?',
  'Show me the drought map for August 2026',
  'Show me daily rainfall on Kauaʻi during Hurricane Lowell',
  'Take me to the Hurricane Lowell report',
  'Take me to the Hawaiʻi Mesonet live data',
  'Take me to the monthly climate summary',
  'Where is the fire risk map',
  'Where is the station data API',
  'Where are the rainfall downloads',
]

/** A random permutation of 0..n-1 (Fisher–Yates). Exported for tests. */
export function shuffledOrder(n, random = Math.random) {
  const a = Array.from({ length: n }, (_, i) => i)
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}


function Alternative({ a }) {
  const internal = a.url && a.url.startsWith('/')
  const inner = <><span className="font-medium">{a.title}</span>{a.why && <span className="text-subtle"> · {a.why}</span>}{!internal && <ExternalLink className="ml-1 inline h-3 w-3 text-subtle" aria-hidden="true" />}</>
  return internal ? <Link to={a.url} className="block rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs hover:border-foreground">{inner}</Link>
    : <a href={a.url} target="_blank" rel="noopener noreferrer" className="block rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs hover:border-foreground">{inner}</a>
}

/** An analysis reply: the fixed sentence with "here" as the link, the grey note, and the countdown
 *  (or its outcome) when this is the reply the provider is counting down for. */
function HandoffReply({ m }) {
  const { handoff, stayHere, settleHandoff } = useAssistant()
  const href = m.actions?.find((a) => a.type === 'handoff')?.url || handoffUrl({})
  const mine = handoff && handoff.id === m.id ? handoff : null
  const link = (text, testid) => <a href={href} target="_blank" rel="noopener noreferrer" onClick={settleHandoff} className="font-medium underline underline-offset-2 hover:text-accent" data-testid={testid}>{text}</a>
  return (
    <div data-testid="handoff-reply">
      <p data-testid="handoff-sentence">{HANDOFF_SENTENCE.slice(0, -4)}{link('here', 'handoff-link')}</p>
      <p className="mt-1 text-xs text-subtle">{HANDOFF_NOTE}</p>
      {mine?.status === 'counting' && (
        <p className="mt-1 text-xs text-subtle" data-testid="handoff-countdown" aria-live="off">
          Opening in {mine.remaining} s · <button type="button" onClick={stayHere} className="inline-flex items-center rounded px-1 font-medium text-foreground underline underline-offset-2 hover:text-accent [@media(pointer:coarse)]:min-h-11" data-testid="handoff-stay">Stay here</button>
        </p>
      )}
      {mine?.status === 'blocked' && <p className="mt-1 text-xs" data-testid="handoff-blocked">{link('Your browser blocked the new tab — open it here', 'handoff-blocked-link')}</p>}
      {mine?.status === 'opened' && <p className="mt-1 text-xs text-subtle" data-testid="handoff-opened">Opened in a new tab</p>}
    </div>
  )
}

/**
 * The ask field (R3 B + L2 A/C + L3 A + R1 D): one pill — 56 px in the landing hero (frosted glass over the
 * map), 44 px when docked under the header — wearing the spectrum ring. While there is no conversation yet
 * the typewriter ghost types each example out (28 ms a letter, holds 2 s, longer while the pointer rests,
 * fades 350 ms, next); Tab drops the example into the field; any typed character silences it; the keycap
 * shows only while the field has focus; reduced motion shows one still example. Once a conversation exists
 * the docked bar says "Ask for another page or map…" and focusing it opens the dropdown. On the landing
 * page the question stays in the bar after sending — the answer card does not echo it.
 * 13 Oct: on an inner page whose address has follow-up asks (from the destination's AI summary) the docked
 * bar's ghost cycles THOSE instead, with the same typing, hold and fade, a fresh random order per set,
 * frozen while the field has focus; Tab or a tap on the ghost text inserts one. A new set takes over as soon
 * as the field is empty and unfocused — a visitor who is typing is never interrupted. Without follow-ups the
 * docked bar behaves as before.
 * R6 D (13 Oct): the typeahead. From three typed characters a listbox under the bar (both bars) lists up to five
 * catalogue matches, found locally (localMatch.js; no AI call), 80 ms after the last keystroke: the title and a grey
 * kind word (map · page · tool · report · external ↗). ↑/↓ move, Esc closes (until the text changes), a click outside
 * closes; Enter asks the AI as before unless a row has been arrow-keyed to, in which case it is chosen; tapping or
 * choosing a row calls the provider's choose(): the field keeps the typed text, the wait line says "Opening {title}…"
 * for one hold, then the page opens (an external one in a new tab) and the overview flow runs.
 */
export function AskBar({ docked = false, glass = false }) {
  const { messages, busy, travelling, send, choose, followupsFor } = useAssistant()
  const { pathname, search } = useLocation()
  const [text, setText] = useState('')
  // ── the typeahead (R6 D) ──
  const listId = useId().replace(/:/g, '')
  const formRef = useRef(null)
  const [matches, setMatches] = useState([])
  const [active, setActive] = useState(-1)        // the arrow-keyed row, -1 for none
  const [dismissed, setDismissed] = useState(false)   // Esc or a click outside closed it, until the text changes
  const canList = fold(text).trim().length >= MIN_CHARS
  useEffect(() => {
    setDismissed(false); setActive(-1)
    if (!canList) { setMatches([]); return undefined }
    const t = setTimeout(() => setMatches(localMatch(text)), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [text, canList])
  const listOpen = canList && !dismissed && matches.length > 0 && !busy && !travelling
  useEffect(() => {
    if (!listOpen) return undefined
    const onDown = (e) => { if (formRef.current && !formRef.current.contains(e.target)) setDismissed(true) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [listOpen])
  const pick = (row) => { setDismissed(true); choose(row, { ask: text, echoAsk: true, docked }) }
  const hasConversation = messages.length > 1
  // The ghost's pool: this address's follow-ups when docked; the examples before any conversation; else nothing.
  const followups = docked && followupsFor ? followupsFor(pathname, search) : null
  const pool = followups && followups.length ? followups : (!hasConversation ? EXAMPLES : null)
  const poolKind = followups && followups.length ? 'followups' : 'examples'
  const poolKey = pool ? `${poolKind}:${pool.join('\u0001')}` : 'none'
  const ghostActive = !text && !busy && !travelling && !!pool
  const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  // A fresh random order per pool (Fisher–Yates), so a refresh almost never starts on the same example.
  const orderRef = useRef({ key: null, order: [] })
  if (orderRef.current.key !== poolKey) orderRef.current = { key: poolKey, order: shuffledOrder(pool ? pool.length : 0) }
  const exampleAt = (i) => (pool && orderRef.current.order.length ? pool[orderRef.current.order[i % orderRef.current.order.length]] : '')
  const [typed, setTyped] = useState(reduceMotion ? exampleAt(0) : '')
  const [ghostShown, setGhostShown] = useState(true)
  const [focused, setFocused] = useState(false)
  const idxRef = useRef(0)
  const lastPoolRef = useRef(poolKey)
  const hoverRef = useRef(false)
  const focusRef = useRef(false)   // a click into the field freezes the carousel where it is; typing stops it altogether
  const inputRef = useRef(null)
  useEffect(() => {
    if (lastPoolRef.current !== poolKey) {   // a new set: start it from the top, with nothing left of the old one
      lastPoolRef.current = poolKey
      idxRef.current = 0
      setTyped(reduceMotion && pool ? exampleAt(0) : '')
      setGhostShown(true)
    }
    if (!ghostActive || reduceMotion) return undefined
    let cancelled = false; let timer = null; let wake = null
    const sleep = (ms) => new Promise((resolve) => { wake = resolve; timer = setTimeout(resolve, ms) })
    const whileFocused = async () => { while (focusRef.current && !cancelled) await sleep(200) }
    ;(async () => {
      while (!cancelled) {
        await whileFocused()
        const ex = exampleAt(idxRef.current)
        setGhostShown(true)
        for (let k = 1; k <= ex.length && !cancelled; k += 1) { await whileFocused(); if (cancelled) break; setTyped(ex.slice(0, k)); await sleep(28) }
        if (cancelled) break
        await sleep(2000)
        while ((hoverRef.current || focusRef.current) && !cancelled) await sleep(300)
        if (cancelled) break
        setGhostShown(false); await sleep(350)
        if (cancelled) break
        idxRef.current += 1; setTyped('')
      }
    })()
    return () => { cancelled = true; if (timer) clearTimeout(timer); if (wake) wake() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghostActive, reduceMotion, poolKey])
  const ghostQuery = ghostActive ? exampleAt(idxRef.current) : null
  const insertGhost = () => { if (ghostQuery) { setText(ghostQuery); inputRef.current?.focus() } }
  // The field wraps long questions and grows to three lines; beyond that it scrolls inside (Enter sends, Shift+Enter breaks a line).
  const lineHeight = docked ? 24 : (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 640px)').matches ? 28 : 24)
  const [lines, setLines] = useState(1)
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    if (!text) { setLines(1); return }
    el.style.height = `${lineHeight}px`
    const n = Math.max(1, Math.min(MAX_LINES, Math.round(el.scrollHeight / lineHeight) || 1))
    setLines(n)
    el.style.height = `${n * lineHeight}px`
  }, [text, lineHeight])
  // Sending from the docked bar empties the field and lets go of it (the page is about to change; on phones the keyboard
  // goes), so the destination's follow-ups can start cycling with no user action; a click back in freezes them again.
  const submit = (e) => { e?.preventDefault(); const t = text; if (docked) { setText(''); inputRef.current?.blur() } send(t, { docked }) }
  const onKeyDown = (e) => {
    if (listOpen && e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return }
    if (listOpen && e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? matches.length - 1 : a - 1)); return }
    if (listOpen && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissed(true); return }
    if (e.key === 'Enter' && !e.shiftKey) { if (listOpen && active >= 0 && matches[active]) { e.preventDefault(); pick(matches[active]) } else submit(e); return }
    if (e.key === 'Tab' && !e.shiftKey && ghostQuery) { e.preventDefault(); setText(ghostQuery) }
  }
  const placeholder = ghostQuery ? '' : docked && hasConversation ? 'Ask for another page or map…' : 'What are you looking for?'
  return (
    <form ref={formRef} onSubmit={submit} onMouseEnter={() => { hoverRef.current = true }} onMouseLeave={() => { hoverRef.current = false }} data-testid={docked ? 'docked-ask-bar' : 'ask-bar'} className="relative">
      <div className={cn('hcdp-ask', lines > 1 ? 'rounded-3xl' : 'rounded-full', docked ? 'min-h-11' : 'min-h-14 shadow-lg', busy && 'hcdp-ask-busy')} data-testid="ask-field" data-busy={busy ? 'true' : 'false'} data-lines={lines} data-hero={docked ? undefined : 'true'}>
        <span aria-hidden="true" className="hcdp-ask-ring" />
        <div className={cn('hcdp-ask-field relative flex min-h-[inherit] items-end', docked ? 'py-1 pl-4 pr-1' : 'py-2 pl-6 pr-2', glass && 'hcdp-ask-glass')}>
          <textarea ref={inputRef} value={text} rows={1} onChange={(e) => setText(e.target.value.slice(0, 500))} autoComplete="off" enterKeyHint="send"
            onKeyDown={onKeyDown}
            onFocus={() => { setFocused(true); focusRef.current = true }} onBlur={() => { setFocused(false); focusRef.current = false }}
            aria-describedby={ghostQuery ? 'ask-ghost-hint' : undefined}
            aria-autocomplete="list" aria-controls={listOpen ? listId : undefined} aria-expanded={listOpen}
            aria-activedescendant={listOpen && active >= 0 ? `${listId}-${active}` : undefined}
            placeholder={placeholder}
            aria-label="Ask AI" data-testid="assistant-input"
            className={cn('hcdp-ask-input my-auto min-w-0 flex-1 resize-none bg-transparent text-[16px] leading-6 text-foreground placeholder:text-subtle focus-visible:outline-none', !docked && 'sm:text-[18px] sm:leading-7', lines >= MAX_LINES ? 'overflow-y-auto' : 'overflow-hidden')}
            style={{ height: `${lines * lineHeight}px` }} />
          {ghostQuery && (
            <>
              <span id="ask-ghost-hint" className="sr-only">{poolKind === 'followups' ? 'Press Tab to insert the suggested follow-up question.' : 'Press Tab to insert the suggested example question.'}</span>
              <div aria-hidden="true" data-testid="composer-ghost" data-pool={poolKind} className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 truncate text-[16px] transition-opacity duration-300 motion-reduce:transition-none', docked ? 'left-4 right-12 text-subtle sm:right-28' : 'left-6 right-14 text-foreground/70 sm:right-32 sm:text-[18px]')} style={{ opacity: ghostShown ? 1 : 0 }}>
                {/* a tap on the follow-up's text drops it into the field (the rest of the field still just focuses) */}
                <span data-testid="composer-ghost-text" onClick={poolKind === 'followups' ? insertGhost : undefined} className={cn(poolKind === 'followups' && 'pointer-events-auto cursor-text')}>{typed}</span><span className={cn('ml-px inline-block h-[1.1em] w-px translate-y-[3px] bg-subtle align-baseline', reduceMotion || typed.length >= ghostQuery.length ? 'opacity-0' : 'hcdp-caret')} />
              </div>
            </>
          )}
          {ghostQuery && focused && <kbd className="mr-2 hidden shrink-0 rounded-md border border-border bg-surface px-1.5 py-px font-mono text-[11px] text-foreground sm:inline-block" data-testid="ask-tab-hint">Tab ↹</kbd>}
          <button type="submit" disabled={!text.trim() || busy || travelling} aria-label="Send" className={cn('hcdp-send grid shrink-0 place-items-center rounded-full text-accent-foreground disabled:opacity-40', docked ? 'h-9 w-9' : 'h-10 w-10')}><ArrowUp className="h-4 w-4" /></button>
        </div>
      </div>
      {listOpen && (
        <ul role="listbox" id={listId} aria-label="Pages that match what you typed" data-testid="typeahead"
          className={cn('absolute inset-x-0 top-full z-20 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-lg', docked ? 'mt-1' : 'mt-2')}>
          {matches.map((row, i) => (
            <li key={row.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} data-testid="typeahead-row" data-kind={row.kindWord}
              onPointerDown={(e) => e.preventDefault()} onClick={() => pick(row)} onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-center justify-between gap-3 px-4 py-2 text-left text-[14px] text-foreground [@media(pointer:coarse)]:min-h-11', i === active ? 'bg-muted' : 'hover:bg-muted/60')}>
              <span className="min-w-0 truncate font-medium">{row.title}</span>
              <span className="shrink-0 text-xs text-subtle" data-testid="typeahead-kind">{row.kindWord}{row.kindWord === 'external' && <span aria-hidden="true"> ↗</span>}{row.kindWord === 'external' && <span className="sr-only"> (opens in a new tab)</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}

/**
 * The conversation: questions and plain answers (`hideUser` leaves the questions out — on the landing
 * page the question is already in the bar). `compact` is the docked bar's dropdown.
 */
export function Conversation({ compact = false, hideUser = false, latestOnly = false, className }) {
  const { messages: all, busy, choose } = useAssistant()
  // R5 C: a clarify answer with did-you-mean options shows them as picture tiles (the rows of alternatives then step aside);
  // a tap chooses with the question that led to the answer as the ask, so the overview reads "fire → You chose …".
  const tiles = (m) => m.role === 'assistant' && m.intent === 'clarify' && Array.isArray(m.options) && m.options.length >= 2
  const askFor = (m) => { const i = all.indexOf(m); for (let k = i - 1; k >= 0; k -= 1) if (all[k].role === 'user') return all[k].content; return '' }
  // latestOnly: the docked dropdown shows the newest reply only — never the history (12 Oct).
  const messages = latestOnly ? [all[0], ...all.filter((m) => m.role === 'assistant').slice(-1)] : all
  const listRef = useRef(null)
  const firstRender = useRef(true)
  useEffect(() => { if (firstRender.current) { firstRender.current = false; return } const el = listRef.current; if (el) el.scrollTop = el.scrollHeight }, [messages, busy])
  return (
    <div ref={listRef} className={cn('space-y-3 overflow-y-auto', compact ? 'px-1 py-1.5 text-[13px]' : 'max-h-[42vh] px-1 py-2', className)} aria-live="polite" data-testid="conversation">
      {messages.map((m, i) => (i === 0 || (hideUser && m.role === 'user') ? null : (
        <div key={m.id ?? i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')} data-testid={m.role === 'user' ? 'user-bubble' : 'assistant-bubble'}>
          <div className={cn('rounded-lg px-3 py-2 text-sm leading-relaxed', tiles(m) ? 'w-full' : 'max-w-[92%]', m.role === 'user' ? 'bg-accent text-accent-foreground' : 'bg-surface border border-border')}>
            {m.intent === 'analysis' ? <HandoffReply m={m} /> : m.content}
            {m.role === 'user' && <button type="button" title="Copy a link that asks this" aria-label="Copy a link that asks this" onClick={(ev) => { const href = `${window.location.origin}/?ask=${encodeURIComponent(m.content)}`; const b = ev.currentTarget; navigator.clipboard?.writeText(href).then(() => { b.dataset.copied = '1'; setTimeout(() => { delete b.dataset.copied }, 1500) }).catch(() => window.prompt('Copy this link', href)) }} className="group ml-1 inline-grid h-6 w-6 place-items-center rounded align-middle text-accent-foreground/70 hover:bg-white/10 hover:text-accent-foreground data-[copied]:text-accent-foreground"><Link2 className="h-3.5 w-3.5 group-data-[copied]:hidden" aria-hidden="true" /><span className="hidden text-[10px] group-data-[copied]:inline">Copied</span></button>}
            {m.actions?.filter((a) => a.type === 'open').map((a, j) => (
              <div key={j} className="mt-2"><a className="inline-flex items-center gap-1 rounded-md border border-border bg-canvas px-2.5 py-1 text-xs font-medium hover:border-foreground" href={a.url} target="_blank" rel="noopener noreferrer">{a.blocked ? 'Your browser blocked the new tab — open it here' : 'Opened in a new tab — open again'} <ExternalLink className="h-3 w-3" aria-hidden="true" /></a></div>
            ))}
            {tiles(m) && <TileChoice options={m.options} onChoose={(o) => choose(o, { ask: askFor(m), echoAsk: false, docked: compact })} />}
            {m.alternatives?.length > 0 && !tiles(m) && !compact && <div className="mt-2 space-y-1">{m.alternatives.map((a, j) => <Alternative key={j} a={a} />)}</div>}
            {m.alternatives?.length > 0 && !tiles(m) && compact && <div className="mt-1.5 text-xs text-subtle">Also: {m.alternatives.slice(0, 3).map((a, j) => <span key={j}>{j > 0 && ' · '}{a.url?.startsWith('/') ? <Link to={a.url} className="underline underline-offset-2 hover:text-foreground">{a.title}</Link> : <a href={a.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">{a.title}</a>}</span>)}</div>}
          </div>
        </div>
      )))}
      {busy && <div className="text-xs text-subtle" data-testid="assistant-busy">Looking…</div>}
    </div>
  )
}

/** The landing page's assistant: the hero bar and, once there is something to say, the answer card
 *  under it (the AI's bubbles only — the question is in the bar). */
export default function AssistantPanel({ glass = false }) {
  const { messages, busy, travelling, wait, epoch } = useAssistant()
  const last = messages[messages.length - 1]
  const lastIsNavigate = last?.role === 'assistant' && (last.actions || []).some((a) => a.type === 'navigate')
  // 13 Oct: while the AI works, and while a navigation answer is held before the travel, only a rainbow comet
  // ring and one line of text sit under the bar — no card, no background. R6 C: the line is staged by the
  // provider ("Thinking…", "Finding the right page…", "Opening {destination}…"); each change fades in (the key
  // remounts the span; reduced motion: no animation). The card stays for replies with nowhere to go (info,
  // clarify, the hand-off) once their line has ended.
  const working = wait != null
  const showCard = !busy && !travelling && !working && messages.length > 1 && !lastIsNavigate
  return (
    <div className="flex flex-col" data-testid="assistant-panel">
      <AskBar key={epoch} glass={glass} />
      {working && (
        <div className="mt-4 flex items-center justify-center gap-3 px-2 text-center text-[15px] text-foreground/85 sm:text-[16px]" role="status" aria-live="polite" data-testid="landing-working">
          <span className="hcdp-comet-ring" aria-hidden="true" />
          <span key={wait} className="hcdp-status-in" data-testid="landing-status">{wait}</span>
        </div>
      )}
      {showCard && (
        <div className="mt-3 rounded-xl border border-border bg-card/90 p-2 shadow-lg backdrop-blur" data-testid="landing-answers">
          <Conversation hideUser />
        </div>
      )}
    </div>
  )
}
