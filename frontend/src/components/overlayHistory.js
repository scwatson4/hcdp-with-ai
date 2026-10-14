import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// The phone checklist (CONTRACT.md, 14 Oct): every overlay owns ONE history entry, so the phone's Back gesture (or the
// browser's Back button) closes it instead of leaving the page — the menu sheet, the Ask AI sheet, the viewer's Controls
// sheet and the full-screen map. Opening pushes the same address with the overlay's id in the router's state
// (`hcdpOverlay`); the overlay is open exactly while the current entry carries that id (Back pops the entry and it
// closes; Forward brings it back). Closing pops the entry it pushed — or, when the current entry is not that one (a viewer
// choice made inside the overlay pushed a newer entry; the page was reloaded), replaces the current entry without the id.
// Writers that move the page while an overlay is open (the viewer's controls, the assistant arriving somewhere) carry the
// state along or replace the overlay's entry, so an overlay never reopens on its own when the visitor comes Back.
export const OVERLAY = 'hcdpOverlay'

export const overlayOf = (state) => (state && typeof state === 'object' && typeof state[OVERLAY] === 'string' ? state[OVERLAY] : null)
export function withoutOverlay(state) {
  if (!state || typeof state !== 'object') return null
  const { [OVERLAY]: _drop, ...rest } = state
  return Object.keys(rest).length ? rest : null
}
/** The router's state of the current history entry, read live (BrowserRouter keeps it under `usr`); null in a
 *  MemoryRouter, where the render's location.state is the truth. */
export const liveState = () => (typeof window !== 'undefined' ? window.history.state?.usr ?? null : null)
const liveIdx = () => (typeof window !== 'undefined' ? window.history.state?.idx ?? null : null)

// overlay id → the entry this tab pushed for it: { idx (BrowserRouter's entry index; a replace keeps it), here (the address) }
const pushed = new Map()

/** `{ isOpen, open(extraState?), close() }` for one overlay. `sameAddress(openedAt, now)` decides whether the address
 *  is still the one the overlay opened on (default: identical) — the full-screen map ignores the camera, which moves by
 *  itself when the map resizes. Closing pops the overlay's entry when no entry was pushed since and the address is the
 *  same; otherwise it replaces the current entry without the overlay (a new map chosen inside stays in the history). */
export function useOverlayHistory(id, { sameAddress = null } = {}) {
  const location = useLocation()
  const navigate = useNavigate()
  const isOpen = overlayOf(location.state) === id
  const here = location.pathname + location.search + location.hash
  const stateRef = useRef(location.state)
  stateRef.current = location.state
  const open = useCallback((extra = null) => {
    const cur = liveState() ?? stateRef.current
    if (overlayOf(cur) === id) return
    navigate(here, { state: { ...(withoutOverlay(cur) || {}), ...(extra || {}), [OVERLAY]: id } })
    pushed.set(id, { idx: liveIdx(), here })
  }, [id, here, navigate])
  const close = useCallback(() => {
    const cur = liveState() ?? stateRef.current
    if (overlayOf(cur) !== id) return
    const mine = pushed.get(id)
    pushed.delete(id)
    const idx = liveIdx()
    const atPushed = Boolean(mine) && (mine.idx != null && idx != null ? mine.idx === idx : true)
    const unchanged = Boolean(mine) && (sameAddress ? sameAddress(mine.here, here) : mine.here === here)
    if (atPushed && unchanged) navigate(-1)
    else navigate(here, { replace: true, state: withoutOverlay(cur) })
  }, [id, here, navigate, sameAddress])
  return { isOpen, open, close }
}

/** On the first load an overlay's id in the history state can only come from a reload: start with it closed. */
export function useStripOverlayOnLoad() {
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const cur = liveState() ?? location.state
    if (overlayOf(cur) && !pushed.size) navigate(location.pathname + location.search + location.hash, { replace: true, state: withoutOverlay(cur) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

// ── the page under an overlay holds still ──
let locks = 0
/** While `active`, the page does not scroll (html.hcdp-scroll-lock: overflow hidden, no overscroll). Counted, so two
 *  overlays (a sheet over the full-screen map) release it only when both are gone. */
export function useScrollLock(active) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined
    locks += 1
    document.documentElement.classList.add('hcdp-scroll-lock')
    return () => {
      locks = Math.max(0, locks - 1)
      if (!locks) document.documentElement.classList.remove('hcdp-scroll-lock')
    }
  }, [active])
}

/** The keyboard: { height, inset } of the visual viewport — `inset` is how much of the layout viewport's bottom the
 *  on-screen keyboard covers (iOS Safari overlays the page and leaves window.innerHeight alone; Chrome on Android
 *  resizes the visual viewport too), so anything pinned to the bottom sits `inset` px up. 0 without visualViewport. */
export function useVisualViewport(active = true) {
  const read = () => {
    if (typeof window === 'undefined') return { height: 768, inset: 0 }
    const vv = window.visualViewport
    const h = window.innerHeight || 768
    if (!vv) return { height: h, inset: 0 }
    return { height: Math.round(vv.height), inset: Math.max(0, Math.round(h - vv.height - vv.offsetTop)) }
  }
  const [vp, setVp] = useState(read)
  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined
    const vv = window.visualViewport
    const update = () => setVp((cur) => { const next = read(); return next.height === cur.height && next.inset === cur.inset ? cur : next })
    update()
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => { vv?.removeEventListener('resize', update); vv?.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
  return vp
}

/** iOS raises the keyboard only for a focus() made inside the tap's own handler. A tap that opens a sheet whose field
 *  renders a moment later focuses a throwaway field now; the sheet's field takes the focus over once it is there (the
 *  keyboard stays up between two fields). Harmless elsewhere. */
export function primeKeyboard() {
  if (typeof document === 'undefined') return
  const el = document.createElement('input')
  el.setAttribute('aria-hidden', 'true')
  el.tabIndex = -1
  el.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;pointer-events:none'
  document.body.appendChild(el)
  try { el.focus({ preventScroll: true }) } catch { el.focus() }
  setTimeout(() => el.remove(), 1500)
}
