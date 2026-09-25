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
      <SiteHeader />
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
      <AssistantDock />
    </div>
  )
}
