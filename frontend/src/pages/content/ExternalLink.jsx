import { cn } from '@/lib/utils'

// A link that leaves this site: opens in a new tab, shows a visible ↗ and
// tells screen readers so.
export default function ExternalLink({ href, children, className, arrow = true, plain = false, ...rest }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(!plain && 'underline decoration-border-strong underline-offset-2 hover:decoration-foreground', className)}
      {...rest}
    >
      {children}
      {arrow && <span aria-hidden="true">{' ↗'}</span>}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
