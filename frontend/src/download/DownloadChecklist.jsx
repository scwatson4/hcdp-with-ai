import { useEffect, useState } from 'react'
import { Check, CircleDashed, ExternalLink as ExternalIcon, Plus, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { prefersReducedMotion } from '../assistant/AssistantProvider'
import { formatBytes } from './planApi'

// The AI-prepared download's checklist (gallery D2 A + D4 A, 13 Oct), shared by the drawer and the /download page: the
// planner's plain-English reading first; then the items grouped by kind — gridded maps · station data · from the storm
// report — the AI's first picks ticked and the context items unticked, one line of why per item, the verified file count
// and size; what does not exist is not offered but named with the closest alternative; and a dashed "Something else…" row
// that re-plans with the extra wish. Every row opens with a small verifying ring that resolves into its mark one row at a
// time, VERIFY_STAGGER_MS apart (reduced motion: all at once); the server has already confirmed each item against HCDP's
// file listing, so the reveal never promises more than the listing said.
export const VERIFY_STAGGER_MS = 120

/** Which of `ids` (in display order) have been revealed so far: one more every VERIFY_STAGGER_MS; all at once under reduced
 *  motion. A new set of ids starts over from the first row. */
export function useStaggeredReveal(ids, reduce = prefersReducedMotion()) {
  const key = ids.join('\u0001')
  const [state, setState] = useState(() => ({ key, shown: reduce ? ids.length : 0 }))
  const shown = state.key === key ? state.shown : (reduce ? ids.length : 0)
  const count = ids.length
  useEffect(() => {
    if (reduce || !count) { setState({ key, shown: count }); return undefined }
    let n = 0
    setState({ key, shown: 0 })
    const t = setInterval(() => {
      n += 1
      setState({ key, shown: n })
      if (n >= count) clearInterval(t)
    }, VERIFY_STAGGER_MS)
    return () => clearInterval(t)
  }, [key, reduce, count])
  return (id) => ids.indexOf(id) < shown
}

function VerifyMark({ state }) {
  if (state === 'pending') {
    return <span className="hcdp-verify" data-verify="pending"><span className="hcdp-comet-ring hcdp-comet-ring-sm" aria-hidden="true" /><span className="sr-only">checking that HCDP has it</span></span>
  }
  if (state === 'ok') {
    return <span className="hcdp-verify hcdp-verify-ok text-success" data-verify="ok"><Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" /><span className="sr-only">confirmed in HCDP's files</span></span>
  }
  if (state === 'partial') {
    return <span className="hcdp-verify hcdp-verify-ok text-warning" data-verify="partial"><TriangleAlert className="h-4 w-4" aria-hidden="true" /><span className="sr-only">partly published</span></span>
  }
  return <span className="hcdp-verify hcdp-verify-ok text-subtle" data-verify="unverified"><CircleDashed className="h-4 w-4" aria-hidden="true" /><span className="sr-only">could not be checked</span></span>
}

function Row({ item, picked, onToggle, revealed }) {
  const state = revealed ? (item.status || 'ok') : 'pending'
  const count = Number(item.count) || 0
  return (
    <li data-testid="download-item" data-item-id={item.id} data-group={item.group} data-verify={state} className="hcdp-dl-row">
      <label className={cn('flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border border-border px-2.5 py-2 hover:bg-muted', picked && 'bg-accent-soft')}>
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-accent" checked={picked} disabled={state === 'pending'} onChange={() => onToggle(item.id)} data-testid={`download-tick-${item.id}`} />
        <VerifyMark state={state} />
        <span className="min-w-0 flex-1 text-sm">
          <span className="block font-medium" data-testid="download-item-label">
            {item.label}
            {item.group === 'report' && item.url && (
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex align-middle text-subtle hover:text-foreground" onClick={(e) => e.stopPropagation()} data-testid="download-item-link">
                <ExternalIcon className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">open on HCDP (new tab)</span>
              </a>
            )}
          </span>
          {item.why && <span className="block text-xs text-subtle" data-testid="download-item-why">{item.why[0].toUpperCase() + item.why.slice(1)}</span>}
          {item.note && <span className="block text-xs italic text-subtle" data-testid="download-item-note">{item.note}</span>}
        </span>
        {item.group !== 'report' && (
          <span className="shrink-0 text-right text-xs text-subtle" data-testid="download-item-count">
            {count.toLocaleString('en-US')} file{count === 1 ? '' : 's'}<br />{formatBytes(item.bytes)}
          </span>
        )}
      </label>
    </li>
  )
}

function SomethingElse({ onAdd, busy }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-testid="download-something-else"
        className="flex min-h-11 w-full items-center gap-2 rounded-md border border-dashed border-border-strong px-3 text-sm text-subtle hover:border-foreground hover:text-foreground">
        <Plus className="h-4 w-4" aria-hidden="true" /> Something else…
      </button>
    )
  }
  return (
    <form className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border-strong p-2" onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t && !busy) { onAdd(t); setText(''); setOpen(false) } }} data-testid="download-extra-form">
      <input autoFocus value={text} onChange={(e) => setText(e.target.value.slice(0, 300))} placeholder="What else should the package include?" aria-label="Something else for the package"
        className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="download-extra" />
      <Button type="submit" size="sm" disabled={!text.trim() || busy} data-testid="download-extra-add">Add</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </form>
  )
}

export default function DownloadChecklist({ plan, picked, onToggle, onSomethingElse, replanning = false, className }) {
  const items = plan?.items || []
  const groups = (plan?.groups || []).filter((g) => items.some((i) => i.group === g.id))
  // the rows resolve in the order they are shown (group by group), not in the plan's order
  const revealedFor = useStaggeredReveal(groups.flatMap((g) => items.filter((i) => i.group === g.id).map((i) => i.id)))
  const dropped = plan?.dropped || []
  return (
    <div className={cn('space-y-5', className)} data-testid="download-checklist">
      {plan?.reading && <p className="text-[15px] leading-relaxed" data-testid="download-reading">{plan.reading}</p>}
      {!items.length && <p className="text-sm text-subtle" data-testid="download-empty">Nothing HCDP's export packages matches this ask — try naming a product (rainfall, temperature), dates and an island.</p>}
      {groups.map((g) => (
        <fieldset key={g.id} data-testid={`download-group-${g.id}`}>
          <legend className="mb-1 block font-mono text-[11px] font-medium uppercase tracking-wide text-subtle">{g.label}</legend>
          <ul className="space-y-1">
            {items.filter((i) => i.group === g.id).map((it) => <Row key={it.id} item={it} picked={picked.has(it.id)} onToggle={onToggle} revealed={revealedFor(it.id)} />)}
          </ul>
        </fieldset>
      ))}
      {dropped.length > 0 && (
        <ul className="space-y-1 text-xs text-subtle" aria-label="Not offered" data-testid="download-dropped">
          {dropped.map((d, i) => <li key={`${d.id}-${i}`} data-testid="download-dropped-item">Not offered: <span className="font-medium text-foreground">{d.label}</span> — {d.why}</li>)}
        </ul>
      )}
      <SomethingElse onAdd={onSomethingElse} busy={replanning} />
      {replanning && (
        <p className="flex items-center gap-2 text-sm text-subtle" role="status" data-testid="download-replanning">
          <span className="hcdp-comet-ring hcdp-comet-ring-sm" aria-hidden="true" />Re-planning with your wish and checking HCDP's files…
        </p>
      )}
    </div>
  )
}
