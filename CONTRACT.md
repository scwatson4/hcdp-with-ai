# hcdp-with-ai — the contract every contributor (human or agent) follows

## What this is
A prototype of the Hawaiʻi Climate Data Portal website with an AI **navigator** as its front door.
The visitor lands on a page that lists HCDP's tools and asks "What are you looking for?".
The navigator answers by **taking the visitor to the right place**: an internal page, a deep link
into the climate viewer, an external HCDP tool, or (for data analysis) the separate HCDP AI
interface. Once it has navigated, the assistant **minimizes to a dock in the lower-right** and keeps
helping on the new page.

It is NOT the analysis chatbot (that lives at the AI interface, `AI_INTERFACE_URL`). This site has
no sign-in, saves no conversation history (memory only, per tab), and has no visualisation panel.

## Stack and layout
- `frontend/` — React 18 + Vite + Tailwind. Same design system as the AI interface: tokens in
  `src/styles/globals.css`, primitives in `src/components/ui/*`, the HCDP mark in `HeaderLogo.jsx`, light and
  dark themes via `ThemeProvider`. Fonts are the portal's: the system stack (`-apple-system, Segoe UI, Roboto,
  Helvetica Neue, Arial`) for body and headings, Raleway 600 for the menus (`font-nav`), Roboto in the map furniture.
  Router: `react-router-dom`. Alias `@` → `src`.
- `backend/` — FastAPI (`app.py`). LLM calls go through `llm.py` to gpt-5.6-sol on the NAIRR
  resource (env `NAVIGATOR_API_BASE`, `NAVIGATOR_MODEL`, `AZURE_OPENAI_API_KEY`). The HCDP token
  (`HCDP_API_TOKEN`) never reaches the browser: rasters and date ranges go through `/api/raster`
  and `/api/dates`. `/api/raster` re-encodes each GeoTIFF once, losslessly (deflate + floating-point
  predictor, tiled): statewide grids shrink from 2–16 MB to about 1 MB.
- `deploy/` — Dockerfile (builds the SPA, serves it from the backend), compose, Caddyfile.

## Ownership (parallel work — touch only your files)
| Area | Files | Owner |
|---|---|---|
| Shell, router, header/footer, landing, assistant, URL grammar, backend app/llm/navigator, deploy | everything not listed below | maintainer |
| Content pages | `frontend/src/pages/content/*.jsx` (+ their tests) | content agent |
| Climate viewer | `frontend/src/viewer/ViewerPage.jsx`, `frontend/src/viewer/map/*`, `frontend/src/viewer/*.test.js(x)`; may READ `urlGrammar.js` and the two `*.reference.js` files | viewer agent |
| Site catalog + navigator test cases | `backend/data/catalog.json`, `backend/data/usecases.json`, `backend/tests/test_catalog.py`, `backend/tests/test_usecases.py` | catalog agent |
| Use-case document | `docs/USE_CASES.md` | use-case agent |

Run the frontend tests with `cd frontend && npx vitest run`, the backend tests with
`cd backend && python -m pytest -q`. Keep both green.

## The URL principle
Every state on this site has its own shareable URL — a map, a station, a month, a storm, a tool, even a
question to the assistant — because HCDP's own pages cannot do that. Every page shows an **"Original HCDP
version"** link in the bar under the header (`frontend/src/site/original.js` maps our URLs to theirs; many of
ours map to one of theirs) and a **"Share this view"** copier. Adding anything new means: put its state in
the URL, register the query keys / route pattern in `backend/navigator.py` (`PAGE_QUERY_KEYS`,
`ROUTE_PATTERNS`), add it to the catalog so the navigator can produce it, and map it in `original.js`.

```
/extreme-events/{lowell|lala|nolo|kona-low-1|kona-low-2}         one storm
/tools/{slug}                                                     one tool tile (slug = image name)
/mesonet?viewer=live|app|nolo&station={id}&view=dashboard|graphing|station-map|station-table|wind-map
/climate-summary?year=YYYY&month=M                                one month in the summary app
/?ask={url-encoded question}                                      asks the assistant on arrival
```

## Routes (internal)
```
/                         landing: tools + "What are you looking for?"
/about  /about/team  /about/history  /about/acknowledgements  /about/how-to-cite
/data                     Access Data (the native viewer; the original portal stays embedded for Export only)
/data/api  /data/tutorials
/mesonet                  Hawaiʻi Mesonet
/climate-summary          Monthly Climate Summary
/pacific                  Pacific Portal (American Samoa, Guam)
/extreme-events           index of events (Nolo, Lowell, Lala, Kona Lows …), each with its portal links
/tools                    Climate Tools
/viewer/...               the deep-linkable climate viewer (grammar below)
```
Anything the prototype does not replicate links out to the real page on www.hawaii.edu/climate-data-portal
(open in a new tab, marked with an external-link icon).

## Deep-link grammar for the viewer (shareable, human-readable, stable)
```
/viewer/{dataset}/{period}/{date}/{extent}[?options]

dataset  rainfall | rainfall-legacy | temperature-mean | temperature-max | temperature-min | humidity | ndvi |
         ignition | ignition-lead-1 | ignition-lead-2 | ignition-lead-3 | spi-1 | spi-3 | spi-6 | spi-9 | spi-12 |
         spi-24 | spi-36 | spi-48 | spi-60
period   month | day
date     YYYY-MM  or  YYYY-MM-DD   (the parser ALSO accepts month names: october/21/2025 and 2025/october/21)
extent   statewide | hawaii | maui | oahu | kauai | molokai | lanai
```
Examples: `/viewer/rainfall/day/2025-10-21/hawaii`, `/viewer/spi-3/month/2026-08/statewide`,
`/viewer/rainfall/month/2026-09/kauai?units=in&layers=stations`.

**The path is the identity, the query is what the map shows, the hash (if any) is chrome.** The query keys are
written in ONE fixed order with defaults omitted, so one view has exactly one spelling (its canonical form):

| key | values | default (omitted) | history | meaning |
|---|---|---|---|---|
| `ramp` | a name from `viewer/map/ramps.js` NAMED_RAMPS, with the suffix `-r` to run it the other way (`viridis-r`) | the dataset's portal default, not reversed | replace | colour ramp (and its direction) |
| `scale` | `extreme` | portal scale | replace | the 0–250 mm daily-rainfall scale |
| `range` | `lo..hi` — two numbers in the dataset's native units (mm, °C, …), up to 2 decimals, lo < hi (swapped ends are put in order) | auto: the portal's scale (or `scale=extreme`'s) | replace | the legend locked to lo..hi; wins over `scale` |
| `log` | `1` | linear | replace | pseudo-log colour scaling, sign(v)·ln(1+\|v\|), between the legend's ends |
| `units` | `in` · `f` (`mm` · `c` are defaults) | metric | replace | display units (data never converted) |
| `basemap` | `satellite` · `street` · `imagery` · `topo` · `relief` · `light` | `satellite` | replace | base map |
| `opacity` | integer 0–100 | 75 | replace | data layer opacity |
| `layers` | comma list of `stations`, `outline` (reserved: `boundaries`, `ahupuaa`, `moku`) | none | replace | overlays on |
| `station` | an SKN such as `1020.1` | none | **push** | the selected station (opens its time series) |
| `pin` | `lat,lng` (4 decimals, inside Hawaiʻi) | none | **push** | the selected grid cell (a "virtual station") |
| `ts` | `YYYY-MM-DD..YYYY-MM-DD` or `YYYY-MM..YYYY-MM` | the dataset's whole record | replace | the time-series window (only with station/pin) |
| `tsp` | `day` · `month` | the map's period | replace | the time-series period |
| `compare` | a date in the map's period format | none | replace | side-by-side second date |
| `lat`,`lng`,`z` | 4 decimals, integer zoom 5–20 | the extent's own view | replace | the camera |

History: dataset, period, date, extent, station and pin **push** an entry (Back undoes a choice); everything
else **replaces** (Back never retraces a pan or a colour flip — nor a reversed ramp, a locked range or a log scale). The camera is written with `replaceState`
400 ms after a gesture ends, and every writer runs through one page-wide limiter of at most one history write
per 300 ms (Mobile Safari throws after 100 `replaceState` calls in 30 s).

Aliases (resolved on parse, rewritten to canonical on load with `replaceState`): dataset `rain`, `temp-max`,
`tmax`, `rh`, `fire`, `spi3`, `spi-03`, `legacy-rainfall`, `ignition+2` …; period `monthly`/`daily`; extent
`big-island`, `bigisland`, `bi`, `oa`, `ka`, `mn`, `state` …; and the first grammar's `?stations=1` →
`layers=stations`. Nothing published ever 404s: a renamed slug gets an alias, never a removal.

`frontend/src/viewer/urlGrammar.js` is the single source of truth: `parseViewerPath()`, `parseViewerOptions()`,
`formatViewerPath()`, `canonicalize()`, `isCanonical()`, `DATASETS`, `EXTENTS`, `QUERY_KEYS`, the alias
tables. `backend/navigator.py` mirrors it (`parse_viewer_path`, `canonical_viewer_path`,
`parse_viewer_options`, `format_viewer_options`); keep the two in step. Dates must be real calendar dates.
Do not duplicate its logic. Colour ramps live in `frontend/src/viewer/map/ramps.js`.

Mapping to the HCDP API (the backend does this in `/api/raster`):
rainfall → datatype=rainfall&production=new; rainfall-legacy → production=legacy (statewide only, 1920–2012);
temperature-* → datatype=temperature&aggregation=mean|max|min; humidity → relative_humidity (day only);
ndvi → ndvi_modis (day only); ignition → ignition_probability (day only; ignition-lead-N → lead=lead0N);
spi-N → datatype=spi&timescale=timescaleNNN (month only, statewide only).
Extents: statewide, bi (hawaii), mn (maui, molokai, lanai), oa, ka.

## Viewer data endpoints (the HCDP token never leaves the server)
```
GET /api/raster?dataset&period&date&extent                 the GeoTIFF (re-encoded, cached on disk, Range + ETag)
GET /api/dates?dataset&period&extent                       [first, last] published dates
GET /api/climate-stations                                  every station of HCDP's hawaii_climate_primary group
                                                           {stations:[{skn,name,island,lat,lng,elevation_m,network,observer}]}
GET /api/station-values?dataset&period&date[&fill]         the stations with a value that day/month, joined with metadata
                                                           {stations:[{skn,name,island,lat,lng,value}], units, count}
GET /api/timeseries?dataset&period&start&end&station=SKN   a station's record (chunked server-side, cached)
GET /api/timeseries?dataset&period&start&end&lat&lng       a grid cell's record (HCDP /raster/timeseries)
                                                           {points:[["2026-09-01", 7.72], …], units, dataset, period, location}
GET /api/og.png?path=/viewer/...                           1200×630 preview image of a view (cached)
POST /api/shorten {path}  →  {id, url}                     deterministic short link; GET /s/{id} → 302 to the view
```
Station datasets: rainfall, temperature-mean/max/min, humidity (`fill=partial` is HCDP's quality-controlled series,
`fill=raw` the unfilled one; gridded maps always use partial).

## The navigator's action protocol (backend → assistant)
`POST /api/navigate` body: `{ "message": str, "history": [{"role","content"}] (last 8, memory only),
"context": { "path": str, "viewer": {...} | null } }`

Response:
```json
{
  "intent": "navigate" | "analysis" | "info" | "clarify",
  "reply": "one or two sentences, plain words",
  "actions": [
    { "type": "navigate", "path": "/viewer/rainfall/day/2026-09-07/kauai" },
    { "type": "open", "url": "https://www.hawaii.edu/climate-data-portal/hurricane-lowell/" },
    { "type": "handoff", "url": "https://<ai-interface>/?ask=..." }
  ],
  "alternatives": [ { "title": "...", "url": "...", "why": "..." } ],
  "minimize": true
}
```
Rules: at most one `navigate` action; `open` is for external HCDP pages/tools; `handoff` only when the
request is data analysis (numbers, comparisons, computations, charts) — the assistant links to the AI
interface and does not attempt analysis itself. `alternatives` are always welcome (2–4). `minimize`
is true whenever a navigation happened. `info` answers a question about HCDP without navigating.
`clarify` asks one short question.

## The site catalog (backend/data/catalog.json)
An array of entries; this is the knowledge the navigator reasons over. Keep it exhaustive and honest.
```json
{ "id": "hurricane-lowell-report", "kind": "event" | "page" | "viewer" | "tool" | "api" | "dataset" | "atlas" | "external" | "internal",
  "title": "Hurricane Lowell report", "url": "https://www.hawaii.edu/climate-data-portal/hurricane-lowell/",
  "internal_path": null | "/extreme-events#lowell",
  "summary": "what it is, one or two sentences", "when_to_use": "what a visitor wants when this is the answer",
  "example_queries": ["download rainfall data from Hurricane Lowell", "..."],
  "region": "hawaii" | "american_samoa" | "guam" | "pacific" | null, "dates": {"start": "2026-09-06", "end": "2026-09-08"} | null,
  "tags": ["rainfall", "storm", "wind"] }
```
Viewer entries carry `internal_path` templates such as `/viewer/rainfall/day/{date}/{extent}`.

## Design rules
- Reuse the primitives and tokens; no new colours (the portal's own image treatments, e.g. the tool tiles, are fine). Headings in `font-display`, menus in `font-nav`.
- Match the real HCDP site's section names and order: Access Data, Hawaiʻi Mesonet, Climate Summary,
  Pacific Portal, Extreme Events, Climate Tools; top nav Home · About · Data Portal · Research · Climate Tools.
- Every page works at phone width. External links open in a new tab and say so.
- No cookies, no analytics, no sign-in, nothing persisted except the theme — and one exception: the viewer's unit
  system (`mm`/`°C` or `in`/`°F`) is remembered per browser (`localStorage` key `hcdp-units`, read and written in
  try/catch; `frontend/src/viewer/unitsPreference.js`). It only fills in a viewer link that names no units, as a
  load-time `replaceState` (`?units=in` / `?units=f`); a `units=` key in the address always wins, even `units=mm`.
  The export email is never stored.
