import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUp, ExternalLink, Link2, Sparkles } from 'lucide-react'
import { useAssistant } from './AssistantProvider'
import { cn } from '../lib/utils'

const AI_INTERFACE = import.meta.env.VITE_AI_INTERFACE_URL || 'https://hcdp-ai-interface.cis251375.projects.jetstream-cloud.org'

export const EXAMPLES = [
  'I need to download rainfall data from Hurricane Lowell',
  'Show me the drought map for August 2026',
  'Is it raining in Hilo right now?',
  'How do I cite the daily rainfall maps?',
  'Where is the Tropical Storm Nolo tracker?',
  'Which stations are on Kauaʻi?',
  'Rainfall map for Maui on 14 March 2026',
  'How do I get station data through the API?',
  'What was last month like across the islands?',
  'Take me to the American Samoa portal',
]

function Alternative({ a }) {
  const internal = a.url && a.url.startsWith('/')
  const inner = <><span className="font-medium">{a.title}</span>{a.why && <span className="text-subtle"> · {a.why}</span>}{!internal && <ExternalLink className="ml-1 inline h-3 w-3 text-subtle" aria-hidden="true" />}</>
  return internal ? <Link to={a.url} className="block rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs hover:border-foreground">{inner}</Link>
    : <a href={a.url} target="_blank" rel="noopener noreferrer" className="block rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs hover:border-foreground">{inner}</a>
}

// The chat itself. `compact` is the dock panel; otherwise the landing box.
export default function AssistantPanel({ compact = false, autoFocus = false, rotateExamples = false }) {
  const { messages, busy, send } = useAssistant()
  const [text, setText] = useState('')
  // The whispering composer, as in the AI interface: while the box is empty and idle the
  // input itself cycles real example asks as ghost text (fade out, swap, fade in) every
  // 2.5 s; Tab drops the current one into the box. Any typed character silences it.
  const ghostActive = rotateExamples && !text && !busy && messages.length <= 1
  const [ghostIdx, setGhostIdx] = useState(0)
  const [ghostShown, setGhostShown] = useState(true)
  useEffect(() => {
    if (!ghostActive) return undefined
    const spin = setInterval(() => {
      setGhostShown(false)
      setTimeout(() => { setGhostIdx((i) => i + 1); setGhostShown(true) }, 400)
    }, 2500)
    return () => clearInterval(spin)
  }, [ghostActive])
  const ghostQuery = ghostActive ? EXAMPLES[ghostIdx % EXAMPLES.length] : null
  const endRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const firstRender = useRef(true)
  useEffect(() => { if (firstRender.current) { firstRender.current = false; return } const el = listRef.current; if (el) el.scrollTop = el.scrollHeight }, [messages, busy])
  useEffect(() => { if (autoFocus) inputRef.current?.focus() }, [autoFocus])
  const submit = (e) => { e?.preventDefault(); const t = text; setText(''); send(t) }
  const showExamples = messages.length <= 1 && !compact && !rotateExamples
  return (
    <div className={cn('flex flex-col', compact ? 'h-full' : '')} data-testid="assistant-panel">
      <div ref={listRef} className={cn('flex-1 space-y-3 overflow-y-auto', compact ? 'px-3 py-2.5 text-[13px]' : 'max-h-[42vh] px-1', rotateExamples && messages.length <= 1 ? 'py-0' : 'py-2')} aria-live="polite">
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
      {showExamples && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2" data-testid="assistant-examples">
          {EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => send(ex)} className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-subtle hover:border-foreground hover:text-foreground">{ex}</button>)}
        </div>
      )}
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
    </div>
  )
}
