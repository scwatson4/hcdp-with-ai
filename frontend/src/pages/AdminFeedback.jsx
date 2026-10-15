import { useCallback, useEffect, useState } from 'react'
import { ClipboardCopy, Download, FileJson, KeyRound, Trash2 } from 'lucide-react'
import { FEATURES, FEATURE_LABEL, KINDS, KIND_LABEL, STATUSES, STATUS_LABEL, clip } from '../feedback/features'
import { BACKLOG_TIP, backlogEntry } from '../feedback/backlog'
import { copyText } from '../feedback/copy'
import { cn } from '../lib/utils'

// The admin's review page (P4 A, grown into F3 A on 13 Oct). Not linked from anywhere — type /admin/feedback. It asks for
// the admin key (a password field; sent as X-Admin-Key, kept in sessionStorage for this tab only), then shows ONE review
// list over both stores, newest first: the reviewers' feedback (thumbs, selected passages, the Give feedback tab) and the
// visitors' "Wrong page?" reports. Filters by kind, feature and status; per row a status (new · reviewed · fixed · won't
// fix, saved at once) and a team note (PATCH /api/admin/feedback/{id}); the counts; Export CSV (the filtered list);
// "Export as eval cases" (the 👎 and wrong-page rows that named a page, shaped like backend/data/usecases.json entries);
// and "Add to backlog", which copies a ready-made team-backlog entry for the row. A wrong key says "Not authorised"; an
// instance without ADMIN_KEY (the API answers 404) says the admin view is not enabled.
export const KEY_STORAGE = 'hcdp-admin-key'

const readKey = () => { try { return window.sessionStorage.getItem(KEY_STORAGE) || '' } catch { return '' } }
const writeKey = (k) => { try { if (k) window.sessionStorage.setItem(KEY_STORAGE, k); else window.sessionStorage.removeItem(KEY_STORAGE) } catch { /* no storage */ } }

const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso || '' : d.toLocaleString('en-US', { timeZone: 'Pacific/Honolulu', dateStyle: 'medium', timeStyle: 'short' }) }
const query = (f) => { const p = new URLSearchParams(); for (const k of ['kind', 'feature', 'status']) if (f[k]) p.set(k, f[k]); const s = p.toString(); return s ? `?${s}` : '' }
const NO_FILTERS = { kind: '', feature: '', status: '' }

async function saveBlob(r, filename) {
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Filter({ label, value, options, onChange, testid }) {
  return (
    <label className="flex flex-col gap-1 text-[12px] font-medium uppercase tracking-wide text-subtle">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid}
        className="min-h-9 rounded-md border border-border bg-card px-2 text-[13px] normal-case tracking-normal text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11">
        <option value="">All</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  )
}

function Said({ r }) {
  const w = r.wanted && typeof r.wanted === 'object' ? r.wanted : null
  return (
    <div className="space-y-1">
      {r.kind === 'thumbs' && <span className={cn('mr-1 font-mono text-[12px]', r.rating === 'up' ? 'text-success' : 'text-destructive')} data-testid="admin-rating">{r.rating === 'up' ? '▲ up' : '▼ down'}</span>}
      {r.quote && <p className="border-l-[3px] border-[#e8b84b] pl-2 italic" data-testid="admin-quote">“{r.quote}”</p>}
      {r.text && <p data-testid="admin-text">{r.text}</p>}
      {(r.ask || r.reply) && (
        <p className="text-subtle" data-testid="admin-exchange" title={r.reply || undefined}>
          {r.ask && <>“{r.ask}”</>}{r.ask && r.reply && ' → '}{r.reply && <>{clip(r.reply, 180)}</>}
        </p>
      )}
      {w && <p data-testid="admin-wanted"><span className="text-subtle">Wanted </span>{w.url ? <>{w.title || w.url} <span className="font-mono text-xs text-subtle">{w.url}</span></> : <span className="italic">“{w.text}”</span>}</p>}
      {r.chose_path && <p className="text-subtle" data-testid="admin-chose">Went to instead <span className="font-mono text-xs">{r.chose_path}</span></p>}
    </div>
  )
}

