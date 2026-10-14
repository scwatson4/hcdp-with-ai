import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

// What the shell around the page shows (14 Oct). 'page' — the header, the docked ask bar, the footer, everything;
// 'phone-map' — the climate viewer on a phone (M1 C): the header stays, the docked bar, the footer and Back to top give
// way to the full-screen map and its floating bar, and the page never scrolls; 'map-full' — the desktop viewer's
// full-screen map (QB-T3 B): the header and the docked bar are hidden too, the map fills the viewport. A page claims
// a mode while it is mounted; outside the provider (pages rendered alone in tests) claiming does nothing.
const ShellCtx = createContext({ mode: 'page', claim: () => () => {} })

export function ShellModeProvider({ children }) {
  const [mode, setMode] = useState('page')
  const claim = useCallback((m) => { setMode(m); return () => setMode((cur) => (cur === m ? 'page' : cur)) }, [])
  const value = useMemo(() => ({ mode, claim }), [mode, claim])
  return <ShellCtx.Provider value={value}>{children}</ShellCtx.Provider>
}

export const useShellMode = () => useContext(ShellCtx).mode

/** Hold the shell in `mode` while `active` (and this component is mounted). */
export function useClaimShell(mode, active = true) {
  const { claim } = useContext(ShellCtx)
  useEffect(() => (active ? claim(mode) : undefined), [mode, active, claim])
}
