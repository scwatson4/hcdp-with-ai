import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { AI_INTERFACE, aiInterfaceHost } from '../site/handoff'

// T4 pick A (as modified, 2026-10-08): the way back. When the site is opened with `?from=ai`
// (a link out of the AI data analysis tool), one line under the header says so, with "Return"
// and a ✕. Return goes back to the AI interface: history.back() when the visitor really came
// from there (the referrer is the AI interface's host and there is history to go back to),
// else a plain visit to the AI interface. Nothing is stored; the strip disappears on the next
// route change; the `from` key is stripped from the address (the rest is kept) once read.
export default function ReturnStrip() {
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()
  const [shown, setShown] = useState(false)
  const shownOn = useRef(null)

  useEffect(() => {
    const q = new URLSearchParams(search)
    if (q.get('from') !== 'ai') return
    q.delete('from')
    const rest = q.toString()
    shownOn.current = pathname
    setShown(true)
    navigate({ pathname, search: rest ? `?${rest}` : '', hash }, { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // The next route change (a different page) takes the strip away.
  useEffect(() => { if (shownOn.current != null && pathname !== shownOn.current) { setShown(false); shownOn.current = null } }, [pathname])

  if (!shown) return null
  const back = (e) => {
    let fromAi = false
    try { fromAi = new URL(document.referrer).host === aiInterfaceHost() } catch { fromAi = false }
    if (fromAi && window.history.length > 1) { e.preventDefault(); window.history.back() }
  }
  return (
    <div className="border-b border-border/70 bg-surface/80" data-testid="return-strip" role="status">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-1 text-[12.5px] text-subtle">
        <p className="min-w-0 truncate">
          You came from the AI data analysis tool · <a href={AI_INTERFACE} onClick={back} className="font-medium text-foreground underline underline-offset-2 hover:text-accent" data-testid="return-link">Return</a>
        </p>
        <button type="button" onClick={() => setShown(false)} aria-label="Dismiss" className="grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-muted hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" data-testid="return-dismiss">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
