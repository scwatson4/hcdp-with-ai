# hcdp-with-ai — the contract every contributor (human or agent) follows

## What this is
A prototype of the Hawaiʻi Climate Data Portal website with an AI **navigator** as its front door.
The visitor lands on a page that lists HCDP's tools and asks "What are you looking for?".
The navigator answers by **taking the visitor to the right place**: an internal page, a deep link
into the climate viewer, an external HCDP tool, or (for data analysis) the separate HCDP AI
interface. Once it has navigated, the ask bar **docks under the header** and stays there on every
inner page as the way to keep navigating (see "The assistant's states" below).

It is NOT the analysis chatbot (that lives at the AI interface, `AI_INTERFACE_URL`). This site has
no sign-in, saves no conversation history (memory only, per tab), and has no visualisation panel.

## The assistant's states (R1 picks A + D, 2026-10-08)
- **inline** — on the landing page the assistant is the bar in the hero (56 px, frosted glass over the map
  carousel, the logo's spectrum as a soft 1.5 px ring that goes full with focus and runs a comet while busy).
  Answers show in a card under the bar: the AI's bubbles only — the question stays in the bar and is never
  echoed. There is no heading over the map (an sr-only h1 names the portal).
- **answer first, then travel** — a navigation from the landing page does not jump: the reply shows under the
  bar for 700 ms (`HOLD_MS`); then the hero lifts away (−26 px + fade, 400 ms) while the bar rides up to the
  header row (a shared-element move, transform only, 450 ms ease-in, `TravelProxy.jsx`), and the page
  changes. Reduced motion: a cut after the hold, same end state.
- **dock** — on every inner page the bar is docked directly under the header as a full-width row (44 px
  field, max 720 px, centred; the sticky block is header + bar and nothing more; `AssistantBar.jsx`). The same
  conversation lives there; the typewriter ghost stops once a conversation exists and the placeholder reads
  "Ask for another page or map…". After a navigation a one-line **reply strip** under the bar repeats the
  reply with "Also: a · b" for five seconds (hover/focus holds it; clicking it opens the dropdown).
- **panel** — the docked bar's dropdown: the conversation (questions and plain answers, about twenty lines,
  scrolling), opened by focusing the bar once a conversation exists, by clicking the strip, or by a reply
  that has nowhere to go; closed by Esc, a click outside, or the next navigation.
- There is no bottom-right pill or dock any more. Arriving on the landing page brings the conversation back
  into the hero bar. `/` focuses the bar anywhere.
- **The hand-off** (T2 pick B): an analysis reply reads exactly "This is better answered by our AI data
  analysis tool. Try it out here" with "here" the link, then "Opens in a new tab · your question comes with
  you · sign in there with a code or an HCDP API key", then "Opening in 5 s · Stay here": after five seconds
  the AI interface opens in a new tab by itself (a refused tab shows "Your browser blocked the new tab — open
  it here"); "Stay here" cancels. Only the newest analysis reply counts down, once.
- **The way back** (T4 pick A): opened with `?from=ai`, the site shows one line under the header — "You came
  from the AI data analysis tool · Return · ✕"; Return is history.back() when the referrer is the AI interface
  (else a visit to it), ✕ dismisses, nothing is stored, the strip goes on the next route change and the `from`
  key is stripped from the address.

## Stack and layout
- `frontend/` — React 18 + Vite + Tailwind. Same design system as the AI interface: tokens in
  `src/styles/globals.css`, primitives in `src/components/ui/*`, the HCDP mark in `HeaderLogo.jsx`. The site is
  always light (`ThemeProvider` applies the light theme and clears any remembered one; there is no toggle, and
  the dark-mode CSS stays unused). Fonts are the portal's: the system stack (`-apple-system, Segoe UI, Roboto,
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
/data                     Access Data (the native viewer and the native Export form; the original app is linked for the rest)
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

Numbers the site computes itself (the time-series panel's count, min, max, mean and standard deviation of the
points in view) carry a provenance tag in the UI — "computed from HCDP station data" for a station, "computed from
HCDP gridded data" for a grid cell — so no computed figure reads as an HCDP product.

## Export endpoints (the native Export form on /data; `backend/export.py` mirrors hcdp_v2's export recipes)
```
GET  /api/export/options                   the products with their files, extents and station fills, and the limits
POST /api/export/instant  {dataset, period, start, end, extents:[slugs], files:[ids], station_files:[fills], email?}
                                           → HCDP POST /genzip/instant/content, the zip streamed back
                                             (Content-Disposition attachment; ≤ 150 files — hcdp_v2's IN_SITE_EXPORT_MAX — else 413;
                                             EXPORT_MAX_BYTES budget, 500 MB by default; per-IP limit, 6/min 40/h;
                                             HCDP refuses a genzip request without an email — it logs the requestor — so
                                             the visitor's is forwarded when typed, else EXPORT_LOG_EMAIL, by default
                                             anonymous@hcdp-with-ai.invalid; a refusal's 502 quotes HCDP's own words)
POST /api/export/email    {…the same, email required}
                                           → HCDP POST /genzip/email, 202 {ok, email, files, message}
                                             (the address is validated here and never stored; per-IP limit, 2/min 10/h)
```
Products: rainfall (new) by month and day, legacy rainfall by month (statewide only), temperature max/min/mean by
month and day. Grid files: `data_map`, `se`, `anom`, `anom_se` (rainfall), `metadata` (every map pulls it in);
station fills: `partial`, and `raw` for daily rainfall. The body HCDP receives is hcdp_v2's exactly:
`{email?, data: [{fileData: [{fileParams: {extent: [codes], units: [unit], fill?: [fills]}, files: [tags]}], params: {location, datatype, …, period},
dates: {start, end, unit, interval: 1}}]}`. The HCDP token stays server-side; the frontend never calls HCDP.

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
- No cookies, no analytics, no sign-in, no theme (the site is always light; a `hcdp-theme` key left by an earlier
  visit is removed), nothing persisted — with one exception: the viewer's unit
  system (`mm`/`°C` or `in`/`°F`) is remembered per browser (`localStorage` key `hcdp-units`, read and written in
  try/catch; `frontend/src/viewer/unitsPreference.js`). It only fills in a viewer link that names no units, as a
  load-time `replaceState` (`?units=in` / `?units=f`); a `units=` key in the address always wins, even `units=mm`.
  The export email is never stored.
