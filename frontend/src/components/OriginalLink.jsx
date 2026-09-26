import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ExternalLink, Link2, Check } from 'lucide-react'
import { originalFor } from '../site/original'

// The slim bar at the top of every page: a "Share this view" link copier on the
// left (every state here has its own URL) and the "Original HCDP version" on the
// right, since HCDP itself has no shareable, customizable URLs.
export default function OriginalLink() {
  const { pathname, search, hash } = useLocation()
  const { url, label, note } = originalFor(pathname, search, hash)
  const [copied, setCopied] = useState(false)
  useEffect(() => { setCopied(false) }, [pathname, search, hash])
  const copy = async () => {
    const href = window.location.href
    try { await navigator.clipboard.writeText(href); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { window.prompt('Copy this link', href) }
  }
  return (
    <div className="border-b border-border/70 bg-surface/60" data-testid="original-bar">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-1 text-[11.5px] text-subtle">
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground" aria-live="polite" data-testid="share-view">
          {copied ? <Check className="h-3 w-3" aria-hidden="true" /> : <Link2 className="h-3 w-3" aria-hidden="true" />}{copied ? 'Link copied' : 'Share this view'}
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-nav font-semibold uppercase tracking-[0.06em] hover:text-foreground" data-testid="original-link" title={note ? `${label} — ${note}` : label}>
          Original HCDP version <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
    </div>
  )
}
