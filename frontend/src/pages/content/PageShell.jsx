import { useEffect, useId } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import ExternalLink from './ExternalLink'

// Scroll to the element named by location.hash once the page has rendered.
// The shell (App.jsx) scrolls to the top on every path change, and parent
// effects run after child effects, so the jump waits a tick to land last.
export function useHashScroll() {
  const { hash, pathname } = useLocation()
  useEffect(() => {
    if (!hash || hash.length < 2) return undefined
    const id = decodeURIComponent(hash.slice(1))
    const t = window.setTimeout(() => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ block: 'start' })
    }, 60)
    return () => window.clearTimeout(t)
  }, [hash, pathname])
}

// The frame every content page shares: the portal source link, the title and
// lead, the body, and a "Related" list of sibling pages.
export function PageShell({ title, lead, source, sourceLabel = 'This page on the HCDP portal', icon: Icon, actions, children, related = [], className }) {
  useHashScroll()
  return (
    <article className={cn('mx-auto w-full max-w-4xl px-4 py-8 sm:py-10', className)}>
      {/* The "Original HCDP version" link now lives in the bar above every page (components/OriginalLink). */}
      <header>
        <div className="flex items-start gap-3">
          {Icon && (
            <span className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
          )}
          <h1 className="text-balance font-display text-2xl sm:text-3xl">{title}</h1>
        </div>
        {lead && <div className="mt-3 max-w-3xl text-base text-subtle">{lead}</div>}
        {actions && <div className="mt-5 flex flex-wrap gap-2">{actions}</div>}
      </header>
      <div className="mt-10 space-y-12">{children}</div>
      {related.length > 0 && <RelatedLinks items={related} />}
    </article>
  )
}

// A titled section; `id` makes it an anchor (with room for the sticky header).
export function Section({ id, title, lead, actions, children, className }) {
  const auto = useId()
  const headingId = `${id || auto.replace(/:/g, '')}-title`
  return (
    <section id={id} aria-labelledby={headingId} className={cn('scroll-mt-24', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <h2 id={headingId} className="font-display text-2xl">{title}</h2>
        {actions}
      </div>
      {lead && <div className="mt-1 max-w-3xl text-sm text-subtle">{lead}</div>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

// Body copy with comfortable spacing between paragraphs.
export function Prose({ children, className }) {
  return <div className={cn('max-w-3xl space-y-3 text-base leading-relaxed', className)}>{children}</div>
}

// Label/value facts as a compact definition list.
export function FactList({ items, className }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]', className)}>
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-medium text-foreground">{k}</dt>
          <dd className="text-subtle">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

// Links to sibling pages; internal routes stay in the app, portal pages open a new tab.
export function RelatedLinks({ items, title = 'Related' }) {
  return (
    <nav aria-label={title} className="mt-16 border-t border-border pt-6">
      <h2 className="font-display text-xl">{title}</h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <li key={it.label}>
            {it.to ? (
              <Link to={it.to} className="group flex h-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-foreground">
                <span>{it.label}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            ) : (
              <ExternalLink href={it.href} plain arrow={false} className="flex h-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-foreground">
                <span>{it.label}</span>
                <span aria-hidden="true" className="text-subtle">↗</span>
              </ExternalLink>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}
