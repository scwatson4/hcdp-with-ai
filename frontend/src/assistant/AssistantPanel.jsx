import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUp, ExternalLink, Link2 } from 'lucide-react'
import { useAssistant } from './AssistantProvider'
import { cn } from '../lib/utils'
import { handoffUrl } from '../site/handoff'

// T2 pick B (2026-10-08): the hand-off moment. The sentence is fixed (the backend writes the
// same words into the conversation history); "here" is the link; a grey line says what to
// expect; the newest analysis reply counts down five seconds and opens the tab by itself.
export const HANDOFF_SENTENCE = 'This is better answered by our AI data analysis tool. Try it out here'
export const HANDOFF_NOTE = 'Opens in a new tab · your question comes with you · sign in there with a code or an HCDP API key'

export const EXAMPLES = [
  'I need to download rainfall data from Hurricane Lowell',
  'Which stations are on Kauai?',
  'Show me the Tropical Storm Nolo tracker',
  'How do I get station data through the API?',
]

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
 */
export function AskBar({ docked = false, glass = false }) {
  const { messages, busy, travelling, send, setMode } = useAssistant()
  const [text, setText] = useState('')
  const hasConversation = messages.length > 1
  const ghostActive = !text && !busy && !travelling && !hasConversation
  const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [typed, setTyped] = useState(reduceMotion ? EXAMPLES[0] : '')
  const [ghostShown, setGhostShown] = useState(true)
  const [focused, setFocused] = useState(false)
  const idxRef = useRef(0)
  const hoverRef = useRef(false)
  const inputRef = useRef(null)
  useEffect(() => {
    if (!ghostActive || reduceMotion) return undefined
    let cancelled = false; let timer = null; let wake = null
    const sleep = (ms) => new Promise((resolve) => { wake = resolve; timer = setTimeout(resolve, ms) })
    ;(async () => {
      while (!cancelled) {
        const ex = EXAMPLES[idxRef.current % EXAMPLES.length]
        setGhostShown(true)
        for (let k = 1; k <= ex.length && !cancelled; k += 1) { setTyped(ex.slice(0, k)); await sleep(28) }
        if (cancelled) break
        await sleep(2000)
        while (hoverRef.current && !cancelled) await sleep(300)
        if (cancelled) break
        setGhostShown(false); await sleep(350)
        if (cancelled) break
        idxRef.current += 1; setTyped('')
      }
    })()
    return () => { cancelled = true; if (timer) clearTimeout(timer); if (wake) wake() }
  }, [ghostActive, reduceMotion])
  const ghostQuery = ghostActive ? EXAMPLES[idxRef.current % EXAMPLES.length] : null
  const submit = (e) => { e?.preventDefault(); const t = text; if (docked) setText(''); send(t) }
  const placeholder = ghostQuery ? '' : docked && hasConversation ? 'Ask for another page or map…' : 'What are you looking for?'
  return (
    <form onSubmit={submit} onMouseEnter={() => { hoverRef.current = true }} onMouseLeave={() => { hoverRef.current = false }} data-testid={docked ? 'docked-ask-bar' : 'ask-bar'}>
      <div className={cn('hcdp-ask rounded-full', docked ? 'h-11' : 'h-14 shadow-lg', busy && 'hcdp-ask-busy')} data-testid="ask-field" data-busy={busy ? 'true' : 'false'}>
        <span aria-hidden="true" className="hcdp-ask-ring" />
        <div className={cn('hcdp-ask-field relative flex h-full items-center', docked ? 'pl-4 pr-1' : 'pl-6 pr-2', glass && 'hcdp-ask-glass')}>
          <input ref={inputRef} type="text" value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} autoComplete="off" enterKeyHint="search"
            onKeyDown={(e) => { if (e.key === 'Enter') submit(e); else if (e.key === 'Tab' && !e.shiftKey && ghostQuery) { e.preventDefault(); setText(ghostQuery) } }}
            onFocus={() => { setFocused(true); if (docked && hasConversation) setMode('panel') }} onBlur={() => setFocused(false)}
            aria-describedby={ghostQuery ? 'ask-ghost-hint' : undefined}
            placeholder={placeholder}
            aria-label="Ask AI" data-testid="assistant-input"
            className={cn('h-full min-w-0 flex-1 bg-transparent text-[16px] text-foreground placeholder:text-subtle focus-visible:outline-none', !docked && 'sm:text-[18px]')} />
          {ghostQuery && (
            <>
              <span id="ask-ghost-hint" className="sr-only">Press Tab to insert the suggested example question.</span>
              <div aria-hidden="true" data-testid="composer-ghost" className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 truncate text-[16px] text-subtle transition-opacity duration-300 motion-reduce:transition-none', docked ? 'left-4 right-12 sm:right-28' : 'left-6 right-14 sm:right-32 sm:text-[18px]')} style={{ opacity: ghostShown ? 1 : 0 }}>
                {typed}<span className={cn('ml-px inline-block h-[1.1em] w-px translate-y-[3px] bg-subtle align-baseline', reduceMotion || typed.length >= ghostQuery.length ? 'opacity-0' : 'hcdp-caret')} />
              </div>
            </>
          )}
          {ghostQuery && focused && <kbd className="mr-2 hidden shrink-0 rounded-md border border-border bg-surface px-1.5 py-px font-mono text-[11px] text-foreground sm:inline-block" data-testid="ask-tab-hint">Tab ↹</kbd>}
          <button type="submit" disabled={!text.trim() || busy || travelling} aria-label="Send" className={cn('grid shrink-0 place-items-center rounded-full bg-accent text-accent-foreground disabled:opacity-40', docked ? 'h-9 w-9' : 'h-10 w-10')}><ArrowUp className="h-4 w-4" /></button>
        </div>
      </div>
    </form>
  )
}

