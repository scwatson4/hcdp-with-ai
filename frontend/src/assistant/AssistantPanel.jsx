import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUp, ExternalLink, Sparkles } from 'lucide-react'
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
]

function Alternative({ a }) {
  const internal = a.url && a.url.startsWith('/')
  const inner = <><span className="font-medium">{a.title}</span>{a.why && <span className="text-subtle"> · {a.why}</span>}{!internal && <ExternalLink className="ml-1 inline h-3 w-3 text-subtle" aria-hidden="true" />}</>
  return internal ? <Link to={a.url} className="block rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs hover:border-foreground">{inner}</Link>
    : <a href={a.url} target="_blank" rel="noopener noreferrer" className="block rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs hover:border-foreground">{inner}</a>
}

// The chat itself. `compact` is the dock panel; otherwise the landing box.
export default function AssistantPanel({ compact = false, autoFocus = false }) {
  const { messages, busy, send } = useAssistant()
  const [text, setText] = useState('')
  const endRef = useRef(null)
  const inputRef = useRef(null)
  const firstRender = useRef(true)
  useEffect(() => { if (firstRender.current) { firstRender.current = false; return } endRef.current?.scrollIntoView?.({ block: 'nearest' }) }, [messages, busy])
  useEffect(() => { if (autoFocus) inputRef.current?.focus() }, [autoFocus])
  const submit = (e) => { e?.preventDefault(); const t = text; setText(''); send(t) }
  const showExamples = messages.length <= 1 && !compact
  return (
    <div className={cn('flex flex-col', compact ? 'h-full' : '')} data-testid="assistant-panel">
      <div className={cn('flex-1 space-y-3 overflow-y-auto', compact ? 'px-3 py-3' : 'max-h-[42vh] px-1 py-2')} aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[92%] rounded-lg px-3 py-2 text-sm leading-relaxed', m.role === 'user' ? 'bg-accent text-accent-foreground' : 'bg-surface border border-border')}>
              {m.content}
              {m.actions?.filter((a) => a.type === 'open').map((a, j) => (
                <div key={j} className="mt-2"><a className="inline-flex items-center gap-1 rounded-md border border-border bg-canvas px-2.5 py-1 text-xs font-medium hover:border-foreground" href={a.url} target="_blank" rel="noopener noreferrer">{a.blocked ? 'Your browser blocked the new tab — open it here' : 'Opened in a new tab — open again'} <ExternalLink className="h-3 w-3" aria-hidden="true" /></a></div>
              ))}
              {m.intent === 'analysis' && <div className="mt-2"><a className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground" href={m.actions?.find((a) => a.type === 'handoff')?.url || AI_INTERFACE} target="_blank" rel="noopener noreferrer"><Sparkles className="h-3 w-3" aria-hidden="true" /> Open the analysis AI</a></div>}
              {m.alternatives?.length > 0 && <div className="mt-2 space-y-1">{m.alternatives.map((a, j) => <Alternative key={j} a={a} />)}</div>}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-subtle" data-testid="assistant-busy">Looking…</div>}
        <div ref={endRef} />
      </div>
      {showExamples && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2" data-testid="assistant-examples">
          {EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => send(ex)} className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-subtle hover:border-foreground hover:text-foreground">{ex}</button>)}
        </div>
      )}
      <form onSubmit={submit} className={cn('flex items-end gap-2 border-t border-border', compact ? 'p-2' : 'p-2')}>
        <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} rows={compact ? 1 : 2}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e) }}
          placeholder={compact ? 'Ask for another page or map…' : 'What are you looking for? Ask me what I can do.  (press / anywhere)'}
          aria-label="Ask the HCDP navigator" data-testid="assistant-input"
          className="min-h-[38px] flex-1 resize-none rounded-md border border-border bg-canvas px-3 py-2 text-[16px] sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <button type="submit" disabled={!text.trim() || busy} aria-label="Send" className="grid h-9 w-9 place-items-center rounded-full bg-accent text-accent-foreground disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>
      </form>
    </div>
  )
}
