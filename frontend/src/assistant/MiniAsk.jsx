import { useEffect, useRef, useState } from 'react'
import { Minus, X } from 'lucide-react'
import { prefersReducedMotion, useAssistant } from './AssistantProvider'
import { AskBar, HandoffReply } from './AssistantPanel'
import { cn } from '../lib/utils'

// QB-T3 B, revived for the full-screen map (14 Oct): the assistant as a MINI Ask AI box at the bottom-left — "so it does
// not cover Big Island" — about 300 px wide: the chat box at a smaller size with its quiet ghost of this map's follow-up
// asks and, under it while the AI works, the staged wait line; never the question/answer thread. A reply with nowhere to
// go shows as one short line under the box (✕ dismisses it). An answer that opens another map changes the map in place
// (the full-screen entry is kept) and its AI overview waits for the normal page. The − button, or Esc inside the box,
// folds it into an "Ask AI" pill at the bottom-left with the goo (the box melts into the pill's corner; the pill pops);
// the pill opens it again. Folded or not lasts while the map stays full screen.
export const MINI_GOO_MS = 480

export default function MiniAsk({ folded, onFold, onUnfold }) {
  const { wait, messages, mode, setMode, epoch } = useAssistant()
  const [closing, setClosing] = useState(false)
  const [popped, setPopped] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const fold = () => {
    if (closing) return
    if (prefersReducedMotion()) { onFold(); return }
    setClosing(true)
    timer.current = setTimeout(() => { setClosing(false); setPopped(true); onFold() }, MINI_GOO_MS)
  }
  // The reply that has nowhere to go (the provider's 'panel' signal), shown as one line: never a thread.
  const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.id !== 0)
  const replyLine = !wait && mode === 'panel' && last && !(last.actions || []).some((a) => a.type === 'navigate') ? last : null
  const onKeyDown = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); fold() } }

  if (folded) {
    return (
      <div className="absolute bottom-4 left-4 z-[1002]" data-testid="mini-ask" data-folded="true">
        <button type="button" onClick={() => { setPopped(false); onUnfold() }} data-testid="mini-ask-pill" aria-label="Ask AI"
          className={cn('hcdp-rainbow-border h-11 rounded-full px-5 text-[14px] font-semibold text-foreground shadow-lg hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', popped && 'hcdp-goo-pop')} style={{ transformOrigin: '0% 100%' }}>
          Ask AI
        </button>
      </div>
    )
  }
  return (
    <div className={cn('absolute bottom-4 left-4 z-[1002]', closing && 'hcdp-goo-wrap')} data-testid="mini-ask" onKeyDown={onKeyDown}>
      <section role="region" aria-label="Ask AI" data-testid="mini-ask-box" data-closing={closing ? 'true' : undefined}
        className={cn('w-[300px] max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card/95 p-2 shadow-xl backdrop-blur', closing && 'hcdp-goo-close')} style={{ transformOrigin: '0% 100%' }}>
        <div className="flex items-center justify-between pb-1 pl-2">
          <span className="text-[13px] font-medium text-foreground">Ask AI</span>
          <button type="button" onClick={fold} aria-label="Fold Ask AI into a pill" title="Fold (Esc)" data-testid="mini-ask-fold"
            className="grid h-8 w-8 place-items-center rounded-md text-subtle hover:bg-muted hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <AskBar key={epoch} docked mini />
        {wait && (
          <p role="status" aria-live="polite" className="mt-1.5 flex items-center gap-2 px-2 text-[13px] text-foreground/85" data-testid="mini-ask-working">
            <span className="hcdp-comet-ring hcdp-comet-ring-sm" aria-hidden="true" /><span key={wait} className="hcdp-status-in">{wait}</span>
          </p>
        )}
        {replyLine && (
          <div className="mt-1.5 flex items-start gap-1 px-2 text-[13px] leading-snug" data-testid="mini-ask-reply">
            {/* the hand-off keeps its countdown and "Stay here" (it opens a new tab by itself) */}
            {replyLine.intent === 'analysis' ? <div className="min-w-0 flex-1"><HandoffReply m={replyLine} /></div> : <p className="line-clamp-3 min-w-0 flex-1">{replyLine.content}</p>}
            <button type="button" onClick={() => setMode('dock')} aria-label="Dismiss the reply" className="-mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-subtle hover:bg-muted hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
