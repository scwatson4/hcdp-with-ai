import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Map, RadioTower, CalendarDays, Globe2, CloudLightning, Wrench, ArrowRight, Instagram, Mail, ChevronDown } from 'lucide-react'
import { TOOL_CARDS, SIDEBAR } from '../site/nav'
import AssistantPanel from '../assistant/AssistantPanel'
import { useAssistant } from '../assistant/AssistantProvider'
import { cn } from '../lib/utils'
import { Card } from '../components/ui/card'
import MapBackdrop, { OCEAN, useIsDark } from '../components/MapBackdrop'

const ICONS = { Map, RadioTower, CalendarDays, Globe2, CloudLightning, Wrench }

const EVENTS = [
  { title: 'Tropical Storm Nolo', when: 'from 22 September 2026', to: '/extreme-events#nolo', tag: 'live tracker' },
  { title: 'Hurricane Lowell', when: '6 to 8 September 2026', to: '/extreme-events#lowell', tag: 'report and viewer' },
  { title: 'Hurricane Lala', when: '14 to 16 August 2026', to: '/extreme-events#lala', tag: 'report' },
  { title: 'Kona Lows', when: '10 to 23 March 2026', to: '/extreme-events#kona-lows', tag: 'two storm viewers' },
]

function SidebarHeading({ children }) {
  return <h2 className="font-nav text-[12px] font-bold uppercase tracking-[0.14em] text-subtle">{children}</h2>
}

// Below lg (where the sidebar stacks under the hero) every link is a 44 px row (M3 C / M6 A).
const ROW = 'hover:underline max-lg:flex max-lg:min-h-11 max-lg:items-center'
function ExtLink({ href, children }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={ROW}>{children}<span className="sr-only"> (opens in a new tab)</span></a>   /* no arrow boxes beside the links (13 Oct) */
}

// The portal's home-page sidebar, as on www.hawaii.edu/climate-data-portal.
// M3 C (14 Oct): where it stacks under the hero (below lg — every phone) the portal's five buttons and the AI tool's
// stay right under the hero as 44 px rows, and the resources, social media, How to cite and contact fold into one
// "More from HCDP" accordion row (48 px, closed), so "What HCDP offers" starts a screen higher. On wide screens the
// sidebar is the portal's, open, as before.
export function Sidebar() {
  const [more, setMore] = useState(false)
  const moreId = useId()
  return (
    <aside className="border-t border-border bg-surface px-5 py-5 text-[13px] leading-snug max-lg:py-4 lg:border-l lg:border-t-0" data-testid="landing-sidebar" aria-label="Climate resources and contact">
      <ul className="mb-5 space-y-2 max-lg:mb-3" data-testid="sidebar-buttons">
        {SIDEBAR.buttons.map((b) => {
          const cls = 'block rounded-md border border-black/60 px-3 py-1.5 text-center font-nav text-[12.5px] font-bold uppercase tracking-[0.04em] text-white shadow-sm transition-transform hover:-translate-y-px hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:flex max-lg:min-h-11 max-lg:items-center max-lg:justify-center max-lg:text-[13px] [@media(pointer:coarse)]:flex [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:justify-center'
          if (b.ai) {
            // The AI data analysis tool: not a portal colour — white with the logo's spectrum as a 1.5 px border, dark type (T1 A).
            return <li key={b.label}><a href={b.href} target="_blank" rel="noopener noreferrer" data-testid="sidebar-ai-tool" className="hcdp-rainbow-border block whitespace-nowrap rounded-md px-2 py-1.5 text-center font-nav text-[12px] font-bold uppercase tracking-[0.02em] text-foreground shadow-sm transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:flex max-lg:min-h-11 max-lg:items-center max-lg:justify-center max-lg:text-[13px] [@media(pointer:coarse)]:flex [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:justify-center">{b.label}<span className="sr-only"> (opens in a new tab)</span></a></li>
          }
          return <li key={b.label}>{b.to ? <Link to={b.to} className={cls} style={{ backgroundColor: b.color }}>{b.label}</Link> : <a href={b.href} target="_blank" rel="noopener noreferrer" className={cls} style={{ backgroundColor: b.color }}>{b.label}</a>}</li>
        })}
      </ul>
      <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-controls={moreId} data-testid="landing-more-toggle"
        className="flex h-12 w-full items-center justify-between rounded-md border border-border bg-card px-4 font-nav text-[14px] font-semibold text-foreground shadow-sm hover:border-foreground lg:hidden">
        More from HCDP <ChevronDown className={cn('h-4 w-4 text-subtle transition-transform', more && 'rotate-180')} aria-hidden="true" />
      </button>
      <div id={moreId} className={cn(more ? 'block' : 'hidden', 'max-lg:mt-4 max-lg:px-1 lg:block')} data-testid="landing-more">
        <SidebarHeading>Climate Resources</SidebarHeading>
        <ul className="mt-2 space-y-1.5 max-lg:space-y-0">{SIDEBAR.resources.map((r) => <li key={r.label}><ExtLink href={r.href}>{r.label}</ExtLink></li>)}</ul>
        <SidebarHeading><span className="mt-6 block">Social Media</span></SidebarHeading>
        <ul className="mt-2 space-y-1.5 max-lg:space-y-0">{SIDEBAR.social.map((r) => <li key={r.label}><ExtLink href={r.href}><Instagram className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />{r.label}</ExtLink></li>)}</ul>
        <div className="mt-6"><Link to={SIDEBAR.cite.to} className={cn('font-nav text-[12px] font-bold uppercase tracking-[0.14em] text-subtle hover:text-foreground', ROW)}>{SIDEBAR.cite.label}</Link></div>
        <SidebarHeading><span className="mt-6 block">Contact Us</span></SidebarHeading>
        <ul className="mt-2"><li><a href={SIDEBAR.contact.href} className={ROW}><Mail className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />{SIDEBAR.contact.label}</a></li></ul>
      </div>
    </aside>
  )
}

