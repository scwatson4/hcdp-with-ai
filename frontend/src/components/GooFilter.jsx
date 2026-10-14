// The SVG filter behind the goo (restored 14 Oct from the dock of 25 Sep): a blur whose alpha is then pushed back to a
// hard edge, so a shrinking panel melts into its pill like a blob (.hcdp-goo-wrap in globals.css). Rendered once by the
// shell; invisible.
export default function GooFilter() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="pointer-events-none absolute" data-testid="goo-filter">
      <defs>
        <filter id="hcdp-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
          <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </defs>
    </svg>
  )
}
