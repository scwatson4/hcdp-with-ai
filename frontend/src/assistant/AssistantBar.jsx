import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ExternalLink, X } from 'lucide-react'
import { isViewerPage, useAssistant } from './AssistantProvider'
import { AskBar, Conversation } from './AssistantPanel'
import ChatHistory, { CHAT_SCROLL } from './ChatHistory'
import { useNarrowScreen } from '../viewer/useMediaQuery'
import { cn } from '../lib/utils'

// R1 pick D (2026-10-08): on every inner page the ask bar is docked directly under the header as a
// full-width row (the sticky block is header + bar, nothing more) — the site-wide way to keep
// navigating, with the same conversation. Under it, as overlays that never grow the header:
//   • the reply strip — after a navigation, one line with the AI's reply and "Also: a · b" for five
//     seconds (hover/focus holds it; clicking it opens the dropdown);
//   • the dropdown — the conversation (questions and plain answers, about twenty lines, scrolling),
//     opened by focusing the bar (once a conversation exists) or clicking the strip, closed by Esc,
//     a click outside, or the next navigation;
//   • the wait line (13 Oct) — while the AI works, the same comet ring and line as under the landing
//     bar, staged by the provider (R6 C: "Thinking…", "Finding the right page…", "Opening {title} in a
//     new tab…"): small, centred, no background; each change fades in. After a navigation the
//     destination's AI summary explains the answer (AISummary.jsx); the strip shows only when no
//     summary came.
// Not on the landing page (there the hero bar is the assistant) — except invisibly during the
// ride-up, so the travelling bar has a rectangle to arrive at.
// M2 A (14 Oct): below 768 px there is no dropdown — a tap on the bar opens the Ask AI sheet (AskSheet.jsx), and a reply
// with nowhere to go opens the sheet too.
// 18 Oct: on the viewer's pages (Visualize Data) the dropdown is the Ask AI popup that holds the answers and their AI
// overviews: it shows the visit's conversation (ChatHistory.jsx), opens when the bar takes the focus with a conversation
// kept, opens with a question sent from the bar, and stays open when the answer opens another map.
export default function AssistantBar() {
  const { mode, setMode, minimize, reset, travel, strip, epoch, holdStrip, releaseStrip, hideStrip, heroOut, wait, log } = useAssistant()
  const working = wait != null
  const { pathname } = useLocation()
  const onLanding = pathname === '/' && !heroOut   // L4 E: once the hero has scrolled away the bar docks here too
  const measuring = onLanding && travel.phase === 'travel'
  const rootRef = useRef(null)
  const phone = useNarrowScreen()
  const open = mode === 'panel' && !measuring && !phone
  const history = isViewerPage(pathname) && log.length > 0   // the viewer's popup keeps the conversation (18 Oct)
  const openHistory = () => { if (history && !phone && mode === 'dock') setMode('panel') }

  // A click anywhere outside the bar and its dropdown closes the dropdown.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setMode('dock') }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open, setMode])

  if (onLanding && !measuring) return null
  const alt = (a, j) => (
    <span key={j}>{j > 0 && ' · '}{a.url?.startsWith('/')
      ? <Link to={a.url} className="underline underline-offset-2 hover:text-foreground">{a.title}</Link>
      : <a href={a.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">{a.title}<ExternalLink className="ml-0.5 inline h-3 w-3" aria-label="opens in a new tab" /></a>}</span>
  )
  return (
    <div ref={rootRef} data-testid="assistant-bar" aria-hidden={measuring || undefined}
      className={cn('border-b border-border bg-canvas/95 backdrop-blur', measuring ? 'invisible absolute inset-x-0 top-full' : 'relative')}>
      <div className="mx-auto flex h-14 w-full max-w-[720px] items-center px-4">
        <div className="w-full" onFocus={openHistory}><AskBar key={epoch} docked /></div>
      </div>
      {working && !open && !measuring && (
        <div role="status" aria-live="polite" data-testid="docked-working" className="pointer-events-none absolute inset-x-0 top-full z-10 flex items-center justify-center gap-2 px-4 pt-1.5 text-center text-[13px] text-foreground/85">
          <span className="hcdp-comet-ring hcdp-comet-ring-sm" aria-hidden="true" />
          <span key={wait} className="hcdp-status-in" data-testid="docked-status">{wait}</span>
        </div>
      )}
      {strip && !open && !measuring && !working && (
        <div role="status" data-testid="reply-strip" onMouseEnter={holdStrip} onMouseLeave={releaseStrip} onFocus={holdStrip} onBlur={releaseStrip}
          className="absolute inset-x-0 top-full z-10 border-b border-border bg-surface/95 shadow-md backdrop-blur">
          <div className="mx-auto flex w-full max-w-[720px] items-center gap-2 px-4 py-1 text-[13px]">
            <button type="button" onClick={() => { hideStrip(); setMode('panel') }} className="min-w-0 flex-1 truncate rounded text-left hover:underline [@media(pointer:coarse)]:min-h-11" data-testid="reply-strip-text" title="Show the conversation">{strip.reply}</button>
            {strip.alternatives?.length > 0 && <span className="hidden shrink-0 text-xs text-subtle sm:inline" data-testid="reply-strip-also">Also: {strip.alternatives.map(alt)}</span>}
            <button type="button" onClick={hideStrip} aria-label="Dismiss" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-subtle hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </div>
        </div>
      )}
      {open && (
        <div role="dialog" aria-label="Ask AI" data-testid="assistant-dropdown" className="absolute inset-x-0 top-full z-10 border-b border-border bg-card shadow-2xl">
          <div className="mx-auto w-full max-w-[720px] px-4 py-2">
            <div className="flex items-center justify-between pb-1">
              <span className="text-sm font-medium">Ask AI</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={reset} className="rounded px-2 py-1 text-xs text-subtle hover:bg-muted hover:text-foreground [@media(pointer:coarse)]:min-h-11" data-testid="assistant-reset">Start over</button>
                <button type="button" aria-label="Close (Esc)" onClick={minimize} className="grid h-8 w-8 place-items-center rounded text-subtle hover:bg-muted hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" data-testid="assistant-close"><X className="h-4 w-4" /></button>
              </div>
            </div>
            {history
              ? <div className="max-h-[min(70vh,34rem)] overflow-y-auto overscroll-contain px-1 py-1.5" {...{ [CHAT_SCROLL]: '' }} data-testid="dropdown-history"><ChatHistory /></div>
              : <Conversation compact latestOnly className="max-h-[min(60vh,26rem)]" />}
          </div>
        </div>
      )}
    </div>
  )
}
