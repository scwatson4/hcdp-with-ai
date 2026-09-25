# HCDP with AI

A prototype of the **Hawaiʻi Climate Data Portal website with an AI navigator as its front door**.

The visitor lands on a page that lists HCDP's tools and asks *"What are you looking for?"*.
The navigator answers by taking them there: an internal page, a shareable deep link into the
climate viewer (`/viewer/rainfall/day/2026-09-07/kauai`), a real HCDP page or tool, or, when the
request is data analysis, the separate **HCDP AI interface**. After navigating, the assistant
minimizes to a dock in the lower-right and keeps helping on the new page.

This repository is deliberately separate from the HCDP AI interface:

| | HCDP AI interface | HCDP with AI (this repo) |
|---|---|---|
| Purpose | data analysis assistant (numbers, charts, maps it computes) | website + navigator that takes you to the right HCDP tool |
| Sign-in | yes (codes, admin panel) | none |
| History | saved conversations | none (memory only, per tab) |
| Visualisation panel | yes | no — the site's own pages and viewer are the visuals |
| Model | several engines | gpt-5.6-sol on the NAIRR resource, JSON action protocol |

See `CONTRACT.md` for the routes, the deep-link grammar, the navigator's action protocol and
the site catalog schema.

## Layout
```
frontend/   React 18 + Vite + Tailwind (same design system as the AI interface)
backend/    FastAPI: /api/navigate, /api/raster (GeoTIFF proxy), /api/dates, /api/catalog, /api/health; serves the built site
deploy/     Dockerfile (builds the site, serves it from the backend), docker-compose.yml, Caddyfile, .env.example
docs/       use cases and design notes
```

## Run it
```
cd frontend && npm install && npm run dev        # http://localhost:5174, proxies /api to :8010
cd backend && pip install -r requirements.txt && uvicorn app:app --port 8010
```
Backend configuration comes from `../.env` (see `deploy/.env.example`; never commit it).

## Deploy
```
cd deploy && docker compose --env-file ../.env up -d --build
```
Caddy terminates TLS for `SITE_ADDRESS` and proxies to the app on 8010.

## Tests
```
cd frontend && npx vitest run
cd backend && python -m pytest -q
```
