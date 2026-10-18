import { useEffect, useRef, useState } from 'react'
import { Minus } from 'lucide-react'
import { prefersReducedMotion, useAssistant } from './AssistantProvider'
import { AskBar } from './AssistantPanel'
import ChatHistory, { CHAT_SCROLL } from './ChatHistory'
import { cn } from '../lib/utils'

// QB-T3 B, revived for the full-screen map (14 Oct): the assistant as a MINI Ask AI box at the bottom-left — "so it does
// not cover Big Island" — about 300 px wide: the chat box at a smaller size with its quiet ghost of this map's follow-up
// asks and, under it while the AI works, the staged wait line. An answer that opens another map changes the map in place
// (the full-screen entry is kept). The − button, or Esc inside the box, folds it into an "Ask AI" pill at the bottom-left
// with the goo (the box melts into the pill's corner; the pill pops); the pill opens it again. Folded or not lasts while
// the map stays full screen.
// 18 Oct (the user: the overview "inside the 'Ask AI' popup … that popup should keep conversation history", superseding "do
// not show the history, just show a mini version of the chat box"): above its field the box shows the visit's
// conversation (ChatHistory.jsx: each question and reply, a map's AI overview inside its reply, the follow-up chips under
// the newest), 340 px wide once there is one, scrolling inside at most 45 % of the screen; Start over clears it. The map's
// furniture rises above the box as it grows (`onHeight`).
export const MINI_GOO_MS = 480

export default function MiniAsk({ folded, onFold, onUnfold, onHeight = null }) {
  const { wait, log, reset, epoch, strip, holdStrip, releaseStrip } = useAssistant()
  const [closing, setClosing] = useState(false)
  const [popped, setPopped] = useState(false)
  const timer = useRef(null)
  const boxRef = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  // When an answer's overview cannot be written, the reply strip under the docked bar explains it instead. The docked bar
  // is hidden in full screen, so the strip waits too: held while the map stays full screen, it starts its five seconds
  // when the normal page comes back (this box goes away).
  useEffect(() => {
    if (!strip) return undefined
    holdStrip()
    return () => releaseStrip()
  }, [strip?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // the box's height, so the scale bar and the compass stay above it as the conversation grows
  useEffect(() => {
    const el = boxRef.current
    if (!el || !onHeight || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => onHeight(el.getBoundingClientRect().height))
    ro.observe(el)
    return () => { ro.disconnect(); onHeight(0) }
  }, [onHeight, folded])
  const fold = () => {
    if (closing) return
    if (prefersReducedMotion()) { onFold(); return }
    setClosing(true)
    timer.current = setTimeout(() => { setClosing(false); setPopped(true); onFold() }, MINI_GOO_MS)
  }
  const onKeyDown = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); fold() } }
  const history = log.length > 0

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
      <section ref={boxRef} role="region" aria-label="Ask AI" data-testid="mini-ask-box" data-closing={closing ? 'true' : undefined}
        className={cn(history ? 'w-[340px]' : 'w-[300px]', 'max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card/95 p-2 shadow-xl backdrop-blur', closing && 'hcdp-goo-close')} style={{ transformOrigin: '0% 100%' }}>
        <div className="flex items-center justify-between pb-1 pl-2">
          <span className="text-[13px] font-medium text-foreground">Ask AI</span>
          <div className="flex items-center">
            {history && <button type="button" onClick={reset} className="h-8 rounded-md px-2 text-[12px] text-subtle hover:bg-muted hover:text-foreground [@media(pointer:coarse)]:h-11" data-testid="mini-ask-reset">Start over</button>}
            <button type="button" onClick={fold} aria-label="Fold Ask AI into a pill" title="Fold (Esc)" data-testid="mini-ask-fold"
              className="grid h-8 w-8 place-items-center rounded-md text-subtle hover:bg-muted hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        {history && (
          <div className="mb-2 max-h-[45dvh] overflow-y-auto overscroll-contain px-1" data-testid="mini-ask-history" {...{ [CHAT_SCROLL]: '' }}>
            <ChatHistory showWait={false} />
          </div>
        )}
        <AskBar key={epoch} docked mini />
        {wait && (
          <p role="status" aria-live="polite" className="mt-1.5 flex items-center gap-2 px-2 text-[13px] text-foreground/85" data-testid="mini-ask-working">
            <span className="hcdp-comet-ring hcdp-comet-ring-sm" aria-hidden="true" /><span key={wait} className="hcdp-status-in">{wait}</span>
          </p>
        )}
      </section>
    </div>
  )
}
