import { useState } from 'react'
import { MonitorPlay } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import ExternalLink from './ExternalLink'
import { useNarrowScreen } from '@/viewer/useMediaQuery'

const hostOf = (url) => {
  try { return new URL(url).host } catch { return url }
}

// A live HCDP tool embedded in the page. Only used for tools whose server
// allows framing (no X-Frame-Options / CSP frame-ancestors); the portal link
// underneath is the fallback when the frame does not load. `deferred` waits
// for a click so a page with several tools does not load them all at once.
// M6 A (14 Oct): `phoneCard` (off unless asked for) — below 768 px no frame at all: a desktop app squeezed to 358 px is
// unusable (the 8 Oct audit: a clipped "Accept", nested scrolling), so the page shows a card with the title and an
// "Open ↗" button (44 px) that opens it full screen in a new tab (`openHref`, else the fallback page, else the frame's src).
/** The phone card that stands in for a framed app under 768 px: the title, where it opens, and a 44 px "Open ↗" in a new
 *  tab. Also used by the mirror's app embeds (portal/AppEmbed.jsx) on phones. */
export function EmbedCard({ title, href, className }) {
  return (
    <figure className={cn('w-full', className)} data-testid="embed-card">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4">
        <MonitorPlay className="h-6 w-6 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">{title}</p>
          <p className="mt-0.5 text-[13px] text-subtle">Opens full screen in a new tab · {hostOf(href)}</p>
        </div>
        <Button asChild className="h-11 shrink-0 px-4">
          <a href={href} target="_blank" rel="noopener noreferrer" data-testid="embed-open">Open <span aria-hidden="true">↗</span><span className="sr-only"> {title} (opens in a new tab)</span></a>
        </Button>
      </div>
    </figure>
  )
}

export default function EmbedFrame({ src, title, fallbackHref, fallbackLabel = 'Open it on the HCDP portal', deferred = false, className, phoneCard = false, openHref = null }) {
  const [show, setShow] = useState(!deferred)
  const narrow = useNarrowScreen()
  if (phoneCard && narrow) return <EmbedCard title={title} href={openHref || fallbackHref || src} className={className} />
  return (
    <figure className={cn('w-full', className)}>
      {show ? (
        <iframe
          src={src}
          title={title}
          loading="lazy"
          allow="fullscreen"
          className="block min-h-[70vh] w-full rounded-lg border border-border bg-card"
        />
      ) : (
        <div className="grid min-h-48 place-items-center rounded-lg border border-dashed border-border-strong bg-surface p-6 text-center">
          <div>
            <MonitorPlay className="mx-auto mb-2 h-6 w-6 text-accent" aria-hidden="true" />
            <p className="mb-3 text-sm text-subtle">{title} loads from {hostOf(src)}.</p>
            <Button type="button" size="sm" onClick={() => setShow(true)}>Load it here</Button>
          </div>
        </div>
      )}
      <figcaption className="mt-2 text-xs text-subtle">
        Embedded from <span className="font-mono">{hostOf(src)}</span>. If it does not load, <ExternalLink href={fallbackHref}>{fallbackLabel}</ExternalLink>
      </figcaption>
    </figure>
  )
}
