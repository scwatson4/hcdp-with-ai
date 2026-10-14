import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useFeedback } from './FeedbackProvider'
import { exchangeForNode } from './exchange'
import { featureForNode } from './features'
import { copyText } from './copy'

// F1 A: select text anywhere on the site and a small dark pill appears above the selection — "Copy · Give feedback"
// (the AI interface's selection toolbar). Give feedback opens the composer with the passage quoted, the feature guessed
// from where it sits (an AI overview, an AI answer, the maps viewer, a page) and, inside an answer or an overview, that
// exchange attached; the passage stays marked while the composer is open. Keyboard: after selecting (Shift + arrows,
// or caret browsing) the next Tab lands on the pill's Copy button, Tab again on Give feedback; Esc puts it away.
// Not for text in form fields, and not inside the feedback UI itself. The pill shows once the pointer is released.
export const SETTLE_MS = 120

const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

function readSelection(pathname) {
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const text = sel.toString().replace(/\s+/g, ' ').trim()
  if (!text) return null
  const range = sel.getRangeAt(0)
  const node = range.commonAncestorContainer
  const el = node?.nodeType === 1 ? node : node?.parentElement
  if (!el || el.closest(`${FIELD}, [data-feedback-ui]`)) return null
  const active = document.activeElement
  if (active && active.matches?.(FIELD)) return null
  let rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null
  if (!rect || (!rect.width && !rect.height)) rect = el.getBoundingClientRect?.() || { top: 0, bottom: 0, left: 0, width: 0 }
  return {
    text, range: range.cloneRange(), feature: featureForNode(node, pathname), exchange: exchangeForNode(range.startContainer),
    rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
  }
}

export default function SelectionPill() {
  const fb = useFeedback()
  const { pathname } = useLocation()
  const [pill, setPill] = useState(null)
  const [copied, setCopied] = useState(false)
  const ref = useRef(null)
  const dragging = useRef(false)
  const dismissed = useRef(null)   // Esc puts the pill away until the selection changes
  const timer = useRef(null)
  const pathRef = useRef(pathname)
  pathRef.current = pathname

  const update = useCallback(() => {
    if (dragging.current) return
    let next = readSelection(pathRef.current)
    if (!next) dismissed.current = null
    else if (dismissed.current === next.text) next = null
    setPill((cur) => {
      if (!next) return ref.current?.contains(document.activeElement) ? cur : null   // keep it while the keyboard is on it
      return next
    })
    if (next) setCopied(false)
  }, [])

  useEffect(() => {
    const schedule = () => { clearTimeout(timer.current); timer.current = setTimeout(update, SETTLE_MS) }
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return
      dragging.current = true
      setPill(null)
    }
    const onUp = () => { dragging.current = false; schedule() }   // pointercancel too: a long-press selection on a phone
    const onMove = () => setPill((cur) => {
      if (!cur) return cur
      const sel = window.getSelection?.()
      if (!sel || sel.rangeCount === 0) return cur
      const r = typeof sel.getRangeAt(0).getBoundingClientRect === 'function' ? sel.getRangeAt(0).getBoundingClientRect() : null
      return r && (r.width || r.height) ? { ...cur, rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width } } : cur
    })
    // Tab after a selection: into the pill (only while it shows and nothing else holds the keyboard)
    const onKey = (e) => {
      const host = ref.current
      if (!host || e.key !== 'Tab' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
      if (host.contains(document.activeElement) || document.activeElement?.matches?.(FIELD)) return
      const first = host.querySelector('button')
      if (first) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('selectionchange', schedule)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onUp, true)
    document.addEventListener('keyup', schedule)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onMove, { passive: true, capture: true })
    window.addEventListener('resize', onMove)
    return () => {
      clearTimeout(timer.current)
      document.removeEventListener('selectionchange', schedule)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('pointercancel', onUp, true)
      document.removeEventListener('keyup', schedule)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onMove, { capture: true })
      window.removeEventListener('resize', onMove)
    }
  }, [update])

  // a new page, or the feedback panel opening, puts it away
  useEffect(() => { setPill(null) }, [pathname, fb.panel])

  if (!pill) return <span className="sr-only" aria-live="polite" data-testid="selection-pill-live" />
  const vw = typeof window !== 'undefined' ? window.innerWidth || 1024 : 1024
  const sticky = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hcdp-sticky-h')) || 0
  // phones: below the selection, where the system's own selection menu is not
  const coarse = !!window.matchMedia?.('(pointer: coarse)').matches
  const above = !coarse && pill.rect.top - 44 >= sticky + 4
  const top = above ? pill.rect.top - 44 : pill.rect.bottom + 8
  const left = Math.min(Math.max(pill.rect.left + pill.rect.width / 2, 100), vw - 100)
  const give = () => {
    fb.openComposer({ kind: 'selection', quote: pill.text, feature: pill.feature, exchange: pill.exchange || undefined, range: pill.range })
    setPill(null)
    try { window.getSelection?.()?.removeAllRanges() } catch { /* the composer marks the passage itself */ }
  }
  const copy = async () => {
    const ok = await copyText(pill.text)
    setCopied(ok ? 'yes' : 'no')
    setTimeout(() => setCopied(false), 1400)
  }
  return (
    <>
      <span className="sr-only" aria-live="polite" data-testid="selection-pill-live">Text selected. Press Tab for Copy or Give feedback.</span>
      <div ref={ref} role="toolbar" aria-label="Selected text" data-testid="selection-pill" data-feedback-ui="" data-placement={above ? 'above' : 'below'}
        onPointerDown={(e) => e.preventDefault()}   // keep the page's selection while the pill is used
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismissed.current = pill.text; setPill(null) } }}
        style={{ position: 'fixed', top, left, transform: 'translateX(-50%)' }}
        className="z-[1300] flex items-stretch overflow-hidden rounded-full bg-foreground text-[12px] font-medium text-canvas shadow-xl animate-fade-in print:hidden">
        <button type="button" onClick={copy} data-testid="selection-copy"
          className="px-3 py-1.5 hover:bg-white/15 focus-visible:bg-white/20 focus-visible:outline-none [@media(pointer:coarse)]:min-h-11">
          {copied === 'yes' ? 'Copied ✓' : copied === 'no' ? 'Press Ctrl+C' : 'Copy'}
        </button>
        <span aria-hidden="true" className="my-1.5 w-px bg-canvas/30" />
        <button type="button" onClick={give} data-testid="selection-feedback"
          className="px-3 py-1.5 hover:bg-white/15 focus-visible:bg-white/20 focus-visible:outline-none [@media(pointer:coarse)]:min-h-11">Give feedback</button>
      </div>
    </>
  )
}
