import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ExternalLink, Link2, Check, Copy, X } from 'lucide-react'
import { originalFor } from '../site/original'
import { canonicalize, foreignQuery } from '../viewer/urlGrammar'
import { cn } from '../lib/utils'

// The two controls that used to make the slim bar under the header now sit on the header's logo
// row (item 11, 2026-10-08): "Share this view" at the far left — every state here has its own URL:
// click → a small panel under the button shows the link, selected and copied, with a copy icon to
// copy it again — and "Original HCDP version" at the far right, since HCDP itself has no
// shareable, customizable URLs. On phones they shorten to "Share" / "Original" (icons alone on
// the narrowest screens).

/** The address worth sharing: viewer links in their one canonical spelling (aliases resolved, keys
 *  ordered, defaults dropped) so two people sharing one view share one URL; other pages as they are. */
export function shareHref(pathname, search, hash) {
  if (typeof window === 'undefined') return ''
  const c = canonicalize(pathname, search)
  if (!c) return window.location.origin + pathname + (search || '') + (hash || '')
  const extra = foreignQuery(search)
  return window.location.origin + c + (extra ? (c.includes('?') ? '&' : '?') + extra : '') + (hash || '')
}

const CONTROL = 'inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11.5px] text-subtle hover:text-foreground [@media(pointer:coarse)]:min-h-11'

export function ShareView({ className }) {
  const { pathname, search, hash } = useLocation()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef(null)
  const rootRef = useRef(null)
  const href = shareHref(pathname, search, hash)

  useEffect(() => { setOpen(false); setCopied(false) }, [pathname, search, hash])

  const copy = async () => {
    try { await navigator.clipboard.writeText(href); setCopied(true) } catch { setCopied(false) }
    setTimeout(() => setCopied(false), 2200)
  }
  const share = async () => {
    setOpen(true)
    await copy()
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 30)
  }
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown) }
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative', className)} data-testid="share-control">
      <button type="button" onClick={share} aria-expanded={open} className={CONTROL} data-testid="share-view" title="Share this view">
        <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="hidden min-[420px]:inline">Share<span className="hidden sm:inline"> this view</span></span>
        <span className="sr-only min-[420px]:hidden">Share this view</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[min(92vw,26rem)] rounded-md border border-border bg-card p-1.5 shadow-lg" data-testid="share-panel">
          <div className="flex items-center gap-1">
            <input ref={inputRef} readOnly value={href} onFocus={(e) => e.target.select()} aria-label="Link to this view"
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-canvas px-2 font-mono text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <button type="button" onClick={copy} aria-label={copied ? 'Copied' : 'Copy link'} title={copied ? 'Copied' : 'Copy link'} data-testid="share-copy"
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border bg-canvas hover:border-foreground ${copied ? 'text-accent' : 'text-foreground'}`}>
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
            <span className="shrink-0 text-[11px] text-subtle" aria-live="polite" data-testid="share-status">{copied ? 'Copied' : ''}</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-subtle hover:text-foreground"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </div>
        </div>
      )}
    </div>
  )
}

export function OriginalVersionLink({ className }) {
  const { pathname, search, hash } = useLocation()
  const { url, label, note } = originalFor(pathname, search, hash)
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cn(CONTROL, 'font-nav font-semibold uppercase tracking-[0.06em]', className)} data-testid="original-link" title={note ? `${label} — ${note}` : label}>
      <span className="hidden min-[420px]:inline">Original<span className="hidden sm:inline"> HCDP version</span></span>
      <span className="sr-only min-[420px]:hidden">Original HCDP version</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}
