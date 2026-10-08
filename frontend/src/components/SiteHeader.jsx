import { Link, NavLink, useNavigate } from 'react-router-dom'
import { ChevronDown, ExternalLink, Menu } from 'lucide-react'
import { useState } from 'react'
import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu'
import { NAV } from '../site/nav'
import { cn } from '../lib/utils'
import { OriginalVersionLink, ShareView } from './OriginalLink'

// The portal's header: the logo centred on its own row — with "Share this view" at the row's
// far left and "Original HCDP version" at its far right (item 11), vertically centred with the
// logo — and the menu centred under it in Raleway small caps (tightened: 20 px gaps, 12.5 px
// type). The site is always light — there is no theme toggle. App.jsx keeps the header sticky
// together with the docked ask bar that sits under it on inner pages (R1 D).
function MenuItem({ item }) {
  if (item.external) {
    return (
      <DropdownMenuItem asChild>
        <a href={item.external} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3">
          {item.label} <ExternalLink className="h-3 w-3 text-subtle" aria-label="opens the portal in a new tab" />
        </a>
      </DropdownMenuItem>
    )
  }
  return <DropdownMenuItem asChild><Link to={item.to}>{item.label}</Link></DropdownMenuItem>
}

const NAV_ITEM = 'font-nav text-[12.5px] font-semibold uppercase tracking-[0.06em] text-foreground/80 hover:text-foreground'
// The AI data analysis tool, last in the row: the same letterforms in a pill outlined with the
// logo's spectrum (the two-background 1.5 px border), external like the portal's own links.
const AI_PILL = 'hcdp-rainbow-border inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-foreground hover:shadow-sm'

export default function SiteHeader() {
  const navigate = useNavigate()
  const [mobile, setMobile] = useState(false)
  return (
    <header className="border-b border-border bg-canvas/95 backdrop-blur">
      <div className="hcdp-band" aria-hidden="true" />
      <div className="mx-auto grid w-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pb-1 pt-3" data-testid="logo-row">
        <div className="flex min-w-0 items-center justify-start"><ShareView /></div>
        <Link to="/" aria-label="Hawaiʻi Climate Data Portal home" className="block">
          <img src="/hcdp_logo.png" alt="HCDP — Hawaiʻi Climate Data Portal" width="1120" height="150" decoding="async" fetchPriority="high" className="h-7 w-auto sm:h-[52px]" />
        </Link>
        <div className="flex min-w-0 items-center justify-end gap-1">
          <OriginalVersionLink />
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 md:hidden" aria-label="Menu" aria-expanded={mobile} onClick={() => setMobile((v) => !v)}><Menu className="h-4 w-4" /></Button>
        </div>
      </div>
      {/* Below xl (1280 px) the row is tight (12 px gaps) and the AI pill wears its shorter label, so the eight items keep one
          line from 1024 px up; at 768 px the portal's own seven items already wrapped before the pill existed (measured 2026-10-08). */}
      <nav className="hidden items-center justify-center gap-x-3 px-4 pb-2 md:flex xl:gap-x-5" aria-label="Site">
        {NAV.map((n) => n.items ? (
          <DropdownMenu key={n.label}>
            <DropdownMenuTrigger asChild>
              <button type="button" className={cn(NAV_ITEM, 'inline-flex items-center gap-1 rounded px-1 py-1')}>{n.label} <ChevronDown className="h-3 w-3" aria-hidden="true" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="font-nav font-semibold">{n.items.map((it) => <MenuItem key={it.label} item={it} />)}</DropdownMenuContent>
          </DropdownMenu>
        ) : n.ai ? (
          <a key={n.label} href={n.external} target="_blank" rel="noopener noreferrer" className={cn(NAV_ITEM, AI_PILL)} data-testid="nav-ai-tool">
            <span className="xl:hidden">{n.short}</span><span className="hidden xl:inline">{n.label}</span> <ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : n.external ? (
          <a key={n.label} href={n.external} target="_blank" rel="noopener noreferrer" className={cn(NAV_ITEM, 'rounded px-1 py-1')}>{n.label}</a>
        ) : (
          <NavLink key={n.label} to={n.to} end={n.to === '/'} className={({ isActive }) => cn(NAV_ITEM, 'rounded px-1 py-1', isActive && 'text-foreground underline decoration-2 underline-offset-8')}>{n.label}</NavLink>
        ))}
      </nav>
      {mobile && (
        <div className="border-t border-border px-4 py-2 md:hidden" data-testid="mobile-nav">
          {NAV.map((n) => (
            <div key={n.label} className="py-1">
              {n.items ? <div className="font-nav text-xs font-semibold uppercase tracking-wide text-subtle">{n.label}</div>
                : n.ai ? <a className={cn('font-nav text-sm font-semibold', AI_PILL, 'mt-1 min-h-11')} href={n.external} target="_blank" rel="noopener noreferrer" data-testid="mobile-nav-ai-tool">{n.label} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span></a>
                : n.external ? <a className="font-nav text-sm font-semibold" href={n.external} target="_blank" rel="noopener noreferrer">{n.label} ↗</a>
                : <button type="button" className="font-nav text-sm font-semibold" onClick={() => { setMobile(false); navigate(n.to) }}>{n.label}</button>}
              {n.items && <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">{n.items.map((it) => it.external ? <a key={it.label} className="text-sm" href={it.external} target="_blank" rel="noopener noreferrer">{it.label} ↗</a> : <Link key={it.label} className="text-sm" to={it.to} onClick={() => setMobile(false)}>{it.label}</Link>)}</div>}
            </div>
          ))}
        </div>
      )}
    </header>
  )
}
