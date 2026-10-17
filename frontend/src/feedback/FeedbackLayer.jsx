import { useEffect, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { useFeedback } from './FeedbackProvider'
import { useNarrow } from './useNarrow'
import FeedbackPanel from './FeedbackPanel'
import SelectionPill from './SelectionPill'
import { HIGHLIGHT_NAME } from './highlight'
import { useShellMode } from '../components/shellMode'

// Everything the review-period feedback puts over the page (App.jsx mounts it once, inside FeedbackProvider): the
// bottom-left "Give feedback" pill, the selection pill, the panel (composer / My feedback / Others) and the toast.

// Where content runs to the screen's edge (phones, tablets, touch screens) a fixed edge tab sits on whatever is there —
// the 👍 / 👎 at the end of an overview row included — so there it tucks away while the page scrolls down and comes back
// on the way up and near the top (the usual mobile header manner). Wide desktops keep it in place.
export const TUCK_QUERY = '(max-width: 1023px), (pointer: coarse)'
export const TUCK_PX = 24

/** True while the page is scrolling down (past the first 80 px) on a narrow or touch screen. */
export function useTucked() {
  const tuckable = useNarrow(TUCK_QUERY)
  const [tucked, setTucked] = useState(false)
  useEffect(() => {
    if (!tuckable) { setTucked(false); return undefined }
    let anchor = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      if (y <= 80) { setTucked(false); anchor = y; return }
      if (y - anchor > TUCK_PX) { setTucked(true); anchor = y } else if (anchor - y > TUCK_PX) { setTucked(false); anchor = y }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [tuckable])
  return [tucked, setTucked]
}

/** F1 A (c), moved 15 Oct at the user's request: a small horizontal pill at the page's bottom-left corner (it was a
 *  vertical 44 px tab on the right edge; the user then asked for a third of the size: 12 px type (the M6 A floor), 24 px tall, an invisible
 *  8 px halo keeps it easy to hit; on phones (below md) it is a 36 px round icon with the words for screen readers only, so it
 *  no longer covers the stacked sidebar buttons' labels, seen in the user's 17 Oct screenshot) — the portal's chip style (white, a 1 px border), on every page, the landing
 *  included; hidden in print, on the full-screen map shells (the mini Ask AI box owns that corner) and (invisibly kept)
 *  while the panel is open. On narrow and touch screens it slides down out of the way while the page scrolls down. */
export function FeedbackTab() {
  const fb = useFeedback()
  const [tucked, setTucked] = useTucked()
  const shell = useShellMode()
  const open = !!fb.panel   // kept in the page (invisible) while the panel is open, so the focus can come back to it
  if (shell === 'phone-map' || shell === 'map-full') return null
  return (
    <button type="button" onClick={() => fb.openPanel('compose')} onFocus={() => setTucked(false)} aria-haspopup="dialog" aria-expanded={open} aria-hidden={open || undefined} tabIndex={open ? -1 : undefined}
      data-testid="feedback-tab" data-feedback-ui="" data-open={open ? 'true' : 'false'} data-tucked={tucked ? 'true' : 'false'}
      className={`fixed bottom-3 left-3 z-40 inline-flex min-h-6 items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[12px] font-medium leading-none text-foreground shadow-sm transition-[transform,border-color] duration-200 after:absolute after:-inset-2 after:content-[''] hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none print:hidden max-md:h-9 max-md:w-9 max-md:justify-center max-md:px-0 max-md:py-0 ${open ? 'invisible' : ''} ${tucked && !open ? 'translate-y-[calc(100%+1.5rem)]' : ''}`}>
      <MessageSquarePlus className="h-3 w-3 shrink-0 max-md:h-4 max-md:w-4" aria-hidden="true" />
      <span className="whitespace-nowrap max-md:sr-only">Give feedback</span>
    </button>
  )
}

/** "Thanks" and friends: one line under the sticky header, centred; a live region, so it is read out too. */
export function FeedbackToast() {
  const fb = useFeedback()
  const t = fb.toast
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 z-[1300] flex justify-center px-4 print:hidden" style={{ top: 'calc(var(--hcdp-sticky-h, 7rem) + 12px)' }} data-feedback-ui="">
      {t && (
        <div key={t.id} data-testid="feedback-toast" data-tone={t.tone}
          className={`pointer-events-auto inline-flex max-w-full items-center gap-3 rounded-full px-4 py-2 text-[13px] shadow-lg animate-fade-in ${t.tone === 'error' ? 'bg-destructive text-destructive-foreground' : 'bg-foreground text-canvas'}`}>
          <span className="min-w-0">{t.text}</span>
          {t.action && (
            <button type="button" onClick={() => { fb.dismissToast(); t.action.run() }} className="shrink-0 font-medium underline underline-offset-2 [@media(pointer:coarse)]:min-h-11" data-testid="feedback-toast-action">{t.action.label}</button>
          )}
        </div>
      )}
    </div>
  )
}

export default function FeedbackLayer() {
  return (
    <>
      {/* the passage a reviewer is writing about, and the spot "My feedback" leads back to (CSS Custom Highlight API) */}
      <style>{`::highlight(${HIGHLIGHT_NAME}) { background-color: rgb(232 184 75 / 0.45); color: inherit; }`}</style>
      <FeedbackTab />
      <SelectionPill />
      <FeedbackPanel />
      <FeedbackToast />
    </>
  )
}