function NoteCell({ row, onSave }) {
  const [text, setText] = useState(row.admin_note || '')
  const [state, setState] = useState('idle')   // 'idle' | 'saving' | 'saved' | 'error'
  useEffect(() => { setText(row.admin_note || '') }, [row.admin_note])
  const dirty = text.trim() !== (row.admin_note || '').trim()
  const save = async () => {
    setState('saving')
    const ok = await onSave(row.id, { admin_note: text.trim() })
    setState(ok ? 'saved' : 'error')
    if (ok) setTimeout(() => setState('idle'), 1500)
  }
  return (
    <div className="flex min-w-[12rem] flex-col gap-1">
      <textarea value={text} onChange={(e) => { setText(e.target.value.slice(0, 2000)); if (state !== 'idle') setState('idle') }} rows={2} aria-label="Team note"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && dirty) save() }}
        placeholder="Team note…" data-testid="admin-note" className="w-full resize-y rounded-md border border-border bg-card px-2 py-1 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      {(dirty || state !== 'idle') && (
        <div className="flex items-center gap-2 text-[12px]">
          {dirty && <button type="button" onClick={save} disabled={state === 'saving'} className="rounded border border-border px-2 py-0.5 hover:bg-muted [@media(pointer:coarse)]:min-h-11" data-testid="admin-note-save">{state === 'saving' ? 'Saving…' : 'Save note'}</button>}
          {state === 'saved' && <span className="text-success" role="status">Saved</span>}
          {state === 'error' && <span className="text-destructive" role="alert">Not saved</span>}
        </div>
      )}
    </div>
  )
}

function BacklogButton({ row }) {
  const [state, setState] = useState('idle')
  const copy = async () => {
    const ok = await copyText(backlogEntry(row).command)
    setState(ok ? 'copied' : 'failed')
    setTimeout(() => setState('idle'), 2000)
  }
  return (
    <button type="button" onClick={copy} title={BACKLOG_TIP} aria-label={`Add to backlog: ${BACKLOG_TIP}`} data-testid="admin-backlog"
      className="inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-md border border-border px-2 text-[12px] hover:bg-muted [@media(pointer:coarse)]:min-h-11">
      <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Add to backlog'}
    </button>
  )
}

function Counts({ counts }) {
  if (!counts) return null
  const st = counts.by_status || {}
  const th = counts.thumbs || {}
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]" data-testid="admin-counts">
      <span><span className="font-medium">{counts.total}</span> {counts.total === 1 ? 'item' : 'items'}</span>
      <span className="text-subtle">{STATUSES.map((s) => `${s.label} ${st[s.id] || 0}`).join(' · ')}</span>
      <span className="font-mono text-[12px]" data-testid="admin-thumbs"><span className="text-success">▲ {th.up || 0}</span><span className="px-1 text-subtle">·</span><span className="text-destructive">▼ {th.down || 0}</span></span>
      <span className="text-subtle">{KINDS.filter((k) => counts.by_kind?.[k.id]).map((k) => `${k.label} ${counts.by_kind[k.id]}`).join(' · ')}</span>
    </div>
  )
}

