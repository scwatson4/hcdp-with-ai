// The one thing the viewer remembers per browser besides the theme: the unit
// system (mm/°C or in/°F), like the HCDP v2 portal's "preferred units"
// setting. It only fills in a link that names no units; a units= key in the
// address always wins (CONTRACT.md, design rules). localStorage may be
// missing or refused (private windows, blocked site data), so every access
// is guarded and the preference is simply absent then.

export const UNITS_STORAGE_KEY = 'hcdp-units'
const SYSTEMS = new Set(['metric', 'imperial'])

/** 'metric' | 'imperial' | null (nothing remembered, or storage unavailable). */
export function readUnitsPreference() {
  try {
    const value = window.localStorage.getItem(UNITS_STORAGE_KEY)
    return SYSTEMS.has(value) ? value : null
  } catch { return null }
}

/** Remember a unit system; anything else forgets it. Never throws. */
export function writeUnitsPreference(system) {
  try {
    if (SYSTEMS.has(system)) window.localStorage.setItem(UNITS_STORAGE_KEY, system)
    else window.localStorage.removeItem(UNITS_STORAGE_KEY)
  } catch { /* storage refused: the choice lives in the URL only */ }
}
