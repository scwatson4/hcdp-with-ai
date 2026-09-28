import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pause, Play } from 'lucide-react'

// The landing hero's backdrop (R4 B + R7 B): HCDP's newest statewide maps rendered by
// /api/map.webp with the ocean filled in the hero's own blue, so there is no seam; each
// arrives as a blurred 24 px preview first and sharpens when the full map lands.
// The next map fades in over the current one and the old one is then removed, so
// nothing pales mid-fade; 8 s a map with a thin progress line; the caption is a
// link that opens that very map in the viewer; a pause button; preloads every image
// first, pauses in a hidden tab and stops for reduced-motion users.
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
  const [paused, setPaused] = useState(false)
  const [cycle, setCycle] = useState(0)       // restarts the progress line
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
    if (ready.length < 2 || reduce || paused) return undefined
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      const i = indexRef.current
      let next = (i + 1) % items.length
      for (let n = 0; n < items.length && !loaded[src(items[next])]; n += 1) next = (next + 1) % items.length
      if (next === i) return
      indexRef.current = next
      setPrev(i); setIndex(next); setCycle((c) => c + 1)
    }, INTERVAL_MS)
    return () => clearInterval(id)
  }, [items, loaded, reduce, paused, ocean])   // eslint-disable-line react-hooks/exhaustive-deps

  // Drop the old map once the new one has fully faded in.
  useEffect(() => {
    if (prev === null) return undefined
    const t = setTimeout(() => setPrev(null), FADE_MS + 100)
    return () => clearTimeout(t)
  }, [prev, index])

  const current = items[index]
  const ready = current && loaded[src(current)]
  const viewerPath = (it) => `/viewer/${it.dataset}/${it.period}/${it.date}/${it.extent}`
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
      {ready && (
        <div className="absolute inset-x-0 bottom-0 z-[6]" data-testid="backdrop-caption">
          <div className="flex items-end justify-between gap-3 px-4 pb-2.5">
            <Link to={viewerPath(current)} className="rounded bg-canvas/75 px-1.5 py-0.5 text-[12.5px] text-foreground underline underline-offset-[3px] hover:bg-canvas" data-testid="backdrop-label" title="Open this map in the viewer">
              {current.label} →
            </Link>
            {!reduce && items.length > 1 && (
              <button type="button" onClick={() => { setPaused((p) => !p); setCycle((c) => c + 1) }} aria-pressed={paused}
                aria-label={paused ? 'Play the map slideshow' : 'Pause the map slideshow'} title={paused ? 'Play' : 'Pause'} data-testid="backdrop-pause"
                className="grid h-[26px] w-[26px] place-items-center rounded-full border border-border bg-canvas/85 text-foreground hover:bg-canvas">
                {paused ? <Play className="h-3 w-3" aria-hidden="true" /> : <Pause className="h-3 w-3" aria-hidden="true" />}
              </button>
            )}
          </div>
          {!reduce && items.length > 1 && (
            <div className="h-0.5 w-full bg-foreground/10" aria-hidden="true">
              <div key={cycle} className="hcdp-bd-progress h-full bg-foreground/60" style={{ '--bd-interval': `${INTERVAL_MS}ms`, animationPlayState: paused ? 'paused' : 'running' }} />
            </div>
          )}
        </div>
      )}
    </>
  )
}
