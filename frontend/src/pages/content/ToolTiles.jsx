import { useId } from 'react'
import { ExternalLink as ExternalIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// The HCDP portal's picture buttons (its Climate Tools page): a 3:2 picture
// with 10-px corners, a shade falling from the top edge, and the tool's name
// (bold, 1.4rem) and caption (1rem) in white at 10 % from the top and left.
// The two shades are the portal's own image treatment, copied as they are
// and deliberately not themed: like the map furniture, they sit on imagery.
export const TILE_SHADES = {
  navy: 'linear-gradient(to bottom, rgba(10, 30, 80, 0.8), rgba(0, 0, 0, 0) 60%)',
  blue: 'linear-gradient(to bottom, rgba(0, 60, 130, 1), rgba(0, 0, 0, 0) 60%)',
}

const FRAME = 'relative block aspect-[3/2] overflow-hidden rounded-[10px] bg-inset'

/**
 * One tile. `tool`: { name, caption?, href?, image: { src, width, height },
 * shade?: 'navy' | 'blue', soon?: bool }. With an `href` the whole tile is one
 * link that opens in a new tab; a `soon` tile is not a link.
 */
export function ToolTile({ tool, headingLevel = 2 }) {
  const id = useId()
  const { name, caption, href, image, shade = 'navy', soon = false } = tool
  const Heading = `h${headingLevel}`
  const live = Boolean(href) && !soon
  const inner = (
    <>
      <img
        src={image.src}
        alt={name}
        width={image.width}
        height={image.height}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: TILE_SHADES[shade] || TILE_SHADES.navy }} />
      <div className="absolute left-[10%] top-[10%] w-[80%] text-left text-white">
        <Heading id={`${id}name`} className={cn('ml-[5px] text-[1.4rem] font-bold leading-[1.2] text-white', live && 'underline-offset-4 group-hover:underline')}>
          {name}
          {soon && ' (Coming soon)'}
        </Heading>
        {caption && <p id={`${id}caption`} className="text-[1rem] leading-[1.7] text-white">{caption}</p>}
      </div>
      {/* In the corner, clear of the text box, so titles wrap as on the portal. */}
      {live && <ExternalIcon className="absolute right-3 top-3 h-4 w-4 text-white drop-shadow" strokeWidth={2.25} aria-hidden="true" />}
    </>
  )
  if (!live) {
    return <div className={FRAME} data-testid="tool">{inner}</div>
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-labelledby={`${id}name ${id}tab`}
      aria-describedby={caption ? `${id}caption` : undefined}
      className={cn(FRAME, 'group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas')}
      data-testid="tool"
    >
      {inner}
      <span id={`${id}tab`} className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

/**
 * The portal's grid: three across on wide screens (its rows of three), two on
 * tablets, one on phones. A tile with `center` sits in the middle column of
 * its row on wide screens, like the portal's lone last tile.
 */
export function ToolTileGrid({ tools, label, headingLevel = 2, className }) {
  return (
    <ul role="list" aria-label={label} className={cn('grid gap-x-7 gap-y-8 sm:grid-cols-2 sm:gap-y-10 lg:grid-cols-3', className)}>
      {tools.map((t) => (
        <li key={t.name} className={cn('min-w-0', t.center && 'lg:col-start-2')}>
          <ToolTile tool={t} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  )
}
