import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { NAV } from '../site/nav'
import { useOverlayHistory, useScrollLock } from './overlayHistory'
import { OriginalVersionLink } from './OriginalLink'

// M6 A (14 Oct): the phone menu is a sheet, not an inline block that grew the sticky header to 424 px (the 8 Oct audit,
// with 19 px rows and three entries listed twice). The hamburger (44 px) opens a sheet from the right edge over a scrim:
// "Menu" and a 44 px ✕, then the portal's menu with each destination once — the groups (About, Data Portal, Research)
// as 12 px labels over their entries — every entry a 48 px row. It owns a history entry, so Back closes it; a link
// replaces that entry with its page (Back from there does not reopen the menu); the scrim, the ✕ and Esc close it; the
// page under it holds still. It is drawn in a portal: the header's backdrop blur would otherwise pin a fixed sheet to it.
export const MENU = 'menu'

/** NAV with each destination once: an entry inside a group gives way to a top-level entry of the same name (Cultural
 *  Resources and Library sit in the portal's top row too) and to an earlier one (How to Cite is under About). */
export function phoneMenu(nav = NAV) {
  const top = new Set(nav.filter((n) => !n.items).map((n) => n.label))
  const seen = new Set()
  return nav.map((n) => {
    if (!n.items) { seen.add(n.label); return n }
    const items = n.items.filter((it) => {
      if (top.has(it.label) || seen.has(it.label)) return false
      seen.add(it.label)
      return true
    })
    return { ...n, items }
  })
}

const ROW = 'flex min-h-12 w-full items-center justify-between gap-3 rounded-md px-3 text-left font-nav text-[15px] font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function Row({ item, close }) {
  if (item.external) {
    return (
      <a href={item.external} target="_blank" rel="noopener noreferrer" onClick={close} className={ROW} data-testid="menu-row">
        {item.label}<span aria-hidden="true" className="text-subtle">↗</span><span className="sr-only"> (opens in a new tab)</span>
      </a>
    )
  }
  return <Link to={item.to} replace className={ROW} data-testid="menu-row">{item.label}</Link>
}

/** `original`: show "Original HCDP version" as the sheet's last row (inner pages; the logo row has no room for it). */
export default function MobileMenu({ original = false }) {
  const menu = useOverlayHistory(MENU)
  useScrollLock(menu.isOpen)
  useEffect(() => {
    if (!menu.isOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) menu.close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu])
  const sheet = menu.isOpen && typeof document !== 'undefined' ? createPortal(
    <div className="md:hidden">
      <div aria-hidden="true" data-testid="menu-scrim" onClick={menu.close} className="hcdp-scrim-in fixed inset-0 z-[70] bg-black/35" />
      <nav aria-label="Menu" data-testid="mobile-menu-sheet" className="hcdp-side-in fixed inset-y-0 right-0 z-[71] flex w-[min(86vw,22rem)] flex-col bg-card text-card-foreground shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border py-1 pl-5 pr-2">
          <span className="font-nav text-[15px] font-semibold">Menu</span>
          <button type="button" onClick={menu.close} aria-label="Close the menu" data-testid="menu-close" className="grid h-11 w-11 place-items-center rounded-md text-subtle hover:bg-muted hover:text-foreground">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2" data-testid="mobile-nav">
          {phoneMenu().map((n) => (n.items ? (
            <li key={n.label} className="mt-2">
              <p className="px-3 pb-0.5 pt-2 font-nav text-[12px] font-bold uppercase tracking-[0.12em] text-subtle">{n.label}</p>
              <ul>{n.items.map((it) => <li key={it.label}><Row item={it} close={menu.close} /></li>)}</ul>
            </li>
          ) : (
            <li key={n.label}><Row item={n} close={menu.close} /></li>
          )))}
          {original && <li className="mt-3 border-t border-border px-1 pt-3"><OriginalVersionLink row className="min-h-12" /></li>}
        </ul>
      </nav>
    </div>,
    document.body,
  ) : null
  return (
    <>
      <button type="button" aria-label="Menu" aria-expanded={menu.isOpen} aria-haspopup="dialog" onClick={() => (menu.isOpen ? menu.close() : menu.open())} data-testid="menu-button"
        className="grid h-11 w-11 place-items-center rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:-my-2 md:hidden">
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>
      {sheet}
    </>
  )
}
