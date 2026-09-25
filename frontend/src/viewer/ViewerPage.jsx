import { useLocation } from 'react-router-dom'
import { parseViewerPath, describeViewer } from './urlGrammar'
// Placeholder until the viewer agent lands the map. It already proves the deep link resolves.
export default function ViewerPage() {
  const { pathname, search } = useLocation()
  const v = parseViewerPath(pathname, search)
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="font-display text-3xl">Climate viewer</h1>
      {v && !v.error ? <p className="mt-2" data-testid="viewer-title">{describeViewer(v)}</p> : <p className="mt-2 text-destructive" data-testid="viewer-error">{v?.error || 'no view selected'}</p>}
      <p className="mt-4 text-sm text-subtle">The map is on its way. This address already describes exactly what it will show.</p>
    </div>
  )
}
