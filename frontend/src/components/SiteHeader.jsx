import { Link, NavLink, useNavigate } from 'react-router-dom'
import { ChevronDown, ExternalLink, Menu } from 'lucide-react'
import { useState } from 'react'
import ThemeToggle from './ThemeToggle'
import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu'
import { NAV } from '../site/nav'
import { cn } from '../lib/utils'

// The portal's header: the logo centred on its own row, the menu centred under it in
// Raleway small caps (tightened: 20 px gaps, 12.5 px type). The theme toggle sits at
// the right edge of the logo row; the assistant is the bottom-right "Ask AI" pill.
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

export default function SiteHeader() {
  const navigate = useNavigate()
  const [mobile, setMobile] = useState(false)
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-canvas/95 backdrop-blur">
      <div className="hcdp-band" aria-hidden="true" />
      <div className="relative mx-auto flex w-full max-w-6xl items-center justify-start px-4 pb-1 pt-3 sm:justify-center">
        <Link to="/" aria-label="Hawaiʻi Climate Data Portal home" className="block">
          <img src="/hcdp_logo.png" alt="HCDP — Hawaiʻi Climate Data Portal" width="1120" height="150" decoding="async" fetchPriority="high" className="h-8 w-auto sm:h-[52px] dark:hidden" />
          <img src="/hcdp_logo_dark.png" alt="" width="1120" height="150" decoding="async" className="hidden h-8 w-auto sm:h-[52px] dark:block" />
        </Link>
        <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 md:hidden" aria-label="Menu" aria-expanded={mobile} onClick={() => setMobile((v) => !v)}><Menu className="h-4 w-4" /></Button>
        </div>
      </div>
      <nav className="hidden items-center justify-center gap-x-5 px-4 pb-2 md:flex" aria-label="Site">
        {NAV.map((n) => n.items ? (
          <DropdownMenu key={n.label}>
            <DropdownMenuTrigger asChild>
              <button type="button" className={cn(NAV_ITEM, 'inline-flex items-center gap-1 rounded px-1 py-1')}>{n.label} <ChevronDown className="h-3 w-3" aria-hidden="true" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="font-nav font-semibold">{n.items.map((it) => <MenuItem key={it.label} item={it} />)}</DropdownMenuContent>
          </DropdownMenu>
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
