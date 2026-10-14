import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import { useAssistant, prefersReducedMotion, WELCOME_TEXT } from './AssistantProvider'
import { AskBar, CHIPS, Conversation } from './AssistantPanel'
import { useNarrowScreen } from '../viewer/useMediaQuery'
import { useOverlayHistory, useScrollLock, useVisualViewport } from '../components/overlayHistory'
import { ASK_SHEET, clearSheetOrigin, sheetOrigin, takeFocusOnOpen } from './askSheetState'
import { cn } from '../lib/utils'

// M2 A (14 Oct): below 768 px the assistant opens as a full-width bottom sheet, two-thirds of the screen high — the
// welcome line; the four template chips (or, where the address has follow-up asks, those as chips); the conversation
// (the latest reply only, never the history); the staged wait line while the AI works; and the question box pinned to
// the sheet's bottom, which rides above the on-screen keyboard (visualViewport: iOS overlays the page with the keyboard
// and leaves the layout viewport alone). A scrim holds the page still; tapping the scrim, the ✕, dragging the handle
// down, Esc, or the phone's Back gesture closes it — with the goo, the sheet melting into where it came from (the viewer's
// Ask AI pill, else the bottom edge). It owns one history entry (overlayHistory.js); an answer that navigates replaces
// that entry, so Back from the destination does not reopen it. The docked bar opens it on phones (a tap on the field);
// the viewer's floating bar opens it with its Ask AI pill. Never on wider screens: there the docked bar's dropdown is it.
export { ASK_SHEET }
export const GOO_MS = 480
const DRAG_CLOSE_PX = 80

