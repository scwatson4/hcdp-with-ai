// A bottom sheet for phone-width pages: a fixed panel along the bottom edge with a grab handle, a title line and tabs.
// Two ways to use it:
//   • resting (no `onClose`): it always shows and rests at one of three heights — peek (handle, title and tabs), half
//     the screen, or nearly all of it; drag the handle to move between them, or tap it to go to the next one;
//   • closable (`open` + `onClose`, M1 C, 14 Oct — the phone viewer's Controls): it opens at half the screen (or as
//     asked), a tap on the handle toggles half ↔ full, a drag settles on the nearest of closed / half / full, and a 44 px
//     ✕ closes it; the page owns its open state (a history entry, so Back closes it).
// There is no backdrop: whatever is above the sheet (the viewer's map) stays usable. The tabs are 44 px. With
// prefers-reduced-motion the height changes without a slide.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { cn } from '../lib/utils'
import { useReducedMotion } from '../viewer/useMediaQuery'

export const SNAPS = ['peek', 'half', 'full']
const PEEK_FALLBACK = 124 // px, until the header has been measured
const TOP_GAP = 64 // px left above a full sheet

const viewportHeight = () => (typeof window !== 'undefined' ? window.innerHeight || 768 : 768)

/** The three resting heights in pixels, from the measured header height. */
export function snapHeights(peek) {
  const vh = viewportHeight()
  return { peek: Math.max(peek || PEEK_FALLBACK, 72), half: Math.round(vh * 0.5), full: Math.max(Math.round(vh * 0.5) + 1, vh - TOP_GAP) }
}

/** The snap whose height is nearest to `h`. */
export function nearestSnap(h, heights, snaps = SNAPS) {
  return snaps.reduce((best, s) => (Math.abs(heights[s] - h) < Math.abs(heights[best] - h) ? s : best), snaps[0])
}

const nextSnap = (s) => SNAPS[(SNAPS.indexOf(s) + 1) % SNAPS.length]

/**
 * `tabs`: [{ id, label, content }]; `tab`/`onTabChange` and `snap`/`onSnapChange`
 * are controlled by the page (a selection on the map opens its tab).
 */
export default function BottomSheet({ title, tabs, tab, onTabChange, snap = 'peek', onSnapChange, ariaLabel = 'Map settings', className = '', open = true, onClose = null, footer = null }) {
  const closable = typeof onClose === 'function'
  const header = useRef(null)
  const [peek, setPeek] = useState(PEEK_FALLBACK)
  const [drag, setDrag] = useState(null) // px height while the handle is held
  const reduced = useReducedMotion()
  const heights = { ...snapHeights(peek), closed: 0 }
  const rest = closable ? (snap === 'full' ? 'full' : 'half') : snap

  // The peek height is the header's own height (title lines vary).
  useLayoutEffect(() => {
    const el = header.current
    if (!el) return undefined
    const measure = () => { const h = el.offsetHeight; if (h > 0) setPeek(h) }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [title, tabs.length, open])

  // Dragging the handle: the sheet follows the finger, then settles on the nearest rest.
  const gesture = useRef(null)
  const dragged = useRef(false)
  const lowest = closable ? 0 : heights.peek
  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return
    gesture.current = { y: e.clientY, from: heights[rest] }
    dragged.current = false
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    const g = gesture.current
    if (!g) return
    const dy = g.y - e.clientY
    if (Math.abs(dy) > 6) dragged.current = true
    if (dragged.current) setDrag(Math.max(lowest, Math.min(heights.full, g.from + dy)))
  }
  const onPointerUp = (e) => {
    const g = gesture.current
    gesture.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (!g || !dragged.current) return
    const h = Math.max(lowest, Math.min(heights.full, g.from + (g.y - e.clientY)))
    setDrag(null)
    const to = nearestSnap(h, heights, closable ? ['closed', 'half', 'full'] : SNAPS)
    if (to === 'closed') onClose()
    else onSnapChange?.(to)
  }
  const onPointerCancel = () => { gesture.current = null; setDrag(null) }
  // A tap (or Enter / Space on the handle) goes to the next rest; a drag's click does not.
  const onClick = () => {
    if (dragged.current) { dragged.current = false; return }
    if (closable) onSnapChange?.(rest === 'full' ? 'half' : 'full')
    else onSnapChange?.(nextSnap(snap))
  }
  useEffect(() => { setDrag(null) }, [snap, open])

  if (closable && !open) return null
  const height = drag ?? heights[rest]
  const handleLabel = closable ? `Sheet: ${rest} — tap for ${rest === 'full' ? 'half' : 'full'}, drag down to close` : `Sheet: ${snap} — tap for ${nextSnap(snap)}`
  return (
    <Tabs value={tab} onValueChange={onTabChange} asChild>
      <section
        role="region" aria-label={ariaLabel} data-testid="bottom-sheet" data-snap={rest}
        className={cn('fixed inset-x-0 bottom-0 z-[1100] flex flex-col rounded-t-xl border-t border-border bg-card text-card-foreground shadow-[0_-4px_16px_rgba(0,0,0,0.12)]', closable && !reduced && drag == null && 'hcdp-sheet-in', className)}
        style={{ height, maxHeight: '100dvh', transition: reduced || drag != null ? 'none' : 'height 220ms ease-out' }}
      >
        <div ref={header} className="relative shrink-0">
          <button
            type="button"
            className="-mb-2.5 block w-full touch-none cursor-grab py-5 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={handleLabel}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onClick={onClick}
            data-testid="sheet-handle"
          >
            <span className="mx-auto block h-1 w-10 rounded-full bg-border-strong" aria-hidden="true" />
          </button>
          <div className={cn('flex items-center gap-2 px-4', closable && 'pr-1')}>
            <h1 className="min-w-0 flex-1 truncate font-display text-base leading-tight" data-testid="viewer-heading">{title}</h1>
            {closable && (
              <button type="button" onClick={onClose} aria-label="Close the controls" data-testid="sheet-close" className="-my-2 grid h-11 w-11 shrink-0 place-items-center rounded-md text-subtle hover:bg-muted hover:text-foreground">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            )}
          </div>
          <TabsList className="mx-4 mt-2 grid h-auto w-auto grid-cols-4 p-0.5" aria-label="Sections">
            {tabs.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="h-11 font-nav text-[14px] font-semibold" data-testid={`tab-${t.id}`}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-1" style={{ touchAction: 'pan-y' }}>
          {tabs.map((t) => <TabsContent key={t.id} value={t.id} className="mt-2" data-testid={`panel-${t.id}`}>{t.content}</TabsContent>)}
          {footer}
        </div>
      </section>
    </Tabs>
  )
}
