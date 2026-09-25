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
  `src/styles/globals.css`, primitives in `src/components/ui/*`, fonts Inter / Newsreader / JetBrains
  Mono, the HCDP mark in `HeaderLogo.jsx`, light and dark themes via `ThemeProvider`.
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

## Routes (internal)
```
/                         landing: tools + "What are you looking for?"
/about  /about/team  /about/history  /about/acknowledgements  /about/how-to-cite
/data                     Access Data (the portal's interactive map, embedded, + the deep-link viewer)
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

dataset  rainfall | temperature-mean | temperature-max | temperature-min | humidity | ndvi | ignition | spi-1 | spi-3 | spi-6 | spi-9 | spi-12 | spi-24
period   month | day
date     YYYY-MM  or  YYYY-MM-DD   (the parser ALSO accepts month names: october/21/2025 and 2025/october/21)
extent   statewide | hawaii | maui | oahu | kauai | molokai | lanai
options  ramp=<name>      colour ramp (see viewer/rasterSpec.reference.js NAMED_RAMPS)
         scale=extreme    the 0–250 mm daily-rainfall scale
         units=in|mm      display units (rainfall) / f|c (temperature)
         stations=1       show station markers
         lat=&lng=&z=     exact map view (like a Google Maps link)
         compare=YYYY-MM  side-by-side second date
```
Examples: `/viewer/rainfall/day/2025-10-21/hawaii`, `/viewer/spi-3/month/2026-08/statewide`,
`/viewer/rainfall/month/2026-09/kauai?units=in&stations=1`.
`frontend/src/viewer/urlGrammar.js` is the single source of truth: `parseViewerPath()`,
`formatViewerPath()`, `DATASETS`, `EXTENTS`. Do not duplicate its logic.

Mapping to the HCDP API (the backend does this in `/api/raster`):
rainfall → datatype=rainfall&production=new; temperature-* → datatype=temperature&aggregation=mean|max|min;
humidity → relative_humidity (day only); ndvi → ndvi_modis (day only); ignition → ignition_probability (day only);
spi-N → datatype=spi&timescale=timescaleNNN (month only). Extents: statewide, bi (hawaii), mn (maui, molokai, lanai), oa, ka.

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
- Reuse the primitives and tokens; no new colours. Headings in `font-display`, body Inter, labels mono.
- Match the real HCDP site's section names and order: Access Data, Hawaiʻi Mesonet, Climate Summary,
  Pacific Portal, Extreme Events, Climate Tools; top nav Home · About · Data Portal · Research · Climate Tools.
- Every page works at phone width. External links open in a new tab and say so.
- No cookies, no analytics, no sign-in, nothing persisted except the theme.