export default function AskSheet() {
  const phone = useNarrowScreen()
  const sheet = useOverlayHistory(ASK_SHEET)
  const { messages, wait, mode, setMode, reset, epoch, followupsFor, send, pickChip, busy, travelling } = useAssistant()
  const { pathname, search } = useLocation()
  const open = phone && sheet.isOpen
  const [closing, setClosing] = useState(false)
  const wasOpen = useRef(false)
  const panelRef = useRef(null)
  const [drag, setDrag] = useState(0)
  const gesture = useRef(null)
  const vp = useVisualViewport(open)
  useScrollLock(open)

  // The goo plays on every way out (✕, scrim, handle, Esc, Back, a navigation). The render right after the close already
  // draws the melting sheet (wasOpen is still set), so there is no frame without it.
  const closingNow = !open && (closing || wasOpen.current)
  useEffect(() => {
    if (open) { wasOpen.current = true; setClosing(false); return undefined }
    if (!wasOpen.current) return undefined
    wasOpen.current = false
    if (prefersReducedMotion()) return undefined
    setClosing(true)
    const t = setTimeout(() => { setClosing(false); clearSheetOrigin() }, GOO_MS)
    return () => clearTimeout(t)
  }, [open])
  // A reply with nowhere to go (info, clarify, the hand-off) opens the docked bar's dropdown on wide screens; on a phone
  // it opens this sheet. Closing the sheet hands the assistant back to the docked state.
  useEffect(() => { if (phone && mode === 'panel' && !sheet.isOpen) sheet.open() }, [phone, mode]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (phone && !sheet.isOpen && mode === 'panel') setMode('dock') }, [sheet.isOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  // The field takes the focus when the sheet was opened from a text field (the keyboard is already up, primed by the tap).
  useEffect(() => {
    if (!open || !takeFocusOnOpen()) return undefined
    const t = setTimeout(() => panelRef.current?.querySelector('[data-testid="assistant-input"]')?.focus({ preventScroll: true }), 30)
    return () => clearTimeout(t)
  }, [open])
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) sheet.close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, sheet])

  if (!phone || (!open && !closingNow)) return null
  const innerH = typeof window !== 'undefined' ? window.innerHeight || 768 : 768
  // two-thirds of the screen; with the keyboard up, whatever the visual viewport leaves (less a sliver of page above)
  const height = Math.min(Math.round(innerH * (2 / 3)), Math.max(220, vp.height - 24))
  const followups = (followupsFor(pathname, search) || []).slice(0, 3)
  const hasReply = messages.some((m) => m.role === 'assistant' && m.id !== 0)
  const from = sheetOrigin()
  const origin = from ? `${Math.round(from.x)}px ${Math.max(0, Math.round(from.y - (innerH - vp.inset - height)))}px` : '50% 100%'
  const onDown = (e) => { if (e.button != null && e.button !== 0) return; gesture.current = { y: e.clientY }; e.currentTarget.setPointerCapture?.(e.pointerId) }
  const onMove = (e) => { if (gesture.current) setDrag(Math.max(0, e.clientY - gesture.current.y)) }
  const onUp = (e) => {
    const g = gesture.current
    gesture.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (!g) return
    const dy = Math.max(0, e.clientY - g.y)
    setDrag(0)
    if (dy > DRAG_CLOSE_PX) sheet.close()
  }
  return (
    <>
      <div aria-hidden="true" data-testid="ask-sheet-scrim" onClick={sheet.close}
        className={cn('fixed inset-0 z-[70] bg-black/35 transition-opacity duration-300', closingNow ? 'pointer-events-none opacity-0' : 'hcdp-scrim-in')} />
      <div className={cn('fixed inset-x-0 z-[71]', closingNow && 'hcdp-goo-wrap')} style={{ bottom: vp.inset }}>
        <section ref={panelRef} role="dialog" aria-modal="true" aria-label="Ask AI" data-testid="ask-sheet" data-closing={closingNow ? 'true' : undefined}
          className={cn('relative flex flex-col overflow-hidden rounded-t-2xl border-t border-border bg-card text-card-foreground shadow-[0_-6px_24px_rgba(0,0,0,0.18)]', closingNow ? 'hcdp-goo-close' : (drag ? '' : 'hcdp-sheet-in'))}
          style={{ height, transformOrigin: origin, transform: drag ? `translateY(${drag}px)` : undefined }}>
          <button type="button" aria-label="Close Ask AI" data-testid="ask-sheet-handle" onClick={() => { if (!drag) sheet.close() }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { gesture.current = null; setDrag(0) }}
            className="-mb-2.5 block w-full shrink-0 touch-none py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="mx-auto block h-1 w-10 rounded-full bg-border-strong" aria-hidden="true" />
          </button>
          <div className="flex shrink-0 items-center justify-between px-4">
            <h2 className="font-sans text-[16px] font-semibold">Ask AI</h2>
            <div className="flex items-center">
              {hasReply && <button type="button" onClick={reset} className="h-11 rounded-md px-3 text-[14px] text-subtle hover:bg-muted hover:text-foreground" data-testid="ask-sheet-reset">Start over</button>}
              <button type="button" onClick={sheet.close} aria-label="Close" data-testid="ask-sheet-close" className="grid h-11 w-11 place-items-center rounded-md text-subtle hover:bg-muted hover:text-foreground">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
          {/* the body scrolls; its bottom padding keeps the last line clear of the pinned question box */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[5.5rem] pt-1" data-testid="ask-sheet-body">
            <p className="text-[15px] leading-relaxed text-foreground/90" data-testid="ask-sheet-welcome">{WELCOME_TEXT}</p>
            <ul role="list" aria-label={followups.length ? 'Follow-up questions' : 'Quick starts'} className="mt-3 flex flex-wrap gap-2" data-testid="ask-sheet-chips" data-pool={followups.length ? 'followups' : 'templates'}>
              {followups.length
                ? followups.map((f) => (
                  <li key={f} className="max-w-full">
                    <button type="button" disabled={busy || travelling} onClick={() => send(f, { docked: true })} data-testid="ask-sheet-chip"
                      className="min-h-11 max-w-full rounded-full border border-border bg-card px-4 py-2 text-left text-[14px] leading-snug text-foreground shadow-sm hover:border-foreground disabled:opacity-50">{f}</button>
                  </li>
                ))
                : CHIPS.map((c) => (
                  <li key={c.label}>
                    <button type="button" onClick={() => pickChip(c, 'sheet')} data-testid="ask-sheet-chip"
                      className="inline-flex h-11 items-center rounded-full border border-border bg-card px-4 text-[14px] font-medium text-foreground shadow-sm hover:border-foreground">{c.label}</button>
                  </li>
                ))}
            </ul>
            {hasReply && <Conversation compact latestOnly className="mt-3 text-[15px]" />}
            {wait && (
              <p role="status" aria-live="polite" className="mt-3 flex items-center gap-2 text-[15px] text-foreground/85" data-testid="ask-sheet-working">
                <span className="hcdp-comet-ring hcdp-comet-ring-sm" aria-hidden="true" /><span key={wait} className="hcdp-status-in">{wait}</span>
              </p>
            )}
          </div>
          <div className="absolute inset-x-0 bottom-0 border-t border-border bg-card px-3 pb-3 pt-2" data-testid="ask-sheet-box">
            <AskBar key={epoch} docked inSheet />
          </div>
        </section>
      </div>
    </>
  )
}
