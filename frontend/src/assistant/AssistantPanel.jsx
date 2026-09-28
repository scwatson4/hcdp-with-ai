import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUp, ExternalLink, Link2, Sparkles } from 'lucide-react'
import { useAssistant } from './AssistantProvider'
import { cn } from '../lib/utils'

const AI_INTERFACE = import.meta.env.VITE_AI_INTERFACE_URL || 'https://hcdp-ai-interface.cis251375.projects.jetstream-cloud.org'

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

// The chat itself. `compact` is the dock panel; otherwise the landing box.
// The chat itself. `compact` is the dock panel; `bar` is the landing search bar (R3 B):
// one 56 px pill in which each example types itself out, holds two seconds and fades.
export default function AssistantPanel({ compact = false, autoFocus = false, bar = false }) {
  const { messages, busy, send } = useAssistant()
  const [text, setText] = useState('')
  const rotateExamples = bar
  // The typewriter ghost: while the bar is empty and idle, the current example types itself
  // out at 28 ms a letter, holds 2 s (longer while the pointer rests on the bar), fades out
  // over 350 ms and the next one begins. Tab drops the whole example into the field; any typed
  // character silences it; the keycap shows only while the field has focus (that is when Tab
  // does what it says); reduced motion shows one still example.
  const ghostActive = bar && !text && !busy && messages.length <= 1
  const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [typed, setTyped] = useState(reduceMotion ? EXAMPLES[0] : '')
  const [ghostShown, setGhostShown] = useState(true)
  const [focused, setFocused] = useState(false)
  const idxRef = useRef(0)
  const hoverRef = useRef(false)
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
  const endRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const firstRender = useRef(true)
  useEffect(() => { if (firstRender.current) { firstRender.current = false; return } const el = listRef.current; if (el) el.scrollTop = el.scrollHeight }, [messages, busy])
  useEffect(() => { if (autoFocus) inputRef.current?.focus() }, [autoFocus])
  const submit = (e) => { e?.preventDefault(); const t = text; setText(''); send(t) }
  const showExamples = messages.length <= 1 && !compact && !bar
  return (
    <div className={cn('flex flex-col', compact ? 'h-full' : '')} data-testid="assistant-panel">
      {bar && (
        <form onSubmit={submit} onMouseEnter={() => { hoverRef.current = true }} onMouseLeave={() => { hoverRef.current = false }} data-testid="ask-bar">
          <div className="hcdp-ask relative flex h-14 items-center rounded-full border-[1.5px] border-border bg-canvas pl-6 pr-2 shadow-lg">
            <input ref={inputRef} type="text" value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} autoComplete="off" enterKeyHint="search"
              onKeyDown={(e) => { if (e.key === 'Enter') submit(e); else if (e.key === 'Tab' && !e.shiftKey && ghostQuery) { e.preventDefault(); setText(ghostQuery) } }}
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              aria-describedby={ghostQuery ? 'ask-ghost-hint' : undefined}
              placeholder={ghostQuery ? '' : 'What are you looking for?'}
              aria-label="Ask AI" data-testid="assistant-input"
              className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-foreground placeholder:text-subtle focus-visible:outline-none sm:text-[18px]" />
            {ghostQuery && (
              <>
                <span id="ask-ghost-hint" className="sr-only">Press Tab to insert the suggested example question.</span>
                <div aria-hidden="true" data-testid="composer-ghost" className="pointer-events-none absolute left-6 right-14 top-1/2 -translate-y-1/2 truncate text-[16px] text-subtle transition-opacity duration-300 motion-reduce:transition-none sm:right-32 sm:text-[18px]" style={{ opacity: ghostShown ? 1 : 0 }}>
                  {typed}<span className={cn('ml-px inline-block h-[1.1em] w-px translate-y-[3px] bg-subtle align-baseline', reduceMotion || typed.length >= ghostQuery.length ? 'opacity-0' : 'hcdp-caret')} />
                </div>
              </>
            )}
            {ghostQuery && focused && <kbd className="mr-2 hidden shrink-0 rounded-md border border-border bg-surface px-1.5 py-px font-mono text-[11px] text-foreground sm:inline-block" data-testid="ask-tab-hint">Tab ↹</kbd>}
            <button type="submit" disabled={!text.trim() || busy} aria-label="Send" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>
          </div>
        </form>
      )}
      {(!bar || messages.length > 1 || busy) && (
      <div className={cn(bar && 'mt-3 rounded-xl border border-border bg-card/90 p-2 shadow-lg backdrop-blur')} data-testid={bar ? 'landing-answers' : undefined}>
      <div ref={listRef} className={cn('flex-1 space-y-3 overflow-y-auto', compact ? 'px-3 py-2.5 text-[13px]' : 'max-h-[42vh] px-1 py-2')} aria-live="polite">
        {messages.map((m, i) => (i === 0 && (compact || rotateExamples) ? null : (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[92%] rounded-lg px-3 py-2 text-sm leading-relaxed', m.role === 'user' ? 'bg-accent text-accent-foreground' : 'bg-surface border border-border')}>
              {m.content}
              {m.role === 'user' && <button type="button" title="Copy a link that asks this" aria-label="Copy a link that asks this" onClick={(ev) => { const href = `${window.location.origin}/?ask=${encodeURIComponent(m.content)}`; const b = ev.currentTarget; navigator.clipboard?.writeText(href).then(() => { b.dataset.copied = '1'; setTimeout(() => { delete b.dataset.copied }, 1500) }).catch(() => window.prompt('Copy this link', href)) }} className="group ml-1 inline-grid h-6 w-6 place-items-center rounded align-middle text-accent-foreground/70 hover:bg-white/10 hover:text-accent-foreground data-[copied]:text-accent-foreground"><Link2 className="h-3.5 w-3.5 group-data-[copied]:hidden" aria-hidden="true" /><span className="hidden text-[10px] group-data-[copied]:inline">Copied</span></button>}
              {m.actions?.filter((a) => a.type === 'open').map((a, j) => (
                <div key={j} className="mt-2"><a className="inline-flex items-center gap-1 rounded-md border border-border bg-canvas px-2.5 py-1 text-xs font-medium hover:border-foreground" href={a.url} target="_blank" rel="noopener noreferrer">{a.blocked ? 'Your browser blocked the new tab — open it here' : 'Opened in a new tab — open again'} <ExternalLink className="h-3 w-3" aria-hidden="true" /></a></div>
              ))}
              {m.intent === 'analysis' && <div className="mt-2"><a className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground" href={m.actions?.find((a) => a.type === 'handoff')?.url || AI_INTERFACE} target="_blank" rel="noopener noreferrer"><Sparkles className="h-3 w-3" aria-hidden="true" /> Open the analysis AI</a></div>}
              {m.alternatives?.length > 0 && !compact && <div className="mt-2 space-y-1">{m.alternatives.map((a, j) => <Alternative key={j} a={a} />)}</div>}
              {m.alternatives?.length > 0 && compact && <div className="mt-1.5 text-xs text-subtle">Also: {m.alternatives.slice(0, 3).map((a, j) => <span key={j}>{j > 0 && ' · '}{a.url?.startsWith('/') ? <Link to={a.url} className="underline underline-offset-2 hover:text-foreground">{a.title}</Link> : <a href={a.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">{a.title}</a>}</span>)}</div>}
            </div>
          </div>
        )))}
        {busy && <div className="text-xs text-subtle" data-testid="assistant-busy">Looking…</div>}
        <div ref={endRef} />
      </div>
      </div>
      )}
      {showExamples && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2" data-testid="assistant-examples">
          {EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => send(ex)} className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-subtle hover:border-foreground hover:text-foreground">{ex}</button>)}
        </div>
      )}
      {!bar && (
      <form onSubmit={submit} className={cn('flex items-end gap-2 p-2', (compact || !rotateExamples || messages.length > 1) && 'border-t border-border')}>
        <div className="hcdp-ask relative flex flex-1 rounded-md border border-border bg-canvas">
        <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} rows={compact ? 1 : 2}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); else if (e.key === 'Tab' && !e.shiftKey && ghostQuery) { e.preventDefault(); setText(ghostQuery) } }}
          aria-describedby={ghostQuery ? 'ask-ghost-hint' : undefined}
          placeholder={compact ? 'Ask for another page or map…' : 'What are you looking for?'}
          aria-label="Ask AI" data-testid="assistant-input"
          className={cn('min-h-[38px] flex-1 resize-none rounded-md bg-transparent px-3 py-2 text-[16px] sm:text-sm focus-visible:outline-none', ghostQuery ? 'placeholder:text-transparent' : 'placeholder:text-subtle')} />
        {ghostQuery && (
          <>
            <span id="ask-ghost-hint" className="sr-only">Press Tab to insert the suggested example question.</span>
            <div aria-hidden="true" data-testid="composer-ghost" className={cn('pointer-events-none absolute left-3 right-3 top-2 flex items-center gap-2 overflow-hidden text-[16px] leading-6 text-subtle transition-opacity duration-300 motion-reduce:transition-none sm:text-sm', ghostShown ? 'opacity-100' : 'opacity-0')}>
              <kbd className="shrink-0 rounded-md border border-border bg-surface px-1.5 py-px font-mono text-[10.5px] text-foreground">Tab</kbd>
              <span className="truncate">Try: “{ghostQuery}”</span>
            </div>
          </>
        )}
        </div>
        <button type="submit" disabled={!text.trim() || busy} aria-label="Send" className="grid h-9 w-9 place-items-center rounded-full bg-accent text-accent-foreground disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>
      </form>
      )}
    </div>
  )
}
