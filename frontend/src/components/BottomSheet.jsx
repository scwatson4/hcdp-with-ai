// A bottom sheet for phone-width pages: a fixed panel along the bottom edge
// with a grab handle, a title line and tabs, that rests at one of three
// heights — peek (handle, title and tabs), half the screen, or nearly all
// of it. Drag the handle to move between them, or tap it to go to the next
// one. There is no backdrop: whatever is above the sheet (the viewer's map)
// stays usable. With prefers-reduced-motion the height changes without a
// slide.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
export function nearestSnap(h, heights) {
  return SNAPS.reduce((best, s) => (Math.abs(heights[s] - h) < Math.abs(heights[best] - h) ? s : best), 'peek')
}

const nextSnap = (s) => SNAPS[(SNAPS.indexOf(s) + 1) % SNAPS.length]

/**
 * `tabs`: [{ id, label, content }]; `tab`/`onTabChange` and `snap`/`onSnapChange`
 * are controlled by the page (a selection on the map opens its tab).
 */
export default function BottomSheet({ title, tabs, tab, onTabChange, snap = 'peek', onSnapChange, ariaLabel = 'Map settings', className = '' }) {
  const header = useRef(null)
  const [peek, setPeek] = useState(PEEK_FALLBACK)
  const [drag, setDrag] = useState(null) // px height while the handle is held
  const reduced = useReducedMotion()
  const heights = snapHeights(peek)

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
  }, [title, tabs.length])

  // Dragging the handle: the sheet follows the finger, then settles on the nearest rest.
  const gesture = useRef(null)
  const dragged = useRef(false)
  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return
    gesture.current = { y: e.clientY, from: heights[snap] }
    dragged.current = false
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    const g = gesture.current
    if (!g) return
    const dy = g.y - e.clientY
    if (Math.abs(dy) > 6) dragged.current = true
    if (dragged.current) setDrag(Math.max(heights.peek, Math.min(heights.full, g.from + dy)))
  }
  const onPointerUp = (e) => {
    const g = gesture.current
    gesture.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (!g || !dragged.current) return
    const h = Math.max(heights.peek, Math.min(heights.full, g.from + (g.y - e.clientY)))
    setDrag(null)
    onSnapChange?.(nearestSnap(h, heights))
  }
  const onPointerCancel = () => { gesture.current = null; setDrag(null) }
  // A tap (or Enter / Space on the handle) goes to the next rest; a drag's click does not.
  const onClick = () => {
    if (dragged.current) { dragged.current = false; return }
    onSnapChange?.(nextSnap(snap))
  }
  useEffect(() => { setDrag(null) }, [snap])

  const height = drag ?? heights[snap]
  return (
    <Tabs value={tab} onValueChange={onTabChange} asChild>
      <section
        role="region" aria-label={ariaLabel} data-testid="bottom-sheet" data-snap={snap}
        className={cn('fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-xl border-t border-border bg-card text-card-foreground shadow-[0_-4px_16px_rgba(0,0,0,0.12)]', className)}
        style={{ height, maxHeight: '100dvh', transition: reduced || drag != null ? 'none' : 'height 220ms ease-out' }}
      >
        <div ref={header} className="shrink-0">
          <button
            type="button"
            className="block w-full touch-none cursor-grab py-2.5 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Sheet: ${snap} — tap for ${nextSnap(snap)}`}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onClick={onClick}
            data-testid="sheet-handle"
          >
            <span className="mx-auto block h-1 w-10 rounded-full bg-border-strong" aria-hidden="true" />
          </button>
          <h1 className="truncate px-4 font-display text-base leading-tight" data-testid="viewer-heading">{title}</h1>
          <TabsList className="mx-4 mt-2 grid h-auto w-auto grid-cols-4 p-0.5 [@media(pointer:coarse)]:min-h-11" aria-label="Sections">
            {tabs.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="h-9 font-nav font-semibold [@media(pointer:coarse)]:h-10" data-testid={`tab-${t.id}`}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-1" style={{ touchAction: 'pan-y' }}>
          {tabs.map((t) => <TabsContent key={t.id} value={t.id} className="mt-2" data-testid={`panel-${t.id}`}>{t.content}</TabsContent>)}
        </div>
      </section>
    </Tabs>
  )
}
