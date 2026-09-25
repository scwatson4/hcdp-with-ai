import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import SiteHeader from './components/SiteHeader'
import SiteFooter from './components/SiteFooter'
import AssistantDock from './assistant/AssistantDock'

// The shell every page shares: header, the page, footer, and the assistant
// dock (which renders nothing until the assistant has minimized).
export default function App() {
  const { pathname } = useLocation()
  // New page → top; the viewer's own URL changes (date, island…) keep the scroll position.
  useEffect(() => { if (!pathname.startsWith('/viewer/')) window.scrollTo({ top: 0 }) }, [pathname])
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow">Skip to content</a>
      <SiteHeader />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
      <AssistantDock />
    </div>
  )
}
