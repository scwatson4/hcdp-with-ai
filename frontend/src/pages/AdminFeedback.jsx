import { useCallback, useEffect, useState } from 'react'
import { Download, KeyRound } from 'lucide-react'

// P4 A (13 Oct): the admin's view of the "Wrong page?" reports. Not linked from anywhere — type /admin/feedback. It
// asks for the admin key (a password field; sent as X-Admin-Key, kept in sessionStorage for this tab only), then
// lists the reports newest first — when, ask, reply, destination, wanted, chose instead — with a count and an
// "Export CSV" button (GET /api/admin/feedback.csv with the header, saved as a file). A wrong key says "Not
// authorised"; an instance without ADMIN_KEY (the API answers 404) says the admin view is not enabled.
export const KEY_STORAGE = 'hcdp-admin-key'

const readKey = () => { try { return window.sessionStorage.getItem(KEY_STORAGE) || '' } catch { return '' } }
const writeKey = (k) => { try { if (k) window.sessionStorage.setItem(KEY_STORAGE, k); else window.sessionStorage.removeItem(KEY_STORAGE) } catch { /* no storage */ } }

const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso || '' : d.toLocaleString('en-US', { timeZone: 'Pacific/Honolulu', dateStyle: 'medium', timeStyle: 'short' }) }

export default function AdminFeedback() {
  const [key, setKey] = useState(readKey)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('idle')   // 'idle' | 'loading' | 'ready' | 'unauthorised' | 'disabled' | 'error'
  const [data, setData] = useState(null)

  const load = useCallback(async (k) => {
    if (!k) { setStatus('idle'); return }
    setStatus('loading')
    try {
      const r = await fetch('/api/admin/feedback', { headers: { 'X-Admin-Key': k }, cache: 'no-store' })
      if (r.status === 404) { setStatus('disabled'); return }
      if (r.status === 401) { setStatus('unauthorised'); writeKey(''); return }
      if (!r.ok) { setStatus('error'); return }
      setData(await r.json())
      setStatus('ready')
      writeKey(k)
    } catch { setStatus('error') }
  }, [])
  useEffect(() => { load(key) }, [key, load])

  const exportCsv = async () => {
    try {
      const r = await fetch('/api/admin/feedback.csv', { headers: { 'X-Admin-Key': key }, cache: 'no-store' })
      if (!r.ok) { setStatus(r.status === 401 ? 'unauthorised' : r.status === 404 ? 'disabled' : 'error'); return }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'hcdp-wrong-page-feedback.csv'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setStatus('error') }
  }

  const askKey = status === 'idle' || status === 'unauthorised' || status === 'error'
  return (
    <article className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10" data-testid="admin-feedback">
      <header>
        <h1 className="font-display text-2xl sm:text-3xl">Wrong-page feedback</h1>
        <p className="mt-2 max-w-3xl text-sm text-subtle">What visitors said they wanted when the assistant opened the wrong page, and where they went next. Admin only; nothing about the visitors is stored.</p>
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
        <section className="mt-6" aria-label="Reports">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm" data-testid="admin-count"><span className="font-medium">{data.count}</span> {data.count === 1 ? 'report' : 'reports'}{data.rows.length < data.count ? ` (newest ${data.rows.length} shown)` : ''}</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={exportCsv} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-muted [@media(pointer:coarse)]:min-h-11" data-testid="admin-export"><Download className="h-4 w-4" aria-hidden="true" /> Export CSV</button>
              <button type="button" onClick={() => { writeKey(''); setKey(''); setDraft(''); setData(null); setStatus('idle') }} className="min-h-9 rounded-md px-2 text-sm text-subtle hover:text-foreground [@media(pointer:coarse)]:min-h-11" data-testid="admin-forget">Forget key</button>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[880px] border-collapse text-left text-[13px]" data-testid="admin-table">
              <thead className="bg-surface text-xs uppercase tracking-wide text-subtle">
                <tr>{['When', 'Ask', 'Reply', 'Destination', 'Wanted', 'Chose instead'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-subtle">No reports yet.</td></tr>}
                {data.rows.map((r) => (
                  <tr key={r.id} className="align-top" data-testid="admin-row">
                    <td className="whitespace-nowrap px-3 py-2 text-subtle">{when(r.created_at)}</td>
                    <td className="px-3 py-2">{r.ask}</td>
                    <td className="px-3 py-2 text-subtle">{r.reply}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.destination}</td>
                    <td className="px-3 py-2">{r.wanted_url ? <>{r.wanted_title || r.wanted_url} <span className="font-mono text-xs text-subtle">{r.wanted_url}</span></> : <span className="italic">“{r.wanted_text}”</span>}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.chose_path || <span className="font-sans not-italic text-subtle">—</span>}</td>
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
