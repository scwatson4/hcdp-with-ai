import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { useFeedback } from './FeedbackProvider'
import Composer from './Composer'
import { MyFeedback, OthersFeedback } from './FeedbackLists'
import { useNarrow } from './useNarrow'
import { cn } from '../lib/utils'

// F2 A + F3 A: one panel for the composer and the two lists — a right-side panel on desktop (400 px, full height, over
// the page, no backdrop: the page stays usable while the reviewer writes), a bottom sheet on phones (up to 88 % of the
// screen, rounded top, a grab bar). Its header switches between "New", "My feedback" and "Others"; ✕ or Esc closes it
// and the focus goes back where it was. Non-modal on purpose: a reviewer reads the page while writing about it. It sits
// above every layer of the site (z 1300: the phone Ask AI sheet is 71, the full-screen map 60, the phone viewer's sheet
// 1100 and its toast 1200), since a 👎 can open it from inside the Ask AI sheet; its Esc never reaches the sheet below.
const VIEWS = [
  { id: 'compose', label: 'New' },
  { id: 'mine', label: 'My feedback' },
  { id: 'others', label: 'Others' },
]
const TITLES = { compose: 'Give feedback', mine: 'My feedback', others: 'Others’ feedback' }

export default function FeedbackPanel() {
  const fb = useFeedback()
  const narrow = useNarrow()
  const hid = useId().replace(/:/g, '')
  const headRef = useRef(null)
  const p = fb.panel
  const view = p?.view
  // the lists take the focus on their heading; the composer focuses its text box itself (desktop) or its heading (phones)
  useEffect(() => {
    if (!view || (view === 'compose' && !narrow)) return undefined
    const t = setTimeout(() => headRef.current?.focus(), 20)
    return () => clearTimeout(t)
  }, [view, narrow, p?.seq])
  if (!p) return null
  return (
    <section role="dialog" aria-modal="false" aria-labelledby={hid} data-testid="feedback-panel" data-variant={narrow ? 'sheet' : 'panel'} data-view={view} data-feedback-ui=""
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fb.closePanel() } }}
      className={cn('fixed z-[1300] flex flex-col bg-card text-card-foreground print:hidden',
        narrow
          ? 'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-xl border-t border-border shadow-[0_-4px_16px_rgba(0,0,0,0.12)] animate-slide-up'
          : 'inset-y-0 right-0 w-[400px] max-w-[92vw] border-l border-border shadow-2xl animate-fade-in')}>
      {narrow && <span aria-hidden="true" className="mx-auto mt-2 block h-1 w-10 shrink-0 rounded-full bg-border-strong" data-testid="sheet-grab" />}
      <header className="shrink-0 border-b border-border px-4 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <h2 id={hid} ref={headRef} tabIndex={-1} className="font-display text-[17px] font-medium focus:outline-none" data-testid="feedback-panel-title">{TITLES[view]}</h2>
          <button type="button" onClick={() => fb.closePanel()} aria-label="Close feedback" data-testid="feedback-close"
            className="ml-auto grid h-8 w-8 place-items-center rounded-md text-subtle hover:bg-muted hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="Feedback" className="mt-2 flex gap-1 font-nav text-[12px] font-semibold">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" onClick={() => fb.setView(v.id)} aria-current={view === v.id ? 'page' : undefined} data-testid={`feedback-view-${v.id}`}
              className={cn('h-8 rounded-full px-3 transition-colors [@media(pointer:coarse)]:h-11',
                view === v.id ? 'bg-foreground text-canvas' : 'text-subtle hover:bg-muted hover:text-foreground')}>
              {v.label}
            </button>
          ))}
        </nav>
      </header>
      {view === 'compose' && p.draft && <Composer key={p.seq} draft={p.draft} narrow={narrow} />}
      {view === 'mine' && <MyFeedback />}
      {view === 'others' && <OthersFeedback />}
    </section>
  )
}
