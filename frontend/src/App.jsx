import { Outlet, useLocation } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import SiteHeader from './components/SiteHeader'
import SiteFooter from './components/SiteFooter'
import BackToTop from './components/BackToTop'
import AssistantBar from './assistant/AssistantBar'
import AskSheet from './assistant/AskSheet'
import ReturnStrip from './components/ReturnStrip'
import GooFilter from './components/GooFilter'
import { ShellModeProvider, useShellMode } from './components/shellMode'
import { useScrollLock, useStripOverlayOnLoad } from './components/overlayHistory'
import { cn } from './lib/utils'
import { FeedbackProvider } from './feedback/FeedbackProvider'
import FeedbackLayer from './feedback/FeedbackLayer'

// The shell every page shares: the sticky block (the header — whose logo row carries "Share this
// view" and "Original HCDP version" — and, on inner pages, the docked ask bar, R1 D), the return
// strip, the page, the footer.
// 14 Oct: a page may hold the shell in another mode (components/shellMode.jsx): the phone viewer ('phone-map', M1 C)
// keeps the header but not the docked bar, the footer or Back to top, and the page never scrolls; the desktop viewer's
// full-screen map ('map-full', QB-T3 B) hides the header too. The phone's Ask AI sheet (M2 A) lives here, as does the
// SVG filter behind the goo — and the review-period feedback over all of it (F1–F5: the right-edge tab, the selection
// pill, the composer panel; feedback/FeedbackLayer.jsx).
export default function App() {
  return (
    <ShellModeProvider>
      <Shell />
    </ShellModeProvider>
  )
}

function Shell() {
  const { pathname } = useLocation()
  const mode = useShellMode()
  const full = mode === 'map-full'
  const page = mode === 'page'
  useScrollLock(!page)
  useStripOverlayOnLoad()
  // New page → top; the viewer's own URL changes (date, island…) keep the scroll position.
  useEffect(() => { if (!pathname.startsWith('/viewer/')) window.scrollTo({ top: 0 }) }, [pathname])
  // The sticky block's height (header, and the docked bar on inner pages) is published as
  // --hcdp-sticky-h, so the viewer can size its map to the viewport below it (items 14 and 17).
  const stickyRef = useRef(null)
  useEffect(() => {
    const el = stickyRef.current
    if (!el) return undefined
    const publish = () => {
      const h = Math.round(el.getBoundingClientRect().height)
      if (h > 0) document.documentElement.style.setProperty('--hcdp-sticky-h', `${h}px`)   // (hidden in full screen: keep the last height)
    }
    publish()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null
    ro?.observe(el)
    window.addEventListener('resize', publish)
    return () => { ro?.disconnect(); window.removeEventListener('resize', publish) }
  }, [])
  return (
    <FeedbackProvider>
    <div className="flex min-h-screen flex-col bg-canvas text-foreground" data-shell={mode}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow">Skip to content</a>
      <div ref={stickyRef} className={cn('sticky top-0 z-40', full && 'hidden')} data-testid="sticky-header">
        <SiteHeader />
        {page && <AssistantBar />}
      </div>
      {!full && <ReturnStrip />}
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      {page && <SiteFooter />}
      {page && <BackToTop />}
      <AskSheet />
      <GooFilter />
      <FeedbackLayer />
    </div>
    </FeedbackProvider>
  )
}
