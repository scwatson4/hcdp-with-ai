import { useLocation } from 'react-router-dom'
import { Minus, X } from 'lucide-react'
import { useAssistant } from './AssistantProvider'
import AssistantPanel from './AssistantPanel'

// After the assistant has navigated, it lives here: a small pill in the
// lower-right that expands into a compact panel. On the landing page the
// inline box is the assistant, so the dock stays out of the way there.
export default function AssistantDock() {
  const { mode, setMode, minimize, reset } = useAssistant()
  const { pathname } = useLocation()
  // On the landing page the inline box IS the assistant; anywhere else (a shared deep link, a content page)
  // the pill is the way in.
  if (mode === 'inline' && pathname === '/') return null
  if (mode === 'inline' || mode === 'dock') {
    return (
      <button type="button" onClick={() => setMode('panel')} data-testid="assistant-dock"
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-2 text-sm shadow-lg backdrop-blur hover:border-foreground">
        <img src="/hcdp_mark.png" alt="" width="334" height="88" className="h-5 w-auto dark:hidden" /><img src="/hcdp_mark_dark.png" alt="" width="334" height="88" className="hidden h-5 w-auto dark:block" />
        <span>Ask HCDP</span>
      </button>
    )
  }
  return (
    <div className="fixed bottom-4 right-4 z-50 flex h-[480px] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl" role="dialog" aria-label="HCDP assistant" data-testid="assistant-dock-panel">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium">HCDP assistant</span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Minimize" onClick={minimize} className="rounded p-1 text-subtle hover:text-foreground"><Minus className="h-4 w-4" /></button>
          <button type="button" aria-label="Start over" onClick={reset} className="rounded p-1 text-subtle hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
      </div>
      <AssistantPanel compact autoFocus />
    </div>
  )
}
