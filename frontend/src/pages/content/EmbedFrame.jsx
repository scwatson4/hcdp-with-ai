import { useState } from 'react'
import { MonitorPlay } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import ExternalLink from './ExternalLink'

const hostOf = (url) => {
  try { return new URL(url).host } catch { return url }
}

// A live HCDP tool embedded in the page. Only used for tools whose server
// allows framing (no X-Frame-Options / CSP frame-ancestors); the portal link
// underneath is the fallback when the frame does not load. `deferred` waits
// for a click so a page with several tools does not load them all at once.
export default function EmbedFrame({ src, title, fallbackHref, fallbackLabel = 'Open it on the HCDP portal', deferred = false, className }) {
  const [show, setShow] = useState(!deferred)
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