function useHeroOut(ref, setHeroOut) {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const obs = new IntersectionObserver(([entry]) => setHeroOut(!entry.isIntersecting), { rootMargin: '-120px 0px 0px 0px', threshold: 0 })
    obs.observe(el)
    return () => { obs.disconnect(); setHeroOut(false) }
  }, [ref, setHeroOut])
}

export default function Landing() {
  const dark = useIsDark()
  const ocean = `#${dark ? OCEAN.dark : OCEAN.light}`
  const { travel } = useAssistant()   // R1 D: while the bar rides up to the header the hero lifts away
  const assistantRef = useRef(null)
  const { setHeroOut } = useAssistant()
  useHeroOut(assistantRef, setHeroOut)
  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <div className="grid lg:grid-cols-[minmax(0,85fr)_minmax(210px,15fr)] lg:items-start">
        {/* L1 pick B (2026-10-08): no heading over the map — the page's name is an sr-only h1 and the bar
            carries the question itself. The hero is a 45fr / auto / 55fr grid, so the bar's row sits at about
            45 % of the hero's height; a tall answers card still grows the hero as before. */}
        <section className={cn('relative isolate grid min-h-[62vh] grid-rows-[45fr_auto_55fr] overflow-hidden lg:min-h-[70vh]', travel.phase === 'travel' && 'hcdp-hero-lift')} data-testid="landing-hero" data-travel={travel.phase} style={{ background: ocean }}>
          <MapBackdrop />
          {/* L3 pick A: no glow behind the bar any more — the bar's field is frosted glass (hcdp-ask-glass), so the
              islands stay visible around and through it. */}
          <div className="relative z-10 row-start-2 mx-auto w-full max-w-3xl px-4 py-6">
            <h1 className="sr-only">Hawaiʻi Climate Data Portal</h1>
            <div data-testid="landing-assistant" ref={assistantRef}>
              <AssistantPanel glass />
            </div>
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
                <span className="rounded-full border border-border px-2 py-0.5 text-[12px] text-subtle">{e.tag}</span>
              </Link></li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-subtle">Share any map you make: the address bar always describes exactly what you are looking at, for example <code className="rounded bg-inset px-1 py-0.5 text-xs">/viewer/rainfall/day/2026-09-07/kauai</code>.</p>
        </section>
      </div>
    </div>
  )
}
