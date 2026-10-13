import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Download, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { clearDownload, useDownloadOffer } from './downloadStore'
import DownloadDrawer from './DownloadDrawer'

// The offer at the top of the API page after a data ask (gallery D1 A, 13 Oct): one sentence on what the AI would
// prepare, the button "Use AI to download the data I need" (opens the drawer) and the line "Requires HCDP API key.
// Request one here" — "here" linking to the catalog's API page (the URL comes with the navigator's answer, never
// hard-coded here). Shows only while the store holds an offer for this very pathname; ✕ dismisses it.
export const OFFER_BUTTON = 'Use AI to download the data I need'

export default function OfferCard({ className }) {
  const offer = useDownloadOffer()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  if (!offer || offer.path !== pathname) return null
  return (
    <section aria-label="AI-prepared download" data-testid="download-offer" className={cn('relative rounded-lg border border-border bg-card p-4 pl-5 shadow-sm', className)}>
      <span aria-hidden="true" className="hcdp-ai-summary-rule" />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] text-subtle"><Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" /><span className="hcdp-ai-words">HCDP AI</span> can prepare this download</p>
          <p className="mt-1 text-[15px] leading-relaxed" data-testid="offer-sentence">{offer.offer}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button type="button" onClick={() => setOpen(true)} className="[@media(pointer:coarse)]:h-11" data-testid="offer-button"><Download className="h-4 w-4" aria-hidden="true" />{OFFER_BUTTON}</Button>
            <p className="text-xs text-subtle" data-testid="offer-key-line">
              Requires HCDP API key. Request one {offer.apiUrl
                ? <a href={offer.apiUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground" data-testid="offer-key-link">here<span className="sr-only"> (opens in a new tab)</span></a>
                : 'on HCDP’s API page'}
            </p>
          </div>
        </div>
        <button type="button" onClick={clearDownload} aria-label="Dismiss the download offer" data-testid="offer-dismiss"
          className="-mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-subtle hover:bg-muted hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <DownloadDrawer open={open} onOpenChange={setOpen} ask={offer.ask} hints={offer.hints} context={{ path: pathname }} apiUrl={offer.apiUrl} />
    </section>
  )
}
