import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ExternalLink, Link2, Check, Copy, X } from 'lucide-react'
import { originalFor } from '../site/original'

// The slim bar at the top of every page: "Share this view" on the left (every
// state here has its own URL: click → the link is shown, selected and copied,
// with a copy icon to copy it again) and "Original HCDP version" on the right,
// since HCDP itself has no shareable, customizable URLs.
export default function OriginalLink() {
  const { pathname, search, hash } = useLocation()
  const { url, label, note } = originalFor(pathname, search, hash)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef(null)
  const href = typeof window !== 'undefined' ? window.location.href : ''

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
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="border-b border-border/70 bg-surface/60" data-testid="original-bar">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-1 text-[11.5px] text-subtle">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button type="button" onClick={share} aria-expanded={open} className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 hover:text-foreground" data-testid="share-view">
            <Link2 className="h-3 w-3" aria-hidden="true" /> Share this view
          </button>
          {open && (
            <div className="flex min-w-0 flex-1 items-center gap-1" data-testid="share-panel">
              <input ref={inputRef} readOnly value={href} onFocus={(e) => e.target.select()} aria-label="Link to this view"
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-canvas px-2 font-mono text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <button type="button" onClick={copy} aria-label={copied ? 'Copied' : 'Copy link'} title={copied ? 'Copied' : 'Copy link'} data-testid="share-copy"
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border bg-canvas hover:border-foreground ${copied ? 'text-accent' : 'text-foreground'}`}>
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
              <span className="shrink-0 text-[11px]" aria-live="polite" data-testid="share-status">{copied ? 'Copied' : ''}</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid h-7 w-7 shrink-0 place-items-center rounded-md hover:text-foreground"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
            </div>
          )}
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 font-nav font-semibold uppercase tracking-[0.06em] hover:text-foreground" data-testid="original-link" title={note ? `${label} — ${note}` : label}>
          Original HCDP version <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
    </div>
  )
}