export default function AdminFeedback() {
  const [key, setKey] = useState(readKey)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('idle')   // 'idle' | 'loading' | 'ready' | 'unauthorised' | 'disabled' | 'error'
  const [filters, setFilters] = useState(NO_FILTERS)
  const [data, setData] = useState(null)         // { count, counts, rows }
  const [problem, setProblem] = useState('')

  const fail = (code) => { setStatus(code === 401 ? 'unauthorised' : code === 404 ? 'disabled' : 'error'); if (code === 401) writeKey('') }
  const load = useCallback(async (k, f) => {
    if (!k) { setStatus('idle'); return }
    setStatus((s) => (s === 'ready' ? s : 'loading'))
    try {
      const r = await fetch(`/api/admin/feedback/review${query(f)}`, { headers: { 'X-Admin-Key': k }, cache: 'no-store' })
      if (!r.ok) { fail(r.status); return }
      setData(await r.json())
      setStatus('ready')
      writeKey(k)
    } catch { setStatus('error') }
  }, [])
  useEffect(() => { load(key, filters) }, [key, filters, load])

  const patch = useCallback(async (id, body) => {
    try {
      const r = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'X-Admin-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) { if (r.status === 401) fail(401); setProblem('That change was not saved. Try again.'); return false }
      const d = await r.json()
      setProblem('')
      setData((cur) => {
        if (!cur) return cur
        const before = cur.rows.find((x) => x.id === id)
        // the counts follow a status change at once (they cover the whole store, not the filtered rows)
        let counts = cur.counts
        if (counts && before && d.row?.status && before.status !== d.row.status) {
          const st = { ...(counts.by_status || {}) }
          st[before.status] = Math.max(0, (st[before.status] || 0) - 1)
          st[d.row.status] = (st[d.row.status] || 0) + 1
          if (!st[before.status]) delete st[before.status]
          counts = { ...counts, by_status: st }
        }
        return { ...cur, counts, rows: cur.rows.map((x) => (x.id === id ? { ...x, ...d.row } : x)) }
      })
      return true
    } catch { setProblem('That change was not saved. Try again.'); return false }
  }, [key])

  // 15 Oct: an entry can be removed for good (smoke-test and sample rows) — DELETE with the key, after a confirm.
  const remove = useCallback(async (id) => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('Delete this feedback entry for good?')) return false
    try {
      const r = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'X-Admin-Key': key } })
      if (!r.ok) { if (r.status === 401) fail(401); setProblem('That entry was not deleted. Try again.'); return false }
      setProblem('')
      setData((cur) => {
        if (!cur) return cur
        const before = cur.rows.find((x) => x.id === id)
        let counts = cur.counts
        if (counts && before) {
          const st = { ...(counts.by_status || {}) }
          const was = before.status || 'new'
          st[was] = Math.max(0, (st[was] || 0) - 1)
          if (!st[was]) delete st[was]
          counts = { ...counts, by_status: st, total: Math.max(0, (counts.total || 1) - 1) }
        }
        return { ...cur, counts, rows: cur.rows.filter((x) => x.id !== id) }
      })
      return true
    } catch { setProblem('That entry was not deleted. Try again.'); return false }
  }, [key])

  const download = async (url, filename) => {
    try {
      const r = await fetch(url, { headers: { 'X-Admin-Key': key }, cache: 'no-store' })
      if (!r.ok) { fail(r.status); return }
      await saveBlob(r, filename)
    } catch { setStatus('error') }
  }

  const askKey = status === 'idle' || status === 'unauthorised' || status === 'error'
  const rows = data?.rows || []
  return (
    <article className="mx-auto w-full max-w-7xl px-4 py-8 sm:py-10" data-testid="admin-feedback">
      <header>
        <h1 className="font-display text-2xl sm:text-3xl">Feedback review</h1>
        <p className="mt-2 max-w-3xl text-sm text-subtle">What the HCDP team’s reviewers said about the site — thumbs on AI answers and overviews, notes on selected passages, the Give feedback tab — and the visitors’ “Wrong page?” reports. Admin only; nothing about anyone’s connection is stored.</p>
      </header>
      {status === 'disabled' && <p className="mt-6 rounded-md border border-border bg-surface p-4 text-sm" role="status" data-testid="admin-disabled">The admin view is not enabled on this instance (no ADMIN_KEY is set).</p>}
      {askKey && (
        <form className="mt-6 flex max-w-md flex-col gap-2" onSubmit={(e) => { e.preventDefault(); setKey(draft.trim()) }} data-testid="admin-key-form">
          <label htmlFor="admin-key" className="text-sm font-medium">Admin key</label>
          <div className="flex gap-2">
            <input id="admin-key" type="password" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="admin-key" />
            <button type="submit" className="hcdp-send inline-flex min-h-11 items-center gap-1.5 rounded-md px-4 text-sm font-medium text-accent-foreground" data-testid="admin-key-submit"><KeyRound className="h-4 w-4" aria-hidden="true" /> Open</button>
          </div>
          {status === 'unauthorised' && <p className="text-sm text-destructive" role="alert" data-testid="admin-unauthorised">Not authorised</p>}
          {status === 'error' && <p className="text-sm text-destructive" role="alert">The list could not be loaded. Try again.</p>}
        </form>
      )}
      {status === 'loading' && <p className="mt-6 text-sm text-subtle" role="status">Loading…</p>}
      {status === 'ready' && data && (
        <section className="mt-6 space-y-3" aria-label="Feedback">
          <Counts counts={data.counts} />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
              <Filter label="Kind" value={filters.kind} options={KINDS} onChange={(v) => setFilters((f) => ({ ...f, kind: v }))} testid="admin-filter-kind" />
              <Filter label="Feature" value={filters.feature} options={FEATURES} onChange={(v) => setFilters((f) => ({ ...f, feature: v }))} testid="admin-filter-feature" />
              <Filter label="Status" value={filters.status} options={STATUSES} onChange={(v) => setFilters((f) => ({ ...f, status: v }))} testid="admin-filter-status" />
              {(filters.kind || filters.feature || filters.status) && <button type="button" onClick={() => setFilters(NO_FILTERS)} className="min-h-9 rounded-md px-2 text-sm text-subtle hover:text-foreground [@media(pointer:coarse)]:min-h-11" data-testid="admin-filter-clear">Clear filters</button>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => download(`/api/admin/feedback/review.csv${query(filters)}`, 'hcdp-feedback-review.csv')} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-muted [@media(pointer:coarse)]:min-h-11" data-testid="admin-export"><Download className="h-4 w-4" aria-hidden="true" /> Export CSV</button>
              <button type="button" onClick={() => download('/api/admin/feedback/evals.json', 'hcdp-feedback-eval-cases.json')} title="The 👎 and “Wrong page?” rows that named a page, as navigator test cases shaped like backend/data/usecases.json entries" className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-muted [@media(pointer:coarse)]:min-h-11" data-testid="admin-evals"><FileJson className="h-4 w-4" aria-hidden="true" /> Export as eval cases</button>
              <button type="button" onClick={() => { writeKey(''); setKey(''); setDraft(''); setData(null); setStatus('idle') }} className="min-h-9 rounded-md px-2 text-sm text-subtle hover:text-foreground [@media(pointer:coarse)]:min-h-11" data-testid="admin-forget">Forget key</button>
            </div>
          </div>
          <p className="text-sm" data-testid="admin-count"><span className="font-medium">{data.count}</span> {data.count === 1 ? 'row' : 'rows'} shown{(filters.kind || filters.feature || filters.status) ? ' (filtered)' : ''}</p>
          {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1100px] border-collapse text-left text-[13px]" data-testid="admin-table">
              <thead className="bg-surface text-xs uppercase tracking-wide text-subtle">
                <tr>{['When', 'Kind', 'Feature', 'Page', 'What was said', 'Reviewer', 'Status', 'Team note', ''].map((h, i) => <th key={h || i} scope="col" className="px-3 py-2 font-medium">{h || <span className="sr-only">Actions</span>}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-subtle">Nothing here yet.</td></tr>}
                {rows.map((r) => (
                  <tr key={r.id} className="align-top" data-testid="admin-row" data-kind={r.kind}>
                    <td className="whitespace-nowrap px-3 py-2 text-subtle">{when(r.created_at)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{KIND_LABEL[r.kind] || r.kind}</td>
                    <td className="whitespace-nowrap px-3 py-2">{FEATURE_LABEL[r.feature] || r.feature || '—'}</td>
                    <td className="min-w-[13rem] max-w-[16rem] px-3 py-2">{r.page_title && <span className="block">{r.page_title}</span>}<span className="break-words font-mono text-xs text-subtle [overflow-wrap:anywhere]">{r.page_path || '—'}</span></td>
                    <td className="max-w-[28rem] px-3 py-2"><Said r={r} /></td>
                    <td className="whitespace-nowrap px-3 py-2">{r.reviewer_name || <span className="text-subtle">—</span>}</td>
                    <td className="px-3 py-2">
                      <select value={r.status || 'new'} onChange={(e) => patch(r.id, { status: e.target.value })} aria-label="Status" data-testid="admin-status"
                        className="min-h-8 rounded-md border border-border bg-card px-1.5 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11">
                        {STATUSES.map((s) => <option key={s.id} value={s.id}>{STATUS_LABEL[s.id]}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2"><NoteCell row={r} onSave={patch} /></td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <BacklogButton row={r} />
                        <button type="button" onClick={() => remove(r.id)} title="Delete this entry for good" aria-label="Delete this entry for good" data-testid="admin-delete"
                          className="inline-flex min-h-8 items-center gap-1 rounded border border-border px-2 text-[12.5px] text-subtle hover:border-destructive hover:text-destructive [@media(pointer:coarse)]:min-h-11">
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </article>
  )
}
