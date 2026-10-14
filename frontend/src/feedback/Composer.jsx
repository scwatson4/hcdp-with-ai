import { useEffect, useId, useRef, useState } from 'react'
import { Pencil, ThumbsDown, X } from 'lucide-react'
import { useFeedback } from './FeedbackProvider'
import { EXCHANGE_FEATURES, FEATURES, FEATURE_LABEL, LIMITS, clip } from './features'
import { exchangeFields } from './exchange'
import { showRange } from './highlight'
import { cn } from '../lib/utils'

// F2 A: the composer. In order: the quoted selection (if any); the page (path + title, editable); the last question and
// answer, attached automatically when the feedback is about an answer, a navigation result or an overview (shown,
// removable); after a 👎 the page that was wanted (removable); the feature picker; the free text (required); the
// reviewer's name (F4 A: remembered in this browser — said under the field); Send. Ctrl/⌘ + Enter sends too.
export const NAME_NOTE = 'Remembered in this browser (local storage) for the review period — the one exception to “nothing stored”, made for reviewers. Leave it empty to send anonymously.'

function Removable({ label, onRemove, testid }) {
  return (
    <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} data-testid={testid}
      className="-mr-1 -mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded text-subtle hover:bg-muted hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
      <X className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  )
}

const box = 'rounded-md border border-border bg-surface px-3 py-2 text-[13px]'
const field = 'w-full rounded-md border border-border bg-card px-3 text-[14px] text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function Composer({ draft, narrow = false }) {
  const fb = useFeedback()
  const uid = useId().replace(/:/g, '')
  const [feature, setFeature] = useState(draft.feature || 'other')
  const [quote, setQuote] = useState(draft.quote || '')
  const [page, setPage] = useState(draft.page || { path: '', title: '' })
  const [editingPage, setEditingPage] = useState(false)
  const [exchangeOn, setExchangeOn] = useState(true)
  const [wanted, setWanted] = useState(draft.wanted || null)
  const [text, setText] = useState(draft.text || '')
  const [name, setName] = useState(fb.name || '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const textRef = useRef(null)

  // the quoted passage stays marked on the page while the composer holds it
  useEffect(() => (quote && draft.range ? showRange(draft.range) : undefined), [quote, draft.range])
  useEffect(() => { fb.rememberText(text) }, [text, fb])
  useEffect(() => {
    if (narrow) return   // phones: no keyboard until the reviewer taps the field
    const t = setTimeout(() => textRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [narrow])

  const ex = draft.exchange
  const showExchange = !!ex && exchangeOn && EXCHANGE_FEATURES.has(feature)
  const canSend = text.trim().length > 0 && !sending

  const send = async (e) => {
    e?.preventDefault()
    if (!canSend) { if (!text.trim()) { setError('Say what you think in the feedback box first.'); textRef.current?.focus() } return }
    setSending(true); setError('')
    let path = String(page.path || '').trim()
    if (path && !path.startsWith('/')) path = `/${path}`
    const item = {
      kind: draft.kind, rating: draft.kind === 'thumbs' ? (draft.rating || 'down') : null, feature,
      page: { path: clip(path, LIMITS.path), title: clip(page.title, LIMITS.title) },
      quote: quote ? clip(quote, LIMITS.quote) : null,
      ...(showExchange ? exchangeFields(ex) : { ask: null, reply: null, overview_id: null }),
      wanted: wanted ? (wanted.url ? { title: wanted.title || null, url: wanted.url } : { text: clip(wanted.text, LIMITS.wanted) }) : null,
      text: clip(text, LIMITS.text),
    }
    try {
      await fb.submit(item, name)
    } catch (err) {
      setError(err?.message || 'Your feedback could not be sent. Your words are still here — try again.')
      setSending(false)
    }
  }

  return (
    <form onSubmit={send} className="flex min-h-0 flex-1 flex-col" data-testid="feedback-composer" data-kind={draft.kind} noValidate>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {draft.kind === 'thumbs' && (
          <p className="flex items-start gap-2 text-[13px] text-subtle" data-testid="composer-thumbs-note">
            <ThumbsDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" fill="currentColor" aria-hidden="true" />
            <span>You flagged this {FEATURE_LABEL[draft.feature] || 'answer'}. Tell the team what was wrong.</span>
          </p>
        )}
        {quote && (
          <figure className="flex items-start gap-2" data-testid="composer-quote">
            <blockquote className="min-w-0 flex-1 border-l-[3px] border-[#e8b84b] pl-2.5 text-[13px] italic leading-relaxed text-foreground/85">“{quote}”</blockquote>
            <Removable label="the quote" onRemove={() => setQuote('')} testid="composer-quote-remove" />
          </figure>
        )}
        <section aria-labelledby={`${uid}-page`} data-testid="composer-page">
          <div className="flex items-center justify-between gap-2">
            <h3 id={`${uid}-page`} className="text-[12px] font-medium uppercase tracking-wide text-subtle">Page</h3>
            <button type="button" onClick={() => setEditingPage((v) => !v)} aria-expanded={editingPage} data-testid="composer-page-edit"
              className="inline-flex items-center gap-1 rounded px-1.5 text-[12px] text-subtle hover:text-foreground [@media(pointer:coarse)]:min-h-11">
              <Pencil className="h-3 w-3" aria-hidden="true" />{editingPage ? 'Done' : 'Edit'}
            </button>
          </div>
          {editingPage ? (
            <div className="mt-1.5 space-y-2">
              <label className="block text-[12px] text-subtle">Title
                <input value={page.title} onChange={(e) => setPage((p) => ({ ...p, title: e.target.value.slice(0, LIMITS.title) }))} className={cn(field, 'mt-0.5 min-h-10')} data-testid="composer-page-title" />
              </label>
              <label className="block text-[12px] text-subtle">Address
                <input value={page.path} onChange={(e) => setPage((p) => ({ ...p, path: e.target.value.slice(0, LIMITS.path) }))} className={cn(field, 'mt-0.5 min-h-10 font-mono text-[12.5px]')} data-testid="composer-page-path" />
              </label>
            </div>
          ) : (
            <p className={cn(box, 'mt-1')} data-testid="composer-page-shown">
              <span className="font-medium">{page.title || 'Untitled page'}</span>
              <span className="block truncate font-mono text-[12px] text-subtle">{page.path || '/'}</span>
            </p>
          )}
        </section>
        {showExchange && (
          <section className={cn(box, 'space-y-1')} aria-label="Attached automatically" data-testid="composer-exchange">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] font-medium uppercase tracking-wide text-subtle">Attached automatically</span>
              <Removable label="the question and answer" onRemove={() => setExchangeOn(false)} testid="composer-exchange-remove" />
            </div>
            {ex.ask && <p data-testid="composer-ask"><span className="text-subtle">You asked </span>“{clip(ex.ask, 160)}”</p>}
            {ex.reply && <p data-testid="composer-reply"><span className="text-subtle">The AI said </span>“{clip(ex.reply, 220)}”</p>}
            {ex.overview && <p data-testid="composer-overview"><span className="text-subtle">AI Overview </span>“{clip(ex.overview, 220)}”</p>}
          </section>
        )}
        {wanted && (
          <section className={cn(box, 'flex items-start justify-between gap-2')} aria-label="The page you wanted" data-testid="composer-wanted">
            <p className="min-w-0">
              <span className="text-subtle">You wanted </span>
              {wanted.url ? <><span className="font-medium">{wanted.title || wanted.url}</span><span className="block truncate font-mono text-[12px] text-subtle">{wanted.url}</span></> : <span className="italic">“{wanted.text}”</span>}
            </p>
            <Removable label="the wanted page" onRemove={() => setWanted(null)} testid="composer-wanted-remove" />
          </section>
        )}
        <fieldset data-testid="composer-features">
          <legend className="text-[12px] font-medium uppercase tracking-wide text-subtle">What is it about?</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {FEATURES.map((f) => (
              <label key={f.id} className="relative">
                <input type="radio" name={`${uid}-feature`} value={f.id} checked={feature === f.id} onChange={() => setFeature(f.id)} className="peer sr-only" data-testid="composer-feature" />
                <span className={cn('inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-[12.5px] font-medium shadow-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring [@media(pointer:coarse)]:h-11',
                  feature === f.id ? 'border-foreground bg-foreground text-canvas' : 'border-border bg-card text-foreground hover:border-foreground')}>{f.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor={`${uid}-text`} className="text-[12px] font-medium uppercase tracking-wide text-subtle">Your feedback <span className="normal-case tracking-normal">(required)</span></label>
          <textarea id={`${uid}-text`} ref={textRef} value={text} onChange={(e) => { setText(e.target.value.slice(0, LIMITS.text)); if (error) setError('') }} rows={4} required aria-required="true"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e) }}
            placeholder="Type your feedback here…" data-testid="composer-text" className={cn(field, 'mt-1 resize-y py-2 leading-relaxed')} />
          <p className="mt-0.5 text-right text-[12px] text-subtle" aria-hidden="true">{text.length}/{LIMITS.text}</p>
        </div>
        <div>
          <label htmlFor={`${uid}-name`} className="text-[12px] font-medium uppercase tracking-wide text-subtle">Your name</label>
          <input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value.slice(0, LIMITS.name))} autoComplete="name" placeholder="For example, Ikaika"
            aria-describedby={`${uid}-name-note`} data-testid="composer-name" className={cn(field, 'mt-1 min-h-10')} />
          <p id={`${uid}-name-note`} className="mt-1 text-[12px] leading-snug text-subtle" data-testid="composer-name-note">{NAME_NOTE}</p>
        </div>
        {error && <p role="alert" className="text-[13px] text-destructive" data-testid="composer-error">{error}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <button type="button" onClick={() => fb.closePanel()} className="min-h-10 rounded-md px-3 text-[13px] text-subtle hover:bg-muted hover:text-foreground [@media(pointer:coarse)]:min-h-11" data-testid="composer-cancel">Cancel</button>
        <button type="submit" disabled={!canSend} aria-disabled={!canSend} className="hcdp-send min-h-10 rounded-md px-5 text-[13px] font-medium text-accent-foreground disabled:opacity-40 [@media(pointer:coarse)]:min-h-11" data-testid="composer-send">
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  )
}
