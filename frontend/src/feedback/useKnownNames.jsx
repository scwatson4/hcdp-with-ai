import { useEffect, useState } from 'react'
import { fetchNames } from './api'

// 15 Oct: "Your name" offers the names already saved with feedback (a datalist under the field), so a returning
// reviewer picks theirs instead of retyping it. Loaded when a name field shows; a failed load just offers nothing.
export const KNOWN_NAMES_LIST = 'feedback-known-names'

export function useKnownNames(active = true) {
  const [names, setNames] = useState([])
  useEffect(() => {
    if (!active) return undefined
    let live = true
    Promise.resolve().then(() => fetchNames()).then((n) => { if (live) setNames(n) }).catch(() => { if (live) setNames([]) })
    return () => { live = false }
  }, [active])
  return names
}

export function KnownNames({ id = KNOWN_NAMES_LIST, names }) {
  return <datalist id={id} data-testid="known-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
}