/**
 * The conversation: questions and plain answers (`hideUser` leaves the questions out — on the landing
 * page the question is already in the bar). `compact` is the docked bar's dropdown.
 */
export function Conversation({ compact = false, hideUser = false, className }) {
  const { messages, busy } = useAssistant()
  const listRef = useRef(null)
  const firstRender = useRef(true)
  useEffect(() => { if (firstRender.current) { firstRender.current = false; return } const el = listRef.current; if (el) el.scrollTop = el.scrollHeight }, [messages, busy])
  return (
    <div ref={listRef} className={cn('space-y-3 overflow-y-auto', compact ? 'px-1 py-1.5 text-[13px]' : 'max-h-[42vh] px-1 py-2', className)} aria-live="polite" data-testid="conversation">
      {messages.map((m, i) => (i === 0 || (hideUser && m.role === 'user') ? null : (
        <div key={m.id ?? i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')} data-testid={m.role === 'user' ? 'user-bubble' : 'assistant-bubble'}>
          <div className={cn('max-w-[92%] rounded-lg px-3 py-2 text-sm leading-relaxed', m.role === 'user' ? 'bg-accent text-accent-foreground' : 'bg-surface border border-border')}>
            {m.intent === 'analysis' ? <HandoffReply m={m} /> : m.content}
            {m.role === 'user' && <button type="button" title="Copy a link that asks this" aria-label="Copy a link that asks this" onClick={(ev) => { const href = `${window.location.origin}/?ask=${encodeURIComponent(m.content)}`; const b = ev.currentTarget; navigator.clipboard?.writeText(href).then(() => { b.dataset.copied = '1'; setTimeout(() => { delete b.dataset.copied }, 1500) }).catch(() => window.prompt('Copy this link', href)) }} className="group ml-1 inline-grid h-6 w-6 place-items-center rounded align-middle text-accent-foreground/70 hover:bg-white/10 hover:text-accent-foreground data-[copied]:text-accent-foreground"><Link2 className="h-3.5 w-3.5 group-data-[copied]:hidden" aria-hidden="true" /><span className="hidden text-[10px] group-data-[copied]:inline">Copied</span></button>}
            {m.actions?.filter((a) => a.type === 'open').map((a, j) => (
              <div key={j} className="mt-2"><a className="inline-flex items-center gap-1 rounded-md border border-border bg-canvas px-2.5 py-1 text-xs font-medium hover:border-foreground" href={a.url} target="_blank" rel="noopener noreferrer">{a.blocked ? 'Your browser blocked the new tab — open it here' : 'Opened in a new tab — open again'} <ExternalLink className="h-3 w-3" aria-hidden="true" /></a></div>
            ))}
            {m.alternatives?.length > 0 && !compact && <div className="mt-2 space-y-1">{m.alternatives.map((a, j) => <Alternative key={j} a={a} />)}</div>}
            {m.alternatives?.length > 0 && compact && <div className="mt-1.5 text-xs text-subtle">Also: {m.alternatives.slice(0, 3).map((a, j) => <span key={j}>{j > 0 && ' · '}{a.url?.startsWith('/') ? <Link to={a.url} className="underline underline-offset-2 hover:text-foreground">{a.title}</Link> : <a href={a.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">{a.title}</a>}</span>)}</div>}
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
  const { messages, busy } = useAssistant()
  return (
    <div className="flex flex-col" data-testid="assistant-panel">
      <AskBar glass={glass} />
      {(messages.length > 1 || busy) && (
        <div className="mt-3 rounded-xl border border-border bg-card/90 p-2 shadow-lg backdrop-blur" data-testid="landing-answers">
          <Conversation hideUser />
        </div>
      )}
    </div>
  )
}
