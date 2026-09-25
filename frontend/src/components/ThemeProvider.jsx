import * as React from 'react'

const ThemeContext = React.createContext({ theme: 'light', setTheme: () => {} })

const STORAGE_KEY = 'hcdp-theme'

function applyTheme(theme) {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.add(prefersDark ? 'dark' : 'light')
  } else {
    root.classList.add(theme)
  }
  root.style.colorScheme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme
}

export function ThemeProvider({ children, defaultTheme = 'light' }) {
  const [theme, setThemeState] = React.useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || defaultTheme
    } catch { return defaultTheme }
  })

  React.useEffect(() => { applyTheme(theme) }, [theme])

  React.useEffect(() => {
    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [theme])

  const setTheme = React.useCallback((t) => {
    try { localStorage.setItem(STORAGE_KEY, t) } catch {}
    setThemeState(t)
  }, [])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return React.useContext(ThemeContext)
}
