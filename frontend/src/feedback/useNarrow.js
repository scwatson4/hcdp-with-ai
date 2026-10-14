import { useEffect, useState } from 'react'

// Phone width for the feedback UI: below 640 px the composer is a bottom sheet instead of a right-side panel.
export const NARROW_QUERY = '(max-width: 639px)'

const mq = (q) => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(q) : null)

export function useNarrow(q = NARROW_QUERY) {
  const [narrow, setNarrow] = useState(() => Boolean(mq(q)?.matches))
  useEffect(() => {
    const m = mq(q)
    if (!m) return undefined
    setNarrow(Boolean(m.matches))
    const on = (e) => setNarrow(Boolean(e.matches))
    if (typeof m.addEventListener === 'function') { m.addEventListener('change', on); return () => m.removeEventListener('change', on) }
    if (typeof m.addListener === 'function') { m.addListener(on); return () => m.removeListener(on) }
    return undefined
  }, [q])
  return narrow
}
