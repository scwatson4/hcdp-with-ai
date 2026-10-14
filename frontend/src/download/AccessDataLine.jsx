import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Eye, Loader2, Sparkles } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { fetchPlan, prefillFromPlan } from './planApi'
import DownloadDrawer from './DownloadDrawer'

// The AI line at the top of the Access Data page (gallery D1 D, 13 Oct): one field — "Tell me what the data is for and
// I will tick it" — and Prepare. The sentence goes through the same planner as the drawer; the plan's product, period,
// dates, extents and files pre-tick the Export form below (onPrefill), "Visualize" opens the viewer on the plan's primary
// map, and "Prepare the full package with AI" opens the drawer on the same plan (no second planner call).
export const ACCESS_PLACEHOLDER = 'Tell me what the data is for and I will tick it'

export default function AccessDataLine({ onPrefill, className }) {
  const [text, setText] = useState('')
  const [state, setState] = useState({ kind: 'idle' })   // idle | working | ready | error
  const [drawer, setDrawer] = useState(false)
  const working = state.kind === 'working'
  const submit = async (e) => {
    e?.preventDefault()
    const ask = text.trim()
    if (!ask || working) return
    setState({ kind: 'working', ask })
    try {
      const plan = await fetchPlan({ ask, context: { path: '/data' } })
      const prefill = prefillFromPlan(plan)
      setState({ kind: 'ready', ask, plan, prefill })
      if (prefill) onPrefill?.({ ...prefill, key: Date.now(), ask })
    } catch (err) {
      setState({ kind: 'error', ask, message: err.message })
    }
  }
  return (
    <section aria-label="Ask the AI to tick the Export form" data-testid="access-ai-line" className={cn('relative rounded-lg border border-border bg-card p-3 pl-5 shadow-sm', className)}>
      <span aria-hidden="true" className="hcdp-ai-summary-rule" />
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <input value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} placeholder={ACCESS_PLACEHOLDER} aria-label={ACCESS_PLACEHOLDER} autoComplete="off"
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-canvas px-3 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-11 [@media(pointer:coarse)]:h-11" data-testid="access-ai-input" />
        <Button type="submit" disabled={!text.trim() || working} className="[@media(pointer:coarse)]:h-11" data-testid="access-ai-prepare">
          {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />} Prepare
        </Button>
      </form>
      {working && (
        <p className="mt-2 flex items-center gap-2 text-sm text-subtle" role="status" data-testid="access-ai-working">
          <span className="hcdp-comet-ring hcdp-comet-ring-sm" aria-hidden="true" />Reading your ask and checking what HCDP has…
        </p>
      )}
      {state.kind === 'error' && (
        <Alert variant="destructive" className="mt-2" data-testid="access-ai-error">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>{state.message} The Export form below still works by hand.</AlertDescription>
        </Alert>
      )}
      {state.kind === 'ready' && (
        <div className="mt-3 space-y-2" data-testid="access-ai-result">
          <p className="text-sm leading-relaxed" data-testid="access-ai-reading">{state.plan.reading}</p>
          <p className="text-xs text-subtle" data-testid="access-ai-ticked">{state.prefill ? 'The Export form below is ticked to match — change anything, then download.' : 'Nothing in the Export form matches this; it packages rainfall and temperature maps and their station data.'}</p>
          <div className="flex flex-wrap gap-2">
            {state.plan.primary_view && (
              <Button asChild variant="outline" size="sm"><Link to={state.plan.primary_view} data-testid="access-ai-visualize"><Eye className="h-3.5 w-3.5" aria-hidden="true" />Visualize</Link></Button>
            )}
            {state.plan.items?.some((i) => i.group !== 'report') && (
              <Button size="sm" onClick={() => setDrawer(true)} data-testid="access-ai-package"><Download className="h-3.5 w-3.5" aria-hidden="true" />Prepare the full package with AI</Button>
            )}
          </div>
        </div>
      )}
      <DownloadDrawer open={drawer} onOpenChange={setDrawer} ask={state.ask || text} context={{ path: '/data' }} initialPlan={state.plan || null} />
    </section>
  )
}
