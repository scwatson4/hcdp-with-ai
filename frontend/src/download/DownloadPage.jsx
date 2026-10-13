import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Download, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageShell } from '../pages/content/PageShell'
import { dataRelated } from '../pages/content/contentUtils'
import { HCDP } from '../site/nav'
import DownloadPanel from './DownloadPanel'
import { packagePath, parsePicks } from './planApi'

// /download?ask=…&picks=… — the prepared list as a page of its own (gallery D2 A, 13 Oct), so a list can be shared or
// re-opened: the same DownloadPanel as the drawer, the picks from the address ticking the items they name (else the AI's
// own ticks). Without an ask the page asks for one and sends the visitor to its address.
export default function DownloadPage() {
  const { search } = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(search)
  const ask = (params.get('ask') || '').trim().slice(0, 500)
  const picks = parsePicks(search)
  const [text, setText] = useState('')
  return (
    <PageShell
      title="AI-prepared download"
      icon={Download}
      source={`${HCDP}/data-portal/`}
      sourceLabel="HCDP's data portal (the export these files come from)"
      lead={<p>Say what the data is for; the AI reads it, checks each file against HCDP's listing, and packages what you tick as one zip with a README — with your own HCDP API key.</p>}
      related={dataRelated('/download')}
    >
      {ask ? (
        <DownloadPanel key={ask} ask={ask} initialPicks={picks} context={{ path: '/download' }} page />
      ) : (
        <form className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) navigate(packagePath(text.trim())) }} data-testid="download-page-form">
          <Sparkles className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <input value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} placeholder="What data do you need? For example: rainfall data from Hurricane Lowell" aria-label="What data do you need?" autoComplete="off"
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-canvas px-3 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="download-page-ask" />
          <Button type="submit" disabled={!text.trim()} data-testid="download-page-go">Prepare</Button>
        </form>
      )}
    </PageShell>
  )
}
