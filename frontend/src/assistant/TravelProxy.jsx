import { useLayoutEffect, useRef, useState } from 'react'

// R1 pick D (2026-10-08): the shared-element move. While the provider is in its 'travel' phase
// the hero bar fades with the hero and this proxy — a fixed pill drawn like the bar — rides from
// the hero bar's rectangle to the docked bar's (the header row renders it invisibly to be
// measured), with transform only, 450 ms, ease-in. Nothing to measure (no bar on the page, or a
// test environment without layout) → nothing is drawn and the provider's timer still arrives.
export const SOURCE = '[data-testid="landing-assistant"] [data-testid="ask-field"]'
export const TARGET = '[data-testid="assistant-bar"] [data-testid="ask-field"]'

export default function TravelProxy() {
  const ref = useRef(null)
  const [geom, setGeom] = useState(null)
  useLayoutEffect(() => {
    const from = document.querySelector(SOURCE)?.getBoundingClientRect()
    const to = document.querySelector(TARGET)?.getBoundingClientRect()
    if (from && to && from.width > 0 && from.height > 0 && to.width > 0 && to.height > 0) setGeom({ from, to })
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !geom) return
    const { from, to } = geom
    el.style.transform = 'translate(0px, 0px) scale(1, 1)'
    void el.offsetWidth   // flush the start state so the transition runs from it
    el.style.transition = 'transform 450ms ease-in'
    el.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`
  }, [geom])
  if (!geom) return null
  const { from } = geom
  return <div ref={ref} aria-hidden="true" data-testid="travel-proxy" className="hcdp-travel-proxy" style={{ left: from.left, top: from.top, width: from.width, height: from.height }} />
}
