import { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ExternalLink, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useFeedbackOptional } from './FeedbackProvider'
import { answerExchange, overviewExchange, registerExchange } from './exchange'
import { LIMITS } from './features'
import { cn } from '../lib/utils'

// F1 A: 👍 / 👎 on every AI answer (the landing card, the docked dropdown) and at the end of every AI overview, next to
// "Wrong page?". Small and quiet: two 28 px icon buttons (44 px on coarse pointers) in the subtle grey, at the LEFT of the
// last row (where chat answers keep theirs; the right edge belongs to the Give feedback tab and Back to top). 👍 is one tap —
// the exchange is stored and a toast says "Thanks". 👎 (F5 A) first unfolds "Which page did you want?" — the answer's
// alternatives as rows, then "Other…" with a line of text, and "Skip" when the complaint is not about the page — and then
// opens the composer with the chosen page attached.

/** "Which page did you want?": the 👎 chooser, drawn like the overview's "Wrong page?" chooser (P4 A). */
export function WantedChooser({ alternatives = [], onPick, onSkip, className }) {
  const qid = useId().replace(/:/g, '')
  const [other, setOther] = useState(false)
  const [text, setText] = useState('')
  const rows = alternatives.filter((a) => a && a.url && a.title)
  const next = (e) => { e?.preventDefault(); const t = text.trim(); if (t) onPick?.({ text: t }) }
  return (
    <div className={cn('rounded-lg border border-border bg-surface/60 p-3 text-left text-foreground', className)} role="group" aria-labelledby={qid} data-testid="thumbs-chooser" data-feedback-ui="">
      <p id={qid} className="text-[13px] font-medium">Which page did you want?</p>
      <ul className="mt-2 divide-y divide-border rounded-md border border-border bg-card" aria-label="Pages you may have wanted">
        {rows.map((a) => (
          <li key={a.url}>
            <button type="button" onClick={() => onPick?.({ title: a.title, url: a.url })} data-testid="thumbs-chooser-row"
              className="flex min-h-9 w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[13px] hover:bg-muted [@media(pointer:coarse)]:min-h-11">
              <span className="min-w-0"><span className="font-medium">{a.title}</span>{a.why && <span className="text-subtle"> · {a.why}</span>}</span>
              {!a.url.startsWith('/') && <ExternalLink className="h-3 w-3 shrink-0 text-subtle" aria-label="an HCDP page outside this site" />}
            </button>
          </li>
        ))}
        <li>
          <button type="button" onClick={() => setOther(true)} aria-expanded={other} data-testid="thumbs-chooser-other"
            className="flex min-h-9 w-full items-center px-3 py-1.5 text-left text-[13px] hover:bg-muted [@media(pointer:coarse)]:min-h-11">Other…</button>
        </li>
      </ul>
      {other && (
        <form onSubmit={next} className="mt-2 flex items-stretch gap-2" data-testid="thumbs-chooser-other-form">
          <input type="text" value={text} onChange={(e) => setText(e.target.value.slice(0, LIMITS.wanted))} maxLength={LIMITS.wanted} autoFocus
            placeholder="What were you looking for?" aria-label="What were you looking for?" data-testid="thumbs-chooser-text"
            className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-[13px] text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <button type="submit" disabled={!text.trim()} className="hcdp-send min-h-11 rounded-md px-4 text-[13px] font-medium text-accent-foreground disabled:opacity-40" data-testid="thumbs-chooser-next">Next</button>
        </form>
      )}
      <button type="button" onClick={onSkip} className="mt-2 text-[12px] text-subtle underline-offset-2 hover:text-foreground hover:underline [@media(pointer:coarse)]:min-h-11" data-testid="thumbs-chooser-skip">
        Skip — it is not about the page
      </button>
    </div>
  )
}

