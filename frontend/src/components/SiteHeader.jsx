import { Link, NavLink, useNavigate } from 'react-router-dom'
import { ChevronDown, ExternalLink, MessageSquareText, Menu } from 'lucide-react'
import { useState } from 'react'
import HeaderLogo from './HeaderLogo'
import ThemeToggle from './ThemeToggle'
import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu'
import { NAV } from '../site/nav'
import { useAssistant } from '../assistant/AssistantProvider'
import { cn } from '../lib/utils'

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

export default function SiteHeader() {
  const { open } = useAssistant()
  const navigate = useNavigate()
  const [mobile, setMobile] = useState(false)
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-canvas/95 backdrop-blur">
      <div className="hcdp-band" aria-hidden="true" />
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4">
        <Link to="/" className="mr-2" aria-label="Hawaiʻi Climate Data Portal home"><HeaderLogo level="full" /></Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Site">
          {NAV.map((n) => n.items ? (
            <DropdownMenu key={n.label}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-sm">{n.label} <ChevronDown className="h-3 w-3" aria-hidden="true" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="font-nav font-semibold">{n.items.map((it) => <MenuItem key={it.label} item={it} />)}</DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <NavLink key={n.label} to={n.to} end={n.to === '/'} className={({ isActive }) => cn('rounded-md px-2 py-1 text-sm hover:bg-muted', isActive && 'font-medium text-foreground')}>{n.label}</NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs" onClick={() => open()} data-testid="ask-hcdp">
            <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" /> Ask HCDP
          </Button>
          <ThemeToggle />
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 md:hidden" aria-label="Menu" onClick={() => setMobile((v) => !v)}><Menu className="h-4 w-4" /></Button>
        </div>
      </div>
      {mobile && (
        <div className="border-t border-border px-4 py-2 md:hidden" data-testid="mobile-nav">
          {NAV.map((n) => (
            <div key={n.label} className="py-1">
              {n.items ? <div className="text-xs font-semibold uppercase tracking-wide text-subtle">{n.label}</div> : <button type="button" className="text-sm" onClick={() => { setMobile(false); navigate(n.to) }}>{n.label}</button>}
              {n.items && <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">{n.items.map((it) => it.external ? <a key={it.label} className="text-sm" href={it.external} target="_blank" rel="noopener noreferrer">{it.label} ↗</a> : <Link key={it.label} className="text-sm" to={it.to} onClick={() => setMobile(false)}>{it.label}</Link>)}</div>}
            </div>
          ))}
        </div>
      )}
    </header>
  )
}
