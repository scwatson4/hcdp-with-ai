import { useEffect, useState } from 'react'
import { cn } from '../lib/utils'

// The landing hero's backdrop: HCDP's newest statewide maps (rendered by
// /api/map.png), fading into one another. The portal's home page has a map
// carousel that cuts between images; this one crossfades, preloads every
// image first, pauses in a hidden tab and stops for reduced-motion users.
const INTERVAL_MS = 7000
const FADE_MS = 1800

export default function MapBackdrop({ opacity = 0.68 }) {
  const [items, setItems] = useState([])
  const [loaded, setLoaded] = useState({})
  const [index, setIndex] = useState(0)

  useEffect(() => {
    let alive = true
    fetch('/api/backdrops').then((r) => (r.ok ? r.json() : { items: [] })).then((d) => { if (alive) setItems(d.items || []) }).catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    items.forEach((it) => {
      const im = new Image()
      im.onload = () => setLoaded((l) => ({ ...l, [it.url]: true }))
      im.src = it.url
    })
  }, [items])

  useEffect(() => {
    const ready = items.filter((it) => loaded[it.url])
    if (ready.length < 2) return undefined
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return undefined
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      setIndex((i) => {
        let next = (i + 1) % items.length
        for (let n = 0; n < items.length && !loaded[items[next].url]; n += 1) next = (next + 1) % items.length
        return next
      })
    }, INTERVAL_MS)
    return () => clearInterval(id)
  }, [items, loaded])

  const current = items[index]
  return (
    <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden" data-testid="map-backdrop">
      {items.map((it, k) => (
        <img key={it.url} src={it.url} alt="" draggable="false"
          className="absolute inset-0 h-full w-full select-none object-contain p-4 sm:p-8"
          style={{ opacity: k === index && loaded[it.url] ? opacity : 0, transition: `opacity ${FADE_MS}ms ease-in-out` }} />
      ))}
      <div className="absolute inset-0 bg-gradient-to-b from-canvas/35 via-transparent to-canvas/45" />
      {current && loaded[current.url] && (
        <div className="absolute bottom-3 left-4 flex items-center gap-3">
          <span className="rounded-full border border-border bg-card/80 px-2.5 py-1 text-[11px] text-subtle backdrop-blur" data-testid="backdrop-label">{current.label} · HCDP</span>
          <span className="flex gap-1">{items.map((it, k) => <span key={it.url} className={cn('h-1.5 w-1.5 rounded-full transition-colors', k === index ? 'bg-foreground/70' : 'bg-foreground/25')} />)}</span>
        </div>
      )}
    </div>
  )
}
