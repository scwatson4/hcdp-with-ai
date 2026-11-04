// One quiet line above the header from 11:00 pm to 5:00 am Hawaiʻi time (lib/maintenance.js):
// the maintenance window, in words, with an × that hides it for the rest of that night.
import { useEffect, useState } from 'react'
import { maintenanceNotice } from '../lib/maintenance'

const KEY = 'hcdp.maintenanceDismissed'

export default function MaintenanceStrip() {
  const [notice, setNotice] = useState(() => maintenanceNotice())
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(KEY) } catch { return null } })
  useEffect(() => {
    const id = setInterval(() => setNotice(maintenanceNotice()), 60000)
    return () => clearInterval(id)
  }, [])
  if (!notice || dismissed === notice.night) return null
  const hide = () => {
    try { localStorage.setItem(KEY, notice.night) } catch { /* private browsing */ }
    setDismissed(notice.night)
  }
  return (
    <div className="border-b border-border/70 bg-surface/95" data-testid="maintenance-strip" data-phase={notice.phase} role="status">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-1 text-[12.5px] text-subtle">
        <p className="min-w-0">{notice.text}</p>
        <button type="button" onClick={hide} aria-label="Hide for tonight" className="shrink-0 px-1 text-foreground/70 hover:text-foreground">×</button>
      </div>
    </div>
  )
}
