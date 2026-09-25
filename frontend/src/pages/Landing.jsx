import { Link } from 'react-router-dom'
import { Map, RadioTower, CalendarDays, Globe2, CloudLightning, Wrench, ArrowRight, ExternalLink, Instagram, Mail } from 'lucide-react'
import { TOOL_CARDS, SIDEBAR } from '../site/nav'
import AssistantPanel from '../assistant/AssistantPanel'
import { useAssistant } from '../assistant/AssistantProvider'
import { Card } from '../components/ui/card'
import MapBackdrop from '../components/MapBackdrop'

const ICONS = { Map, RadioTower, CalendarDays, Globe2, CloudLightning, Wrench }

const EVENTS = [
  { title: 'Tropical Storm Nolo', when: 'from 22 September 2026', to: '/extreme-events#nolo', tag: 'live tracker' },
  { title: 'Hurricane Lowell', when: '6 to 8 September 2026', to: '/extreme-events#lowell', tag: 'report and viewer' },
  { title: 'Hurricane Lala', when: '14 to 16 August 2026', to: '/extreme-events#lala', tag: 'report' },
  { title: 'Kona Lows', when: '10 to 23 March 2026', to: '/extreme-events#kona-lows', tag: 'two storm viewers' },
]

function SidebarHeading({ children }) {
  return <h2 className="font-nav text-[11px] font-bold uppercase tracking-[0.14em] text-subtle">{children}</h2>
}

function ExtLink({ href, children }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">{children}<ExternalLink className="h-3 w-3 shrink-0 text-subtle" aria-label="opens in a new tab" /></a>
}

// The portal's home-page sidebar, as on www.hawaii.edu/climate-data-portal.
export function Sidebar() {
  return (
    <aside className="border-t border-border bg-surface px-5 py-6 text-[13px] leading-relaxed lg:border-l lg:border-t-0" data-testid="landing-sidebar" aria-label="Climate resources and contact">
      <SidebarHeading>Climate Resources</SidebarHeading>
      <ul className="mt-2 space-y-1.5">{SIDEBAR.resources.map((r) => <li key={r.label}><ExtLink href={r.href}>{r.label}</ExtLink></li>)}</ul>
      <SidebarHeading><span className="mt-6 block">Social Media</span></SidebarHeading>
      <ul className="mt-2 space-y-1.5">{SIDEBAR.social.map((r) => <li key={r.label}><ExtLink href={r.href}><Instagram className="h-3.5 w-3.5" aria-hidden="true" /> {r.label}</ExtLink></li>)}</ul>
      <div className="mt-6"><Link to={SIDEBAR.cite.to} className="font-nav text-[11px] font-bold uppercase tracking-[0.14em] text-subtle hover:text-foreground hover:underline">{SIDEBAR.cite.label}</Link></div>
      <SidebarHeading><span className="mt-6 block">Contact Us</span></SidebarHeading>
      <ul className="mt-2"><li><a href={SIDEBAR.contact.href} className="inline-flex items-center gap-1 hover:underline"><Mail className="h-3.5 w-3.5" aria-hidden="true" /> {SIDEBAR.contact.label}</a></li></ul>
    </aside>
  )
}

export default function Landing() {
  const { mode, open } = useAssistant()
  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <div className="grid lg:grid-cols-[minmax(0,85fr)_minmax(210px,15fr)]">
        <section className="relative isolate flex min-h-[62vh] items-center overflow-hidden lg:min-h-[70vh]" data-testid="landing-hero">
          <MapBackdrop />
          <div className="relative z-10 mx-auto w-full max-w-3xl px-4 py-12 sm:py-16">
            <h1 className="text-center font-display text-3xl font-semibold tracking-tight sm:text-4xl">What are you looking for?</h1>
            <p className="mx-auto mt-2 max-w-xl text-center text-subtle">Maps, downloads, live stations, storm reports, the monthly summary. Tell the assistant and it takes you there.</p>
            {mode === 'inline' ? (
              <div className="hcdp-rainbow-border mt-6 rounded-xl bg-card/90 p-2 shadow-lg backdrop-blur" data-testid="landing-assistant">
                <AssistantPanel rotateExamples />
              </div>
            ) : (
              <div className="mt-6 text-center"><button type="button" onClick={open} className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">Continue with the assistant</button></div>
            )}
            <p className="mt-2 text-center text-xs text-subtle">The assistant navigates; it does not analyse data. For numbers, charts and comparisons it hands you to the HCDP AI interface.</p>
          </div>
        </section>
        <Sidebar />
      </div>

      <div className="mx-auto w-full max-w-6xl px-4">
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

        <section className="mt-12">
          <h2 className="mb-3 font-display text-2xl">Recent extreme events</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {EVENTS.map((e) => (
              <li key={e.title}><Link to={e.to} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 hover:border-foreground">
                <span><span className="font-medium">{e.title}</span> <span className="text-subtle">· {e.when}</span></span>
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-subtle">{e.tag}</span>
              </Link></li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-subtle">Share any map you make: the address bar always describes exactly what you are looking at, for example <code className="rounded bg-inset px-1 py-0.5 text-xs">/viewer/rainfall/day/2026-09-07/kauai</code>.</p>
        </section>
      </div>
    </div>
  )
}
