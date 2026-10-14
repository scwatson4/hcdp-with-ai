import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import MirroredPage from './MirroredPage'
import './portal.css'

// The Library (HCDP's /publications-list/, "Library" in its menu). HCDP renders it with the Zotpress plugin, which
// fills the page from its Zotero group in the browser; here the page itself is mirrored (the band, "Search Publications"
// and the "send PDFs" line) and the list underneath is native: every top-level item of the public Zotero group 2846077,
// fetched by the backend once a day (GET /api/portal/library), grouped by year — title, authors, venue, link.
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ʻ‘’']/g, '').toLowerCase()

export function groupByYear(items) {
  const groups = new Map()
  for (const it of items) {
    const y = /^\d{4}$/.test(it.year || '') ? it.year : 'Undated'
    if (!groups.has(y)) groups.set(y, [])
    groups.get(y).push(it)
  }
  return [...groups.entries()].sort((a, b) => (a[0] === 'Undated') - (b[0] === 'Undated') || Number(b[0]) - Number(a[0]))
}

export function matches(it, words) {
  if (!words.length) return true
  const hay = fold(`${it.title} ${it.authors} ${it.venue} ${it.year}`)
  return words.every((w) => hay.includes(w))
}

export function LibraryList() {
  const [state, setState] = useState({ status: 'loading', items: [] })
  const [q, setQ] = useState('')
  const deferred = useDeferredValue(q)
  useEffect(() => {
    const ac = new AbortController()
    fetch('/api/portal/library', { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setState({ status: 'ready', items: Array.isArray(d.items) ? d.items : [], fetchedAt: d.fetched_at, source: d.source }))
      .catch(() => { if (!ac.signal.aborted) setState({ status: 'error', items: [] }) })
    return () => ac.abort()
  }, [])
  const words = useMemo(() => fold(deferred).split(/\s+/).filter(Boolean), [deferred])
  const shown = useMemo(() => state.items.filter((it) => matches(it, words)), [state.items, words])
  const groups = useMemo(() => groupByYear(shown), [shown])
  if (state.status === 'loading') return <div className="hcdp-mirror-container hcdp-library" role="status">Loading the publications…</div>
  if (state.status === 'error') {
    return <div className="hcdp-mirror-container hcdp-library" data-testid="library-error">The publications list did not load. It is on <a href="https://www.zotero.org/groups/2846077" target="_blank" rel="noopener noreferrer">HCDP’s Zotero group<span className="sr-only"> (opens in a new tab)</span></a>.</div>
  }
  return (
    <section className="hcdp-mirror-container hcdp-library" aria-label="Publications" data-testid="library">
      <div className="hcdp-lib-tools">
        <label>
          <span className="sr-only">Filter the publications</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title, author, journal or year" data-testid="library-filter" />
        </label>
        <span data-testid="library-count">{shown.length === state.items.length ? `${state.items.length} publications` : `${shown.length} of ${state.items.length} publications`}</span>
      </div>
      {!words.length && (
        <nav className="hcdp-lib-years" aria-label="Years">
          {groups.map(([y]) => <a key={y} href={`#y-${y}`}>{y}</a>)}
        </nav>
      )}
      {groups.map(([y, list]) => (
        <div key={y}>
          <h2 id={`y-${y}`} style={{ scrollMarginTop: 'calc(var(--hcdp-sticky-h, 7rem) + 12px)' }}>{y}</h2>
          <ol>
            {list.map((it) => (
              <li key={it.key} data-testid="library-item">
                <a href={it.url || it.zotero} target="_blank" rel="noopener noreferrer" className="hcdp-lib-title">{it.title}<span className="sr-only"> (opens in a new tab)</span></a>
                <div className="hcdp-lib-meta">{[it.authors, it.venue].filter(Boolean).join(' · ')}</div>
              </li>
            ))}
          </ol>
        </div>
      ))}
      {!shown.length && <p data-testid="library-none">No publication matches “{q}”.</p>}
    </section>
  )
}

export default function LibraryPage() {
  return <MirroredPage path="/library" after={<LibraryList />} />
}
