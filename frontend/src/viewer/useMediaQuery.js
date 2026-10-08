// A CSS media query as React state (false where matchMedia is missing, as in
// jsdom or a server render), following the window as it changes.

import { useEffect, useState } from 'react'

const query = (q) => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(q) : null)

export function useMediaQuery(q) {
  const [matches, setMatches] = useState(() => Boolean(query(q)?.matches))
  useEffect(() => {
    const mq = query(q)
    if (!mq) return undefined
    setMatches(Boolean(mq.matches))
    const onChange = (e) => setMatches(Boolean(e.matches))
    if (typeof mq.addEventListener === 'function') { mq.addEventListener('change', onChange); return () => mq.removeEventListener('change', onChange) }
    if (typeof mq.addListener === 'function') { mq.addListener(onChange); return () => mq.removeListener(onChange) }
    return undefined
  }, [q])
  return matches
}

/** Phone-width layouts (the viewer's bottom sheet). */
export const useNarrowScreen = () => useMediaQuery('(max-width: 767px)')

/** The visitor asked for less motion: no slides, no fades. */
export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)')
