import { ToolTile } from '../pages/content/ToolTiles'
import { tileImageFor } from './tileImages'
import { cn } from '../lib/utils'

// R5 C (13 Oct): the did-you-mean tiles under a clarify answer whose ask could mean several catalogued things (the
// navigator's `options`, resolved server-side). The portal's own tile style (ToolTiles.jsx: a 3:2 picture, 10 px
// corners, the navy shade, the bold white name, the `why` as the caption), two across on phones and up to four
// across on wider screens, in the landing answer card and in the docked dropdown alike. A tap chooses the page —
// no AI call: the provider's choose() shows "Opening {title}…", opens it and runs the overview flow with the reply
// "You chose {title}."; an external one opens in a new tab and says so.
export default function TileChoice({ options, onChoose, className }) {
  const list = (Array.isArray(options) ? options : []).filter((o) => o && typeof o.url === 'string' && o.title).slice(0, 4)
  if (list.length < 2) return null
  const cols = list.length === 2 ? 'grid-cols-2' : list.length === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'
  return (
    <ul role="list" aria-label="Did you mean" data-testid="tile-choice" className={cn('mt-2 grid gap-2.5', cols, className)}>
      {list.map((o, i) => (
        <li key={`${o.url}-${i}`} className="min-w-0">
          <ToolTile
            compact headingLevel={3}
            tool={{ name: o.title, caption: o.why || undefined, image: tileImageFor(o), shade: 'navy', external: !o.url.startsWith('/') }}
            onSelect={() => onChoose?.(o)}
          />
        </li>
      ))}
    </ul>
  )
}