const ThumbButton = forwardRef(function ThumbButton({ up, pressed, onClick, what, disabled }, ref) {
  const Icon = up ? ThumbsUp : ThumbsDown
  const label = up ? (pressed ? `You liked ${what}` : `Good — I like ${what}`) : (pressed ? `You flagged ${what}` : `Not right — give feedback on ${what}`)
  return (
    <button ref={ref} type="button" onClick={onClick} disabled={disabled} aria-pressed={pressed} aria-label={label} title={up ? 'Good' : 'Not right'}
      data-testid={up ? 'thumbs-up' : 'thumbs-down'}
      className={cn('grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
        pressed ? (up ? 'text-success' : 'text-destructive') : 'text-subtle hover:text-foreground')}>
      <Icon className="h-3.5 w-3.5" fill={pressed ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
  )
})

/** The pair and the 👎 chooser for one exchange; `after` follows the pair on the row (the overview's "Wrong page?", whose
 *  own chooser then takes the whole width below). */
function ThumbsRow({ feature, exchange, what, after = null, testid }) {
  const fb = useFeedbackOptional()
  const [rated, setRated] = useState(null)   // 'up' | 'down' | null
  const [choosing, setChoosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const downRef = useRef(null)
  if (!fb) return after
  const up = async () => {
    if (rated === 'up' || busy) return
    setBusy(true); setRated('up')
    const ok = await fb.sendThumbUp({ feature, exchange })
    if (!ok) setRated(null)
    setBusy(false)
  }
  const down = () => setChoosing((c) => !c)
  const compose = (wanted) => {
    setChoosing(false); setRated('down')
    fb.openComposer({ kind: 'thumbs', rating: 'down', feature, exchange, wanted: wanted || null, opener: downRef.current })
  }
  return (
    <div data-testid={testid}>
      <div className="flex flex-wrap items-start gap-x-2">
        <div className="-ml-1.5 mt-1 flex shrink-0 items-center gap-0.5 print:hidden" role="group" aria-label={`Feedback on ${what}`} data-testid="thumbs">
          <ThumbButton up pressed={rated === 'up'} onClick={up} what={what} disabled={busy} />
          <ThumbButton ref={downRef} up={false} pressed={rated === 'down' || choosing} onClick={down} what={what} />
        </div>
        {after && <div className="min-w-0 has-[[data-testid=wrong-page-chooser]]:basis-full">{after}</div>}
      </div>
      {choosing && <WantedChooser className="mt-2 print:hidden" alternatives={exchange?.alternatives || []} onPick={compose} onSkip={() => compose(null)} />}
    </div>
  )
}

/** Under an AI answer (AssistantPanel's Conversation: the landing card and the docked dropdown). */
export function AnswerFeedback({ message, ask = '' }) {
  const ref = useRef(null)
  const exchange = useMemo(() => answerExchange(message, ask), [message, ask])
  // a passage selected inside this answer carries its exchange (the selection pill reads it)
  useEffect(() => { const el = ref.current; registerExchange(el?.closest('[data-testid="assistant-bubble"]') || el, exchange) }, [exchange])
  if (!exchange) return null
  return <div ref={ref} className="mt-0.5"><ThumbsRow feature="answer" exchange={exchange} what="this answer" testid="answer-feedback" /></div>
}

/** At the end of an AI overview: the thumbs, then "Wrong page?" (passed in as children) beside them. */
export function OverviewFeedback({ summary, children }) {
  const ref = useRef(null)
  const fb = useFeedbackOptional()
  const exchange = useMemo(() => overviewExchange(summary), [summary])
  useEffect(() => { const el = ref.current; registerExchange(el?.closest('[data-testid="ai-summary"]') || el, exchange) }, [exchange])
  if (!fb || !exchange) return children ?? null
  return (
    <div ref={ref} data-testid="overview-feedback-wrap">
      <ThumbsRow feature="overview" exchange={exchange} what="this overview" after={children} testid="overview-feedback" />
    </div>
  )
}
