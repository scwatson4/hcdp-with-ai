import { useEffect, useRef, useState } from 'react'

// The landing hero's backdrop (R4 B + R7 B): HCDP's newest statewide maps rendered by
// /api/map.webp with the ocean filled in the hero's own blue, so there is no seam; each
// arrives as a blurred 24 px preview first and sharpens when the full map lands.
// The next map fades in over the current one and the old one is then removed, so
// nothing pales mid-fade; 8 s a map. Nothing to click and nothing to cycle by hand
// (your rule, 2026-09-30): no caption, no pause, no dots, no progress line. Preloads
// every image first, pauses in a hidden tab and stops for reduced-motion users.
export const OCEAN = { light: 'bfe0f7', dark: '10263a' }   // keep in step with OCEAN_FILLS in backend/app.py
const INTERVAL_MS = 8000
const FADE_MS = 1800
const FALLBACK_AFTER_MS = 6000
// A map shipped with the site (frontend/public), shown if /api/backdrops or the renders fail (R7 B).
const FALLBACK = { dataset: 'rainfall', period: 'month', date: '2026-08', extent: 'statewide', label: 'Rainfall · August 2026', fallback: true }

/** True while <html> carries the `dark` class (the ThemeProvider toggles it). */
export function useIsDark() {
  const [dark, setDark] = useState(() => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const root = document.documentElement
    const sync = () => setDark(root.classList.contains('dark'))
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

export default function MapBackdrop({ opacity = 0.92 }) {
  const dark = useIsDark()
  const ocean = dark ? OCEAN.dark : OCEAN.light
  const [items, setItems] = useState([])
  const [loaded, setLoaded] = useState({})
  const [index, setIndex] = useState(0)
  const [prev, setPrev] = useState(null)      // the map fading out underneath the new one
  const indexRef = useRef(0)
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const src = (it) => (it.fallback ? `/backdrop-fallback-${dark ? 'dark' : 'light'}.webp` : `${it.url}&bg=${ocean}`)
  const useFallback = () => { indexRef.current = 0; setIndex(0); setPrev(null); setItems([FALLBACK]) }

  useEffect(() => {
    let alive = true
    fetch('/api/backdrops').then((r) => (r.ok ? r.json() : { items: [] })).then((d) => { if (!alive) return; if (d.items?.length) setItems(d.items); else useFallback() }).catch(() => { if (alive) useFallback() })
    return () => { alive = false }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let failed = 0
    items.forEach((it) => {
      const url = src(it)
      const im = new Image()
      im.onload = () => setLoaded((l) => ({ ...l, [url]: true }))
      im.onerror = () => { failed += 1; if (failed === items.length && !items[0]?.fallback) useFallback() }
      im.src = url
    })
  }, [items, ocean])   // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing painted after six seconds (a slow or failing API): show the shipped map.
  useEffect(() => {
    if (items[0]?.fallback) return undefined
    const t = setTimeout(() => { if (!items.some((it) => loaded[src(it)])) useFallback() }, FALLBACK_AFTER_MS)
    return () => clearTimeout(t)
  }, [items, loaded, ocean])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ready = items.filter((it) => loaded[src(it)])
    if (ready.length < 2 || reduce) return undefined
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      const i = indexRef.current
      let next = (i + 1) % items.length
      for (let n = 0; n < items.length && !loaded[src(items[next])]; n += 1) next = (next + 1) % items.length
      if (next === i) return
      indexRef.current = next
      setPrev(i); setIndex(next)
    }, INTERVAL_MS)
    return () => clearInterval(id)
  }, [items, loaded, reduce, ocean])   // eslint-disable-line react-hooks/exhaustive-deps

  // Drop the old map once the new one has fully faded in.
  useEffect(() => {
    if (prev === null) return undefined
    const t = setTimeout(() => setPrev(null), FADE_MS + 100)
    return () => clearTimeout(t)
  }, [prev, index])

  const current = items[index]
  const ready = current && loaded[src(current)]
  return (
    <>
      <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden" data-testid="map-backdrop" style={{ background: `#${ocean}` }}>
        {prev !== null && items[prev] && prev !== index && (
          <img key={`prev-${items[prev].url || 'fallback'}-${ocean}`} src={src(items[prev])} alt="" draggable="false"
            className="absolute inset-0 h-full w-full select-none object-contain p-4 sm:p-8" style={{ opacity }} />
        )}
        {current && !ready && current.preview && (
          <img key={`pre-${current.url}`} src={current.preview} alt="" draggable="false"
            className="absolute inset-0 h-full w-full select-none object-contain p-4 sm:p-8" style={{ opacity: opacity * 0.9, filter: 'blur(6px)' }} data-testid="backdrop-preview" />
        )}
        {ready && (
          <img key={`cur-${current.url || 'fallback'}-${ocean}`} src={src(current)} alt="" draggable="false"
            className="hcdp-bd-in absolute inset-0 h-full w-full select-none object-contain p-4 sm:p-8" style={{ opacity, '--bd-op': opacity, '--bd-fade': `${FADE_MS}ms` }} />
        )}
      </div>
    </>
  )
}
