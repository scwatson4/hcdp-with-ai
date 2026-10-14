import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, Download, ExternalLink as ExternalIcon, Eye, FileText, KeyRound, Loader2, Mail, Sparkles } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isEmail } from '../pages/content/ExportForm'
import DownloadChecklist from './DownloadChecklist'
import { estimateFor, fetchPlan, formatBytes, packagePath, pickedIds, prepareBody, preparePackage, saveBlob } from './planApi'

// The body of the AI-prepared download, shared by the drawer (DownloadDrawer) and the /download page (DownloadPage):
// loads the plan for an ask (or takes one already made), keeps the picks, shows the checklist, the live totals, the
// package address, the HCDP API key field (required; sent with the prepare request only — never stored or logged), the
// email field, and Download now — or, past 150 files, Email me (gallery D3 A + D5 A, 13 Oct). The result names the file
// and offers the Analyze-with-AI hand-off link; the emailed package gets its README back for saving beside it.
const FIELD = 'h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [@media(pointer:coarse)]:h-11'
const LABEL = 'mb-1 block font-mono text-[12px] font-medium uppercase tracking-wide text-subtle'

function useCopy() {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)
  const copy = useCallback(async (text) => {
    try { await navigator.clipboard.writeText(text); setCopied(true) } catch { setCopied(false) }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return [copied, copy]
}

export default function DownloadPanel({ ask, hints = {}, context = {}, initialPicks = null, initialPlan = null, apiUrl = null, page = false, className }) {
  const [plan, setPlan] = useState(initialPlan && initialPlan.ask === (ask || '').trim() ? initialPlan : null)
  const [status, setStatus] = useState(plan ? 'ready' : 'loading')   // 'loading' | 'ready' | 'error' | 'replanning'
  const [error, setError] = useState(null)
  const [picked, setPicked] = useState(() => (plan ? pickedIds(plan, initialPicks) : new Set()))
  const [apiKey, setApiKey] = useState('')
  const [email, setEmail] = useState('')
  const [prep, setPrep] = useState({ kind: 'idle' })   // idle | working | zip | email | error
  const abortRef = useRef(null)
  const [copied, copy] = useCopy()

  // the plan for this ask (unless one came along)
  useEffect(() => {
    const q = (ask || '').trim()
    if (!q || (plan && plan.ask === q)) return undefined
    const ac = new AbortController()
    abortRef.current?.abort()
    abortRef.current = ac
    setStatus('loading'); setError(null); setPrep({ kind: 'idle' })
    fetchPlan({ ask: q, hints, context, signal: ac.signal })
      .then((p) => { if (ac.signal.aborted) return; setPlan(p); setPicked(pickedIds(p, initialPicks)); setStatus('ready') })
      .catch((e) => { if (ac.signal.aborted || e?.name === 'AbortError') return; setError(e.message); setStatus('error') })
    return () => ac.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask])

  const toggle = useCallback((id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }), [])

  /** "Something else…": re-plan with the extra wish, keeping what is already planned and ticked. */
  const somethingElse = useCallback(async (extra) => {
    if (!plan) return
    setStatus('replanning'); setError(null)
    try {
      const previous = plan.items.filter((i) => i.group === 'grid' || i.group === 'station')
      const next = await fetchPlan({ ask: plan.ask, hints, context, extra, previous })
      setPlan(next)
      setPicked((s) => {
        const ids = new Set(next.items.map((i) => i.id))
        const keep = new Set([...s].filter((id) => ids.has(id)))
        for (const it of next.items) if (it.ticked && !plan.items.some((o) => o.id === it.id)) keep.add(it.id)
        return keep
      })
      setStatus('ready')
    } catch (e) {
      setError(e.message); setStatus('ready')
    }
  }, [plan, hints, context])

  const totals = useMemo(() => (plan ? estimateFor(plan.items, picked) : { files: 0, bytes: 0, overInstant: false }), [plan, picked])
  const path = plan ? packagePath(plan.ask, plan.items.filter((i) => picked.has(i.id)).map((i) => i.id)) : ''
  const address = typeof window !== 'undefined' && path ? `${window.location.origin}${path}` : path
  const dataPicked = plan ? plan.items.some((i) => picked.has(i.id) && (i.group === 'grid' || i.group === 'station')) : false
  const keyOk = apiKey.trim().length >= 8
  const emailOk = isEmail(email)
  const working = prep.kind === 'working'
  const canDownload = dataPicked && keyOk && !working && !totals.overInstant && status === 'ready'
  const canEmail = dataPicked && keyOk && emailOk && !working && status === 'ready'
  const keyLink = plan?.api_url || apiUrl

  const prepare = async () => {
    if (!plan) return
    setPrep({ kind: 'working' })
    try {
      const out = await preparePackage(prepareBody(plan, picked, apiKey.trim(), totals.overInstant || email.trim() ? email : ''))
      if (out.kind === 'email') { setPrep({ kind: 'email', ...out }); return }
      const saved = saveBlob(out.blob, out.filename)
      setPrep({ kind: 'zip', filename: out.filename, size: out.blob.size, files: out.files, saved })
    } catch (e) {
      setPrep({ kind: 'error', message: e.message })
    }
  }
  const saveReadme = () => { if (prep.readme) saveBlob(new Blob([prep.readme], { type: 'text/markdown' }), 'README.md') }

  return (
    <div className={cn('space-y-5', className)} data-testid="download-panel" data-status={status} aria-busy={status === 'loading' || working}>
      {!page && (
        <div className="pr-8">
          <p className="flex items-center gap-1.5 text-[12px] text-subtle"><Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" /><span className="hcdp-ai-words">HCDP AI</span> · prepared download</p>
          <h2 className="mt-1 font-display text-xl" data-testid="download-title">The data you asked for</h2>
        </div>
      )}
      <p className="text-sm text-subtle" data-testid="download-ask">“{(plan?.ask || ask || '').trim()}”</p>

      {status === 'loading' && (
        <p className="flex items-center gap-2 text-sm text-subtle" role="status" data-testid="download-loading">
          <span className="hcdp-comet-ring hcdp-comet-ring-sm" aria-hidden="true" />Reading your ask and checking what HCDP has…
        </p>
      )}
      {status === 'error' && (
        <Alert variant="destructive" data-testid="download-error">
          <AlertTitle>The plan could not be made</AlertTitle>
          <AlertDescription>{error} <Link to="/data#export" className="underline">Tick the Export form yourself</Link> if it keeps failing.</AlertDescription>
        </Alert>
      )}
      {plan && status !== 'loading' && (
        <>
          <DownloadChecklist plan={plan} picked={picked} onToggle={toggle} onSomethingElse={somethingElse} replanning={status === 'replanning'} />
          {error && status === 'ready' && <p className="text-xs text-destructive" data-testid="download-replan-error">{error}</p>}

          <div className="rounded-md bg-inset px-3 py-2 text-sm" data-testid="download-totals">
            <span className="font-medium">{totals.files.toLocaleString('en-US')} file{totals.files === 1 ? '' : 's'} · about {formatBytes(totals.bytes)}.</span>{' '}
            <span className="text-subtle">{totals.overInstant ? `More than the ${plan.instant_max_files || 150} HCDP zips for a direct download — HCDP will email the package.` : `Up to ${plan.instant_max_files || 150} files download at once; larger packages are emailed.`}</span>
            {plan.primary_view && (
              <span className="block pt-1 text-xs">
                <Link to={plan.primary_view} className="inline-flex items-center gap-1 text-accent hover:underline" data-testid="download-view"><Eye className="h-3.5 w-3.5" aria-hidden="true" />Open the map: {plan.primary_view_label || plan.primary_view}</Link>
              </span>
            )}
          </div>

          <div className="text-xs text-subtle" data-testid="download-address-row">
            <span className={LABEL}>Package address</span>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-inset px-2 py-1 font-mono text-[12px]" data-testid="download-address" title={address}>{address}</code>
              <Button type="button" size="sm" variant="outline" onClick={() => copy(address)} aria-label="Copy the package address" data-testid="download-address-copy">
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}{copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="mt-1">Re-open or share this list later; the README in the zip carries it too.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="download-key" className={LABEL}><KeyRound className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden="true" />HCDP API key (required)</label>
              <input id="download-key" type="password" autoComplete="off" spellCheck={false} className={FIELD} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="paste your HCDP API key" data-testid="download-key" />
              <p className="mt-1 text-xs text-subtle" data-testid="download-key-note">
                Sent to HCDP with this one request — never stored or logged by this site. No key yet? Request one{' '}
                {keyLink ? <a href={keyLink} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground" data-testid="download-key-link">here<span className="sr-only"> (opens in a new tab)</span></a> : 'on HCDP’s API page'}.
              </p>
            </div>
            <div>
              <label htmlFor="download-email" className={LABEL}>Email {totals.overInstant ? '(needed: HCDP emails this package)' : '(optional, for HCDP’s log)'}</label>
              <input id="download-email" type="email" autoComplete="email" inputMode="email" className={FIELD} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ikaika@hawaii.edu" data-testid="download-email" />
              <p className="mt-1 text-xs text-subtle">Goes to HCDP only; nothing is kept here.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {totals.overInstant ? (
              <Button type="button" onClick={prepare} disabled={!canEmail} className="[@media(pointer:coarse)]:h-11" data-testid="download-email-me">
                {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />} Email me
              </Button>
            ) : (
              <Button type="button" onClick={prepare} disabled={!canDownload} className="[@media(pointer:coarse)]:h-11" data-testid="download-now">
                {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />} Download now
              </Button>
            )}
            {!dataPicked && <span className="text-xs text-subtle" data-testid="download-problem">Tick at least one map or station file.</span>}
            {dataPicked && !keyOk && <span className="text-xs text-subtle" data-testid="download-problem">Paste your HCDP API key first.</span>}
            {dataPicked && keyOk && totals.overInstant && !emailOk && <span className="text-xs text-subtle" data-testid="download-problem">Add the email address HCDP should send the package to.</span>}
            {plan.analyze_url && (
              <a href={plan.analyze_url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-subtle underline underline-offset-2 hover:text-foreground" data-testid="download-analyze">
                Analyze with AI <ExternalIcon className="h-3 w-3" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </div>
          <p className="text-xs text-subtle">
            You will use the data under HCDP's <a href="https://creativecommons.org/licenses/by-nc-nd/4.0/" target="_blank" rel="noopener noreferrer" className="underline">CC BY-NC-ND 4.0 licence</a> and cite the products (<Link to="/about/how-to-cite" className="underline">How to Cite</Link>); the README says how.
          </p>

          {prep.kind === 'zip' && (
            <Alert role="status" data-testid="download-result">
              <AlertTitle>Downloading</AlertTitle>
              <AlertDescription>
                {prep.saved ? `Your download has started: ${prep.filename} (${formatBytes(prep.size)}${prep.files ? `, ${prep.files.toLocaleString('en-US')} data files` : ''}) — with README.md inside.` : 'The package arrived but this browser would not save it.'}{' '}
                {plan.analyze_url && <a href={plan.analyze_url} target="_blank" rel="noopener noreferrer" className="underline" data-testid="download-result-analyze">Analyze it with AI<span className="sr-only"> (opens in a new tab)</span></a>}
              </AlertDescription>
            </Alert>
          )}
          {prep.kind === 'email' && (
            <Alert role="status" data-testid="download-result">
              <AlertTitle>Request sent</AlertTitle>
              <AlertDescription>
                {prep.message || `HCDP will email a download link to ${prep.email}.`}{' '}
                {prep.readme && <Button type="button" size="sm" variant="outline" className="ml-1 align-middle" onClick={saveReadme} data-testid="download-save-readme"><FileText className="h-3.5 w-3.5" aria-hidden="true" />Save the README</Button>}
              </AlertDescription>
            </Alert>
          )}
          {prep.kind === 'error' && (
            <Alert variant="destructive" data-testid="download-result">
              <AlertTitle>That did not work</AlertTitle>
              <AlertDescription>{prep.message}</AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  )
}
