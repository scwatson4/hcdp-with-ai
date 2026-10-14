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
// M6 A (14 Oct): a neutral scrim under the portal's shade, darkest behind the title band, so white type holds on the light
// pictures too (the 8 Oct audit: "CCVD Portfolios" over a pale map); and a soft shadow on the type itself.
export const TILE_SCRIM = 'linear-gradient(to bottom, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0.32) 32%, rgba(0, 0, 0, 0) 62%)'
const TEXT_SHADOW = { textShadow: '0 1px 3px rgba(0, 0, 0, 0.6)' }

const FRAME = 'relative block aspect-[3/2] overflow-hidden rounded-[10px] bg-inset'
const FOCUS = 'group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas'

/**
 * One tile. `tool`: { name, caption?, href?, image: { src, width, height, fallback? },
 * shade?: 'navy' | 'blue', soon?: bool, ai?: bool, external?: bool }. With an `href` the whole tile is one
 * link that opens in a new tab; a `soon` tile is not a link. An `ai` tile wears the
 * logo's spectrum as its 1.5 px outline, so it reads as the AI door.
 * R5 C (13 Oct): with `onSelect` the tile is a button instead (the assistant's did-you-mean tiles choose a
 * page without leaving the site; `external` marks one that will open in a new tab); `compact` scales the
 * type for a tile a quarter of a card wide; an image's `fallback` replaces it if it fails to load.
 */
export function ToolTile({ tool, headingLevel = 2, onSelect = null, compact = false }) {
  const id = useId()
  const { name, caption, href, image, shade = 'navy', soon = false, ai = false, external = false } = tool
  const Heading = `h${headingLevel}`
  const live = (Boolean(href) || Boolean(onSelect)) && !soon
  const opensTab = Boolean(href) || external
  const inner = (
    <>
      <img
        src={image.src}
        alt={name}
        width={image.width}
        height={image.height}
        loading="lazy"
        decoding="async"
        onError={image.fallback ? (e) => { if (!e.currentTarget.src.endsWith(image.fallback)) e.currentTarget.src = image.fallback } : undefined}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: TILE_SHADES[shade] || TILE_SHADES.navy }} />
      <div aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: TILE_SCRIM }} data-testid="tile-scrim" />
      <div className="absolute left-[10%] top-[10%] w-[80%] text-left text-white" style={TEXT_SHADOW}>
        <Heading id={`${id}name`} className={cn('ml-[5px] font-bold text-white', compact ? 'text-[15px] leading-[1.2] sm:text-[16px]' : 'text-[1.4rem] leading-[1.2]', live && 'underline-offset-4 group-hover:underline')}>
          {name}
          {soon && ' (Coming soon)'}
        </Heading>
        {caption && <p id={`${id}caption`} className={cn('text-white', compact ? 'mt-0.5 line-clamp-2 text-[12px] leading-[1.35]' : 'text-[1rem] leading-[1.7]')}>{caption}</p>}
      </div>
      {/* In the corner, clear of the text box, so titles wrap as on the portal. */}
      {live && opensTab && <ExternalIcon className="absolute right-3 top-3 h-4 w-4 text-white drop-shadow" strokeWidth={2.25} aria-hidden="true" />}
    </>
  )
  if (!live) {
    return <div className={FRAME} data-testid="tool">{inner}</div>
  }
  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-labelledby={opensTab ? `${id}name ${id}tab` : `${id}name`}
        aria-describedby={caption ? `${id}caption` : undefined}
        className={cn(FRAME, FOCUS, 'w-full text-left', ai && 'hcdp-rainbow-border')}
        data-testid="tool"
        data-ai={ai ? 'true' : undefined}
      >
        {inner}
        {opensTab && <span id={`${id}tab`} className="sr-only">(opens in a new tab)</span>}
      </button>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-labelledby={`${id}name ${id}tab`}
      aria-describedby={caption ? `${id}caption` : undefined}
      className={cn(FRAME, FOCUS, ai && 'hcdp-rainbow-border')}
      data-testid="tool"
      data-ai={ai ? 'true' : undefined}
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
        <li key={t.name} id={t.image?.slug ? `tool-${t.image.slug}` : undefined} className={cn('min-w-0 rounded-[10px] transition-shadow', t.center && 'lg:col-start-2')}>
          <ToolTile tool={t} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  )
}
