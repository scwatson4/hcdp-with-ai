import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import SiteHeader from './components/SiteHeader'
import SiteFooter from './components/SiteFooter'
import AssistantBar from './assistant/AssistantBar'
import ReturnStrip from './components/ReturnStrip'

// The shell every page shares: the sticky block (the header — whose logo row carries "Share this
// view" and "Original HCDP version" — and, on inner pages, the docked ask bar, R1 D), the return
// strip, the page, the footer.
export default function App() {
  const { pathname } = useLocation()
  // New page → top; the viewer's own URL changes (date, island…) keep the scroll position.
  useEffect(() => { if (!pathname.startsWith('/viewer/')) window.scrollTo({ top: 0 }) }, [pathname])
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow">Skip to content</a>
      <div className="sticky top-0 z-40" data-testid="sticky-header">
        <SiteHeader />
        <AssistantBar />
      </div>
      <ReturnStrip />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
