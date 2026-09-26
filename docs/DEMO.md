# Demo script — HCDP with AI (10 minutes)

Site: https://hcdp-with-ai.cis251375.projects.jetstream-cloud.org — open it in a normal browser window at
1280 px or wider, light theme. Every step below is a URL you can also paste directly.

**The idea in one sentence:** the HCDP website with an AI navigator as its front door, where every state —
a map, a station, a month, a storm, a question — has its own shareable URL, and every page links back to
its original HCDP version.

1. **Landing** — `/`. Point out: the portal's header and menu, the five portal buttons in the logo's colours,
   the ask box with examples rotating inside it, HCDP's newest maps fading behind it. The bar under the header
   on every page: *Share this view* and *Original HCDP version*.
2. **Ask a navigation question** — type *Show me the rainfall map for Kauaʻi on 7 September 2026*. In ~3 s
   the site opens `/viewer/rainfall/day/2026-09-07/kauai` and the assistant shrinks to the bottom-right pill.
   Click **Storm 0–250 mm** to show Lowell's rain; the address bar changes. Click *Share this view*: that link
   reopens exactly this map. Click *Original HCDP version*: the portal's data portal — which cannot open a
   specific map from a link. That contrast is the pitch.
3. **The assistant keeps helping** — click the pill, ask *now Maui* → `/viewer/rainfall/day/2026-09-07/maui`.
   Press Esc: the panel shrinks into the pill. (The panel shows only questions and answers.)
4. **Live stations** — ask *Is it raining in Hilo right now?* → the Mesonet page opens on the Hilo station
   (`/mesonet?viewer=live&station=0115&view=dashboard`). Change the station or view in the picker: the URL
   follows. *Original HCDP version* opens the same station in the portal's viewer.
5. **A storm** — ask *Where is the Hurricane Lowell report?* → `/extreme-events/lowell` (dates, links, peak-day
   maps). The original-version link points at the portal's Lowell page.
6. **A month** — `/climate-summary?year=2026&month=8`: the monthly summary app on August, month/year in the URL.
7. **Tools** — `/tools/h-rip`: the Climate Tools page scrolls to the tile and highlights it (the portal's own
   picture tiles). `/tools` shows all ten.
8. **Share a question** — the link icon on any question copies `/?ask=…`; paste it in a new tab: the site asks
   it on arrival. Example: `/?ask=Show%20me%20the%20drought%20map%20for%20August%202026`.
9. **Analysis is a hand-off** — ask *Which station recorded the most rain during Lowell?* → the assistant says
   that is an analysis question and offers a button to the HCDP AI interface with the question and the map you
   were on. (The two systems are separate: this site navigates, the AI interface computes.)
10. **Phone** — resize to 390 px (or open on a phone): header, box, buttons, sidebar and pages stack; the pill
    stays reachable.

Safe to know during the demo: answers take 2.5–3.5 s (gpt-5.6-terra); the per-connection limit is 30
questions a minute; the first map after a deploy renders in ~1 s, later ones are cached; if the model is ever
unreachable the assistant still answers from the catalog by keyword.

Numbers if asked: 128 catalogued HCDP pages/tools/events; 111-case accuracy run — 90 % intent, 94 % target
(gpt-5.6-sol), 88 %/90 % (terra); 375 backend and 89 frontend tests; browser smoke test on every deploy.
