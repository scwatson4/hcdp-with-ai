import { Link } from 'react-router-dom'
import { Map, RadioTower, CalendarDays, Globe2, CloudLightning, Wrench, ArrowRight } from 'lucide-react'
import { TOOL_CARDS, ATLASES } from '../site/nav'
import AssistantPanel from '../assistant/AssistantPanel'
import { useAssistant } from '../assistant/AssistantProvider'
import { Card } from '../components/ui/card'

const ICONS = { Map, RadioTower, CalendarDays, Globe2, CloudLightning, Wrench }

const EVENTS = [
  { title: 'Tropical Storm Nolo', when: 'from 22 September 2026', to: '/extreme-events#nolo', tag: 'live tracker' },
  { title: 'Hurricane Lowell', when: '6 to 8 September 2026', to: '/extreme-events#lowell', tag: 'report and viewer' },
  { title: 'Hurricane Lala', when: '14 to 16 August 2026', to: '/extreme-events#lala', tag: 'report' },
  { title: 'Kona Lows', when: '10 to 23 March 2026', to: '/extreme-events#kona-lows', tag: 'two storm viewers' },
]

export default function Landing() {
  const { mode } = useAssistant()
  return (
    <div className="mx-auto w-full max-w-6xl px-4">
      <section className="pt-10 pb-6 text-center">
        <img src="/hcdp_logo.png" alt="HCDP" width="1120" height="150" decoding="async" fetchPriority="high" className="mx-auto mb-5 h-auto w-full max-w-[clamp(320px,40vmin,520px)] opacity-90 dark:hidden" />
        <img src="/hcdp_logo_dark.png" alt="HCDP" width="1120" height="150" decoding="async" className="mx-auto mb-5 hidden h-auto w-full max-w-[clamp(320px,40vmin,520px)] opacity-90 dark:block" />
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Hawaiʻi's climate data, and a guide to it.</h1>
        <p className="mx-auto mt-2 max-w-2xl text-subtle">Maps and downloads of rainfall, temperature, drought and more since 1920; live readings from the Hawaiʻi Mesonet; storm reports; monthly summaries. Tell the assistant what you are looking for and it will take you there.</p>
      </section>

      {mode === 'inline' && (
        <section className="mx-auto max-w-3xl" data-testid="landing-assistant">
          <div className="rounded-xl border border-border bg-card p-2 shadow-sm">
            <AssistantPanel />
          </div>
          <p className="mt-2 text-center text-xs text-subtle">The assistant navigates; it does not analyse data. For numbers, charts and comparisons it will hand you to the HCDP AI interface.</p>
        </section>
      )}

      <section className="mt-12">
        <div className="mb-3 flex items-end justify-between"><h2 className="font-display text-2xl">What HCDP offers</h2><Link to="/tools" className="text-sm text-subtle hover:text-foreground">All climate tools →</Link></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOL_CARDS.map((c) => { const Icon = ICONS[c.icon]; return (
            <Link key={c.key} to={c.to} className="group" data-testid={`tool-${c.key}`}>
              <Card className="h-full p-4 transition-colors hover:border-foreground">
                <div className="mb-2 flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-md bg-accent-soft text-accent"><Icon className="h-4 w-4" aria-hidden="true" /></span><h3 className="font-display text-lg">{c.title}</h3></div>
                <p className="text-sm text-subtle">{c.blurb}</p>
                <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent">Open <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></div>
              </Card>
            </Link>
          ) })}
        </div>
      </section>

      <section className="mt-12 grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="mb-3 font-display text-2xl">Recent extreme events</h2>
          <ul className="space-y-2">
            {EVENTS.map((e) => (
              <li key={e.title}><Link to={e.to} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 hover:border-foreground">
                <span><span className="font-medium">{e.title}</span> <span className="text-subtle">· {e.when}</span></span>
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-subtle">{e.tag}</span>
              </Link></li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-3 font-display text-2xl">Climate atlases</h2>
          <ul className="space-y-2">
            {ATLASES.map((a) => <li key={a.label}><a href={a.external} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 hover:border-foreground"><span className="font-medium">{a.label}</span><span className="text-xs text-subtle">opens the atlas ↗</span></a></li>)}
          </ul>
          <p className="mt-3 text-sm text-subtle">Share any map you make: the address bar always describes exactly what you are looking at, for example <code className="rounded bg-inset px-1 py-0.5 text-xs">/viewer/rainfall/day/2026-09-07/kauai</code>.</p>
        </div>
      </section>
    </div>
  )
}
