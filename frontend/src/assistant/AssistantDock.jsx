import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Minus, X } from 'lucide-react'
import { useAssistant } from './AssistantProvider'
import AssistantPanel from './AssistantPanel'

// After the assistant has navigated it lives here: a small "Ask AI" pill in the
// lower-right that expands into a compact panel (about 16–20 lines of text) and
// shrinks back like a blob when closed. On the landing page the inline box is
// the assistant, so the pill stays out of the way there.
const CLOSE_MS = 480

export default function AssistantDock() {
  const { mode, setMode, minimize, reset } = useAssistant()
  const { pathname } = useLocation()
  const [closing, setClosing] = useState(false)
  const [popPill, setPopPill] = useState(false)
  const wasPanel = useRef(false)

  // Any panel → dock/inline change (a click on minimize, Escape, a navigation) plays the goo close.
  useEffect(() => {
    if (mode === 'panel') { wasPanel.current = true; setClosing(false); return undefined }
    if (!wasPanel.current) return undefined
    wasPanel.current = false
    setClosing(true)
    const t = setTimeout(() => { setClosing(false); setPopPill(true); setTimeout(() => setPopPill(false), 450) }, CLOSE_MS)
    return () => clearTimeout(t)
  }, [mode])

  // Never on the landing page: there the inline box is the assistant.
  if (pathname === '/' && !closing) return null
  const showPill = (mode === 'inline' || mode === 'dock') && !closing
  return (
    <>
      <svg width="0" height="0" aria-hidden="true" className="absolute"><defs><filter id="hcdp-goo"><feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" /><feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" result="goo" /><feComposite in="SourceGraphic" in2="goo" operator="atop" /></filter></defs></svg>
      {showPill && (
        <button type="button" onClick={() => setMode('panel')} data-testid="assistant-dock"
          className={`hcdp-rainbow-border fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full px-3 py-2 text-sm shadow-lg hover:shadow-xl ${popPill ? 'hcdp-pill-pop' : ''}`}>
          <img src="/hcdp_mark.png" alt="" width="334" height="88" className="h-5 w-auto dark:hidden" /><img src="/hcdp_mark_dark.png" alt="" width="334" height="88" className="hidden h-5 w-auto dark:block" />
          <span className="font-medium">Ask AI</span>
        </button>
      )}
      {(mode === 'panel' || closing) && (
        <div className={closing ? 'hcdp-goo-wrap fixed bottom-4 right-4 z-50' : 'fixed bottom-4 right-4 z-50'}>
          <div className={`flex h-[400px] w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl ${closing ? 'hcdp-goo-close' : ''}`}
            role="dialog" aria-label="Ask AI" data-testid={closing ? 'assistant-dock-closing' : 'assistant-dock-panel'}>
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="text-sm font-medium">Ask AI</span>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Minimize (Esc)" onClick={minimize} className="grid h-8 w-8 place-items-center rounded text-subtle hover:bg-muted hover:text-foreground"><Minus className="h-4 w-4" /></button>
                <button type="button" aria-label="Close and start over" onClick={reset} className="grid h-8 w-8 place-items-center rounded text-subtle hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <AssistantPanel compact autoFocus={!closing} />
          </div>
        </div>
      )}
    </>
  )
}
