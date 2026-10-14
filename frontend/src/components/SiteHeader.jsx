import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, ExternalLink } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu'
import MobileMenu from './MobileMenu'
import { NAV } from '../site/nav'
import { cn } from '../lib/utils'
import { OriginalVersionLink, ShareView } from './OriginalLink'
import { useAssistant } from '../assistant/AssistantProvider'
import { useShellMode } from './shellMode'

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

export default function SiteHeader() {
  const { pathname } = useLocation()
  const { reset } = useAssistant()   // item 13: the logo always resets the landing page
  // M3 C (14 Oct): the landing page shows neither "Share this view" nor "Original HCDP version", at any width — every
  // inner page keeps them. The logo stays centred (the two side cells stay, empty). On the phone viewer (M1 C) they live
  // in its Controls sheet and its floating bar instead.
  const shell = useShellMode()
  const utility = pathname !== '/' && shell !== 'phone-map'
  return (
    <header className="border-b border-border bg-canvas/95 backdrop-blur">
      <div className="hcdp-band" aria-hidden="true" />
      <div className="mx-auto grid w-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pb-1 pt-3" data-testid="logo-row">
        <div className="flex min-w-0 items-center justify-start">{utility && <ShareView />}</div>
        <Link to="/" aria-label="Hawaiʻi Climate Data Portal home" className="block max-md:-my-2 max-md:py-2" onClick={() => reset()} data-testid="logo-home">
          <img src="/hcdp_logo.png" alt="HCDP — Hawaiʻi Climate Data Portal" width="1120" height="150" decoding="async" fetchPriority="high" className="h-7 w-auto sm:h-[52px]" />
        </Link>
        <div className="flex min-w-0 items-center justify-end gap-1">
          {/* on phones "Original HCDP version" is a row of the menu sheet: the logo row keeps 44 px for Share and Menu */}
          {utility && <OriginalVersionLink className="max-md:hidden" />}
          {/* M6 A: the phone menu is a sheet with its own history entry (MobileMenu.jsx) */}
          <MobileMenu original={utility} />
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
    </header>
  )
}
