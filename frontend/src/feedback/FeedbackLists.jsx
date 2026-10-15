import { useCallback, useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import { useFeedback } from './FeedbackProvider'
import { fetchMine, fetchOthers, renameReviewer } from './api'
import { FEATURE_LABEL, LIMITS, STATUS_LABEL, ago } from './features'
import { cn } from '../lib/utils'
import { KnownNames, KNOWN_NAMES_LIST, useKnownNames } from './useKnownNames'

// F3 A: the panel's "My feedback" (the reviewer's own items, by the name this browser remembers) and "Others" (everyone
// else's as titles and statuses — never a name). A tap on an item goes to its page and, for a quoted passage, marks the
// spot. The reviewer's name is shown and changed here; earlier feedback follows the new name (POST /api/feedback/rename).
// 15 Oct: "My feedback" leads with an "Entries (N)" count, the helper sentences are gone, and the name field offers the
// names already saved (GET /api/feedback/names) as a datalist.

const STATUS_TONE = {
  new: 'border-border text-subtle',
  reviewed: 'border-foreground/40 text-foreground',
  fixed: 'border-success/60 text-success',
  wontfix: 'border-border text-subtle line-through decoration-1',
}

export function StatusChip({ status }) {
  return (
    <span data-testid="status-chip" data-status={status}
      className={cn('inline-flex items-center rounded-full border px-1.5 py-px text-[12px] font-semibold uppercase tracking-wide', STATUS_TONE[status] || STATUS_TONE.new)}>
      {STATUS_LABEL[status] || status || 'New'}
    </span>
  )
}

function Item({ row, mine, onOpen }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen(row)} data-testid={mine ? 'mine-item' : 'others-item'}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-left text-[13px] hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {mine && row.quote && <span className="mb-1 block truncate border-l-2 border-[#e8b84b] pl-2 italic text-subtle">“{row.quote}”</span>}
        <span className="line-clamp-2 block text-foreground" data-testid="item-title">{row.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-subtle">
          <StatusChip status={row.status} />
          <span>{FEATURE_LABEL[row.feature] || 'Other'}</span>
          {row.page_path && <span className="max-w-[12rem] truncate font-mono text-[12px]">· {row.page_path}</span>}
          <span>· {ago(row.created_at)}</span>
        </span>
      </button>
    </li>
  )
}

/** "Reviewing as Ikaika ✎" — the name, and changing it (earlier feedback follows when there was a name before). */
export function NameLine({ onRenamed }) {
  const fb = useFeedback()
  const [editing, setEditing] = useState(!fb.name)
  const [draft, setDraft] = useState(fb.name)
  const [state, setState] = useState('idle')   // 'idle' | 'saving' | 'error'
  const known = useKnownNames(editing)
  useEffect(() => { setDraft(fb.name) }, [fb.name])
  const save = async (e) => {
    e?.preventDefault()
    const to = draft.trim().slice(0, LIMITS.name)
    const from = fb.name
    if (!to || to === from) { setEditing(!to); return }
    setState('saving')
    try {
      if (from) await renameReviewer(from, to)
      fb.setName(to)
      setEditing(false); setState('idle')
      onRenamed?.(to)
    } catch { setState('error') }
  }
  if (!editing) {
    return (
      <p className="flex items-center gap-1.5 text-[13px] text-subtle" data-testid="reviewer-line">
        Reviewing as <span className="font-medium text-foreground" data-testid="reviewer-name">{fb.name}</span>
        <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded px-1 text-[12px] underline-offset-2 hover:text-foreground hover:underline [@media(pointer:coarse)]:min-h-11" data-testid="reviewer-rename">
          <Pencil className="h-3 w-3" aria-hidden="true" />Change
        </button>
      </p>
    )
  }
  return (
    <form onSubmit={save} className="space-y-1" data-testid="reviewer-form">
      <label className="block text-[12px] font-medium uppercase tracking-wide text-subtle" htmlFor="feedback-reviewer-name">Your name</label>
      <div className="flex gap-2">
        <input id="feedback-reviewer-name" value={draft} onChange={(e) => setDraft(e.target.value.slice(0, LIMITS.name))} placeholder="e.g. Ikaika" autoComplete="name" list={KNOWN_NAMES_LIST}
          className="min-h-10 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="reviewer-input" />
        <button type="submit" disabled={!draft.trim() || state === 'saving'} className="hcdp-send min-h-10 rounded-md px-4 text-[13px] font-medium text-accent-foreground disabled:opacity-40 [@media(pointer:coarse)]:min-h-11" data-testid="reviewer-save">
          {state === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </div>
      <KnownNames names={known} />
      {fb.name && <p className="text-[12px] text-subtle">Your earlier feedback follows the new name.</p>}
      {state === 'error' && <p role="alert" className="text-[12px] text-destructive">The name could not be changed. Try again.</p>}
    </form>
  )
}

function useRows(load, deps) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const reload = useCallback(() => {
    let live = true
    setError('')
    load().then((r) => { if (live) setRows(r) }).catch((e) => { if (live) { setRows([]); setError(e?.message || 'Could not load.') } })
    return () => { live = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => reload(), [reload])
  return { rows, error, reload }
}

export function MyFeedback() {
  const fb = useFeedback()
  const { rows, error } = useRows(() => fetchMine(fb.name), [fb.name])
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" data-testid="feedback-mine">
      <NameLine />
      <p className="text-[12px] font-medium uppercase tracking-wide text-subtle" data-testid="mine-count">Entries ({fb.name && Array.isArray(rows) ? rows.length : 0})</p>
      {fb.name && rows === null && <p className="text-[13px] text-subtle" role="status">Loading…</p>}
      {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
      {fb.name && rows?.length === 0 && !error && <p className="text-[13px] text-subtle" data-testid="mine-empty">Nothing yet under this name. Select any text, use 👍 / 👎 on an AI answer, or the Give feedback tab.</p>}
      {rows?.length > 0 && <ul className="space-y-2" aria-label="My feedback">{rows.map((r) => <Item key={r.id} row={r} mine onOpen={fb.goTo} />)}</ul>}
    </div>
  )
}

export function OthersFeedback() {
  const fb = useFeedback()
  const { rows, error } = useRows(() => fetchOthers(fb.name), [fb.name])
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" data-testid="feedback-others">
      <p className="text-[12px] text-subtle">Feedback given by other team members</p>
      {rows === null && <p className="text-[13px] text-subtle" role="status">Loading…</p>}
      {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
      {rows?.length === 0 && !error && <p className="text-[13px] text-subtle" data-testid="others-empty">No one else has sent feedback yet.</p>}
      {rows?.length > 0 && <ul className="space-y-2" aria-label="Others’ feedback">{rows.map((r) => <Item key={r.id} row={r} onOpen={fb.goTo} />)}</ul>}
    </div>
  )
}
