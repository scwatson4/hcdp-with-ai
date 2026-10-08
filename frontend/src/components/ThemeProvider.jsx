import * as React from 'react'

// The site is always light (2026-10-08): there is no theme toggle, and a theme remembered
// by an earlier visit is cleared rather than applied. The dark-mode CSS stays in the
// stylesheet but is never activated. `useTheme` keeps its shape for any consumer.
const ThemeContext = React.createContext({ theme: 'light', setTheme: () => {} })

export const STORAGE_KEY = 'hcdp-theme'

function applyLight() {
  const root = document.documentElement
  root.classList.remove('dark')
  root.classList.add('light')
  root.style.colorScheme = 'light'
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* no storage */ }
}

export function ThemeProvider({ children }) {
  React.useEffect(() => { applyLight() }, [])
  const value = React.useMemo(() => ({ theme: 'light', setTheme: () => {} }), [])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return React.useContext(ThemeContext)
}
