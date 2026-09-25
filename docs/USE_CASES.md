# Navigator use cases

The case book for the navigator of *HCDP with AI*: who comes to the Hawaiʻi Climate Data Portal, what they type, and what the navigator should do. It is written for the site's maintainer (catalog, system prompt, tests) and for HCDP staff deciding what to build next. The 72 queries in section 2 are candidates for `backend/data/usecases.json`; the ten tests in section 8 run against a live `POST /api/navigate`.

*Prepared 25 September 2026 (HST) from CONTRACT.md, backend/navigator.py, the scraped portal pages, backend/data/extreme_events.json, the 24 September API survey and live checks of the portal; Appendix C lists the sources.*

## What to act on first

**This site (maintainer)**

1. SPI grids exist only statewide. Stop emitting island SPI paths such as `/viewer/spi-3/month/2026-08/maui`, or fetch the statewide grid for spi-N and treat the extent as the view (section 6, *SPI has no island grids*).
2. Show the dock on every page except `/` from the first load and keep it after *Start over*; today a visitor who arrives by a shared link gets no assistant (section 7).
3. Compute "yesterday" in Pacific/Honolulu, not the container's UTC date, and check `/api/dates` per dataset; NDVI runs about four days behind.
4. Carry the current view into the hand-off `ask`, and add `followups` (dock chips) and a `share` action to the response (section 4).
5. `open` and `handoff` call `window.open` after `await fetch`, which browsers may block; show an *Open ...* button when that happens.
6. Give each `/viewer/...` address its own `<title>` and `og:` tags so shared links unfurl with what they show (section 5).
7. Catalog: add the Mesonet stations (80 active in Hawaiʻi, 10 in American Samoa) with place aliases (Appendix A). Primary targets in this file with no matching entry: RE8 open [Cloud water interception][cloud-water]; boundary pair 7 `/viewer/temperature-max/day/2026-09-24/oahu` (the catalog has monthly temperature templates only). Linked pages with no entry: [Avian malaria tool][avian-malaria], [Streamflow extremes][streamflow], [Cloud water interception][cloud-water], [Kaʻala cloud-water station][kaala], [Downscaling 2026-2035][downscaling], [Recharge tool highlight][recharge-highlight].

**Decisions for HCDP staff**

1. May the navigator link other agencies (the catalog already has NWS Honolulu; the Central Pacific Hurricane Center, USGS stream gauges, NOAA Atlas 14), and as primary targets or only as alternatives?
2. When a visitor writes in ʻŌlelo Hawaiʻi (or another language spoken in Hawaiʻi), should the navigator answer in it?
3. A reuse and embed policy for newsrooms and teachers, so the site can offer embed code.
4. Portal fixes that the navigator cannot make: Nolo on the Extreme Events index, published API rate limits and the undocumented endpoints, a division parameter for the Climate Summary link, gauges for west Kauaʻi.

## Contents

- [What to act on first](#what-to-act-on-first)
- [1. Conventions](#1-conventions)
- [2. Personas and what they type](#2-personas-and-what-they-type)
- [3. (a) Navigation or analysis: 15 boundary pairs](#3-a-navigation-or-analysis-15-boundary-pairs)
- [4. (b) The dock after a navigation: three flows](#4-b-the-dock-after-a-navigation-three-flows)
- [5. (c) Deep links people will share](#5-c-deep-links-people-will-share)
- [6. (d) Gaps, by persona](#6-d-gaps-by-persona)
- [7. (e) Accessibility and mobile](#7-e-accessibility-and-mobile)
- [8. (f) Acceptance tests for POST /api/navigate](#8-f-acceptance-tests-for-post-apinavigate)
- [Appendix A. Place names, extents and nearest gauges](#appendix-a-place-names-extents-and-nearest-gauges)
- [Appendix B. Links and their verification](#appendix-b-links-and-their-verification)
- [Appendix C. Sources and method](#appendix-c-sources-and-method)

## 1. Conventions

### Reading the tables

| Column or mark | Meaning |
|---|---|
| What they type | Verbatim, typos and missing ʻokina included. |
| Intent | The `intent` the response must carry: `navigate`, `analysis` (hand-off), `info` or `clarify`, as in CONTRACT.md. |
| Primary target | A path in code (`/viewer/...`, `/mesonet`) is a `navigate` action in the same tab. *open* [a link] is an `open` action to a real HCDP page or tool in a new tab. *hand-off* is a `handoff` action; the server builds `AI_INTERFACE_URL/?ask=<the query>`. Quoted text is what an `info` or `clarify` reply must say. Text in parentheses is a caveat the reply must carry. |
| Alternatives | Two or three entries for `alternatives[]`. |
| Dock offers next | Two or three follow-ups the minimized dock shows as chips; a tap sends the chip as the next message. The response has no field for them yet (gap *Follow-ups and sharing*, section 6). |
| Catalog ids | Entries of `backend/data/catalog.json` (as of 2026-09-25, 128 entries) that match the primary target; for `info` and `clarify` rows, the alternatives. A dash means no entry matches, which makes the target a candidate for the catalog. Read when this file was generated. |
| † | URL seen in a source file but not fetched, because its host is outside this review's fetch allowlist. |
| ‡ | Deep link into an HCDP app, derived from that app's code: the host page answers HTTP 200 and the route and its parameter were read in the app's bundle; the rendered view was not tested. |
| no mark | External link that answered HTTP 200 on 25 September 2026. |

### Dates

Every example assumes the visitor asks on Friday 25 September 2026, Hawaiʻi time. Latest daily map: 24 September (the system prompt's "through yesterday"; when the API was surveyed on the 24th its daily grids ran through the 23rd). Latest monthly map: August 2026. NDVI: 20 September, about four days behind. Anything that says "yesterday" or "latest" must be recomputed on the day a test runs.

### Rules the case book assumes

1. A named storm: its report or tracker is primary; a viewer link for its dates is an alternative, or primary when the visitor asks for a map (system prompt).
2. A map for a date and place: a viewer deep link. Daily-only datasets (humidity, ndvi, ignition) and month-only ones (spi-N) are coerced to a period they have; an invalid path is never emitted, because the server drops it and degrades the answer to `info`. SPI exists only statewide, so an island drought map is the statewide SPI with `lat`/`lng`/`z` on the island.
3. A number, total, ranking, comparison, trend, chart or "why": hand-off. A value that a page already displays (a live gauge, a tracker's running total, a published rank or figure) is a navigation to that page.
4. Something HCDP does not do (forecasts, warnings, storm track, flood stage, design storms, drought declarations): `info` naming who does, with the nearest HCDP pages as alternatives.
5. Proposed: when the primary target is external, also navigate the current tab to the internal page that frames it (`/mesonet`, `/extreme-events#...`, `/tools`, `/pacific`), so the dock keeps its context and the visitor has a fallback if the browser blocks the new tab.
6. Proposed: place names resolve through Appendix A; an ambiguous one (Waimea, Kailua) uses a cue in the query or asks.
7. Clarify only when acting would probably be wrong (three recent storms, three Waimeas).

## 2. Personas and what they type

Nine personas, eight queries each. Row codes (SC1, EM4 ...) are cited in the gaps table of section 6.

### 2.1 Climate scientist

> A research climatologist or hydrologist (UH Mānoa, USGS, a state agency) who knows HCDP's gridded products by name and wants the exact file, its uncertainty and its citation.  
> Types precise, jargon-heavy queries (SPI-12, LOOCV, GeoTIFF, 1991–2020 normals) and expects to land on data, not on an explanation.

| # | What they type | Intent | Primary target | Alternatives | Dock offers next | Catalog ids |
|---|---|---|---|---|---|---|
| SC1 | SPI-12 statewide Aug 2026 | `navigate` | `/viewer/spi-12/month/2026-08/statewide` | `/viewer/spi-3/month/2026-08/statewide` · [Gridded SPI for Hawaiʻi][spi-highlight] · `/data` | *Same for July* · *Compare with Aug 2025* · *How to cite SPI* | `spi-12-map` |
| SC2 | daily rainfall geotiff kauai 2026-09-07 | `navigate` | `/viewer/rainfall/day/2026-09-07/kauai` (the viewer shows the map; the GeoTIFF itself comes from Access Data's export tab or the API) | [Access Data][access] · [Export Data Tutorial][tut-export] · `/data/api` | *Show gauges* · *Day before* · *Standard error map* | `lowell-rainfall-map` |
| SC3 | standard error map june 2026 monthly rainfall | `navigate` | `/data` (Access Data exports the standard-error, anomaly and metadata files; the viewer shows only the data map) | `/viewer/rainfall/month/2026-06/statewide` · [API docs][api-docs]† · [Export Data Tutorial][tut-export] | *Anomaly map instead* · *Cite this product* | `access-data` |
| SC4 | LOOCV r2 for the march 2026 rainfall map | `navigate` | `/data` (the map's metadata file lists cross-validation R² by county; the navigator does not read it out) | [How to Cite][cite] · hand-off (compare accuracy between counties) | *Open the March 2026 map* | `access-data` |
| SC5 | legacy monthly rainfall 1920s | `navigate` | `/data` (legacy monthly rainfall runs 1920–2012; this site's viewer starts in 1990) | [Rainfall Atlas][atlas] · [Rainfall Mapping History][rf-history] · `/about/how-to-cite` | *Show 1990 onward in the viewer* · *Cite the legacy maps* | `access-data` |
| SC6 | % of normal rainfall maui aug 2026 vs 1991-2020 | `analysis` | hand-off | [Climate Summary, Aug 2026][summary-aug]‡ · `/viewer/rainfall/month/2026-08/maui` · `/data` | *Open the August summary* · *Show the map* | `hcdp-ai-interface` |
| SC7 | citation for HCDP daily temperature maps | `navigate` | `/about/how-to-cite` | [How to Cite][cite] · [Library][library] | *API citation* · *Rainfall map citation* | `how-to-cite` |
| SC8 | bulk download every daily rainfall grid for kauai 2025 | `navigate` | `/data/api` (bulk zip packages need an API token) | [API docs][api-docs]† · [Export Data Tutorial][tut-export] · [Access Data][access] | *Python example* · *Request a token* | `api` |

### 2.2 Emergency response personnel

> A county emergency-management duty officer, a Red Cross disaster program manager covering Hawaiʻi and American Samoa, or a utility storm-desk engineer.  
> Mid-event, on a phone, on patchy bandwidth: terse, typo-prone queries about what is happening now and where, and a clear answer when the question (forecast, warning, flood stage) belongs to another agency.

| # | What they type | Intent | Primary target | Alternatives | Dock offers next | Catalog ids |
|---|---|---|---|---|---|---|
| EM1 | nolo tracker | `navigate` | open [Nolo tracker][nolo] + `/extreme-events#nolo` | `/viewer/rainfall/day/2026-09-24/hawaii?units=in&stations=1` · [Mesonet wind map][mesonet-wind]‡ · [Mesonet Live Data Access][mesonet-live] | *Yesterday's rain map* · *Wind gusts now* · *Share this* | `nolo` |
| EM2 | rain hilo last 24 hrs | `navigate` | open [Hilo gauge 0281][st-0281]‡ + `/mesonet` | [Nolo tracker][nolo] · [Hilo gauge on the Mesonet app][m-0281] · `/viewer/rainfall/day/2026-09-24/hawaii?units=in` | *Piʻihonua gauge (upslope)* · *Island rain map* · *Share this* | `mesonet-live-data` |
| EM3 | strongest gust kauai lowell | `analysis` | hand-off | [Lowell Kauaʻi/Oʻahu focus][lowell-focus] · [Lowell Mesonet viewer][lowell-viewer] · [Lowell report][lowell] | *Open the Kauaʻi focus page* | `hcdp-ai-interface` |
| EM4 | where is nolo now what category | `info` | “HCDP records what the stations measure; the storm's position, strength and warnings come from the Central Pacific Hurricane Center and the National Weather Service.” | [NWS Honolulu][nws]† · [Nolo tracker][nolo] · [Mesonet Live Data Access][mesonet-live] | *Open the Nolo tracker* | `nws-honolulu`, `nolo`, `mesonet-live-data` |
| EM5 | is hanalei flooding | `info` | “HCDP has rainfall, not river levels or flood warnings (National Weather Service, USGS). The nearest rain gauge to Hanalei is Waipā.” | [NWS Honolulu][nws]† · [Waipā 0601 (Hanalei)][st-0601]‡ · `/viewer/rainfall/day/2026-09-24/kauai?units=in` | *Kauaʻi rain map, yesterday* | `nws-honolulu`, `mesonet-live-data`, `rainfall-daily-map` |
| EM6 | fire danger maui today | `navigate` | `/viewer/ignition/day/2026-09-24/maui` (yesterday's model output, not a fire warning; predictions 1 to 3 days ahead are in Access Data) | `/data` · `/viewer/humidity/day/2026-09-24/maui` · [Mesonet wind map][mesonet-wind]‡ | *Same for Hawaiʻi Island* · *Day before* · *Share this* | `ignition-daily-map` |
| EM7 | wind gusts oahu right now power lines | `navigate` | open [Mesonet wind map][mesonet-wind]‡ + `/mesonet` | [Mesonet station map][mesonet-map]‡ · [Nolo tracker][nolo] · [Lāʻie 0552][st-0552]‡ | *Nolo tracker* · *Station list* | `mesonet-wind-map` |
| EM8 | american samoa rain gauges live | `navigate` | open [American Samoa Mesonet live][as-mesonet] + `/pacific` | [Mesonet, American Samoa view][mesonet-as]‡ · [American Samoa portal][as-portal] · [American Samoa data viewer][as-viewer]† | *Āfono stream gauge* · *Guam data* | `american-samoa-mesonet` |

### 2.3 Researcher from another field

> An ecologist mapping mosquito habitat, a public-health epidemiologist linking heat to emergency-room visits, a civil engineer sizing a culvert.  
> Expert in their own field, not in climate products: asks for "data for my sites" and needs to be steered to the right product, or told plainly that HCDP does not publish it.

| # | What they type | Intent | Primary target | Alternatives | Dock offers next | Catalog ids |
|---|---|---|---|---|---|---|
| RE1 | vegetation greenness map big island | `navigate` | `/viewer/ndvi/day/2026-09-20/hawaii` (NDVI runs about four days behind the other daily maps) | `/viewer/spi-3/month/2026-08/statewide?lat=19.6000&lng=-155.5000&z=9` · `/viewer/rainfall/month/2026-08/hawaii` · `/data` | *Same date last year* · *Rainfall instead* | `ndvi-daily-map` |
| RE2 | temperature map for mosquito / avian malaria elevation band | `navigate` | `/viewer/temperature-mean/month/2026-08/hawaii` | [Avian malaria tool][avian-malaria] · [Climate Tools][tools] · `/viewer/temperature-min/month/2026-08/maui` | *Maui instead* · *In Fahrenheit* | `temperature-mean-map` |
| RE3 | monthly rain + temp for my 12 plots on hawaii island 2000-2020 | `analysis` | hand-off | [CCVD climate portfolios][ccvd]† · `/data/api` · `/data` | *Open the analysis AI* · *API docs* | `hcdp-ai-interface` |
| RE4 | heat index honolulu for ER visit study | `analysis` | hand-off (heat index is computed from temperature and humidity; HCDP does not publish it) | `/viewer/temperature-max/day/2026-09-24/oahu?units=f` · `/viewer/humidity/day/2026-09-24/oahu` · [Lyon Arboretum 0501][st-0501]‡ | *Max temperature map* · *Humidity map* | `hcdp-ai-interface` |
| RE5 | 100 yr 24 hr rainfall depth culvert design kona | `info` | “HCDP does not publish design-storm frequency statistics; those come from NOAA Atlas 14. HCDP has the daily rainfall record behind them.” | `/data` · [Rainfall Atlas][atlas] · [Streamflow extremes][streamflow] | *Daily rainfall downloads* · *API* | `access-data`, `rainfall-atlas` |
| RE6 | evapotranspiration data | `navigate` | open [Evapotranspiration atlas][et-atlas] + `/tools` | [Solar Radiation atlas][solar-atlas] · [Climate of Hawaiʻi][climate-atlas] · [Groundwater Recharge Tool][recharge]† | *Cite the ET atlas* | `evapotranspiration-atlas` |
| RE7 | soil moisture stations | `navigate` | open [Mesonet station map][mesonet-map]‡ + `/mesonet` (Mesonet stations measure soil moisture and soil temperature) | `/data/api` · [Kula Ag Station 0119][st-0119]‡ · [station metadata repo][gh-stations] | *Stations on Maui* · *Variable list* | `mesonet-station-map` |
| RE8 | cloud water interception data | `navigate` | open [Cloud water interception][cloud-water] | [Kaʻala cloud-water station][kaala] · [Kaʻala 0521][st-0521]‡ · [Research Highlights][research] | *Kaʻala gauge now* | — |

### 2.4 Everyday citizen

> A Hilo homeowner watching Nolo, a hiker planning Haleakalā, a parent deciding on the beach, someone who just heard a storm warning on the radio.  
> On a phone, conversational and vague, often without ʻokina or kahakō, and mostly asking about right now or tomorrow.

| # | What they type | Intent | Primary target | Alternatives | Dock offers next | Catalog ids |
|---|---|---|---|---|---|---|
| CI1 | is it raining in hilo right now | `navigate` | open [Hilo gauge 0281][st-0281]‡ + `/mesonet` | [Hilo gauge on the Mesonet app][m-0281] · [Nolo tracker][nolo] · `/viewer/rainfall/day/2026-09-24/hawaii` | *Rain map, yesterday* · *Piʻihonua gauge (upslope)* · *Share this* | `mesonet-live-data` |
| CI2 | ke ua nei ma Hilo? (ʻŌlelo Hawaiʻi: is it raining in Hilo?) | `navigate` | open [Hilo gauge 0281][st-0281]‡ + `/mesonet` (reply language is an open decision, see (d)) | [Hilo gauge on the Mesonet app][m-0281] · [Climate Glossary][glossary] · [Nolo tracker][nolo] | *Rain map, yesterday* | `mesonet-live-data` |
| CI3 | whats the weather gonna be this weekend in kula | `info` | “Forecasts come from the National Weather Service; HCDP shows what has already been measured, such as the Kula gauge right now.” | [NWS Honolulu][nws]† · [Kula Ag Station 0119][st-0119]‡ · [Kula gauge on the Mesonet app][m-0119] | *Kula gauge now* | `nws-honolulu`, `mesonet-live-data`, `hawaii-mesonet-app` |
| CI4 | how much rain did we get from that hurricane | `clarify` | “Which storm: Tropical Storm Nolo (since 22 September), Hurricane Lowell (6–8 September) or Hurricane Lala (14–16 August)?” | [Nolo tracker][nolo] · [Lowell report][lowell] · [Lala report][lala] | *Nolo* · *Lowell* · *Lala* | `nolo`, `lowell`, `lala` |
| CI5 | safe to hike haleakala tomorrow | `info` | “HCDP cannot say whether a trail is safe or what tomorrow brings (National Park Service, National Weather Service); here is the summit gauge right now.” | [NWS Honolulu][nws]† · [Haleakalā Summit 0153][st-0153]‡ · [Haleakalā Park HQ 0151][st-0151]‡ | *Summit wind now* | `nws-honolulu`, `mesonet-live-data` |
| CI6 | water company says drought, how bad is it on maui | `navigate` | `/viewer/spi-3/month/2026-08/statewide?lat=20.8000&lng=-156.3000&z=10` (SPI grids are statewide only, so the link zooms the statewide map to Maui) | [Climate Summary, Aug 2026][summary-aug]‡ · [Drought and Maui drinking water][drought-maui-water] · `/viewer/spi-12/month/2026-08/statewide?lat=20.8000&lng=-156.3000&z=10` | *12-month view* · *What is SPI?* · *Same for July* | `spi-3-map` |
| CI7 | kuai rain map yesterday | `navigate` | `/viewer/rainfall/day/2026-09-24/kauai` | `/viewer/rainfall/day/2026-09-24/statewide` · [Waipā 0601 (Hanalei)][st-0601]‡ · [Nolo tracker][nolo] | *Now Oʻahu* · *In inches* · *Share this* | `rainfall-daily-map` |
| CI8 | why is it so hot lately | `analysis` | hand-off ("why" needs anomalies and an explanation) | `/viewer/temperature-max/month/2026-08/statewide?units=f` · [Climate Summary, Aug 2026][summary-aug]‡ · [Temperature trends 1917-2016][temp-trends] | *August max-temperature map* | `hcdp-ai-interface` |

### 2.5 Teacher or student

> A middle-school science teacher on Kauaʻi building a rain-shadow lesson, a UH undergraduate writing a term paper, a high-school student with a science-fair question.  
> Needs maps for slides, plain explanations, Hawaiian climate vocabulary and something citable, often from a classroom where thirty people share one network address.

| # | What they type | Intent | Primary target | Alternatives | Dock offers next | Catalog ids |
|---|---|---|---|---|---|---|
| TE1 | rain shadow map for my 7th grade class | `navigate` | open [Rainfall Atlas][atlas] (the long-term mean map shows the windward/leeward contrast; one month can mislead) | `/viewer/rainfall/month/2026-08/kauai?units=in` · `/about/history` · [Climate of Hawaiʻi][climate-atlas] | *Big Island version* · *Share for slides* | `rainfall-atlas` |
| TE2 | what does SPI mean | `info` | “The Standardized Precipitation Index compares rainfall over the last 1 to 24 months with the long-term record: below 0 is drier than usual, −2 or lower is extreme drought.” | `/viewer/spi-3/month/2026-08/statewide` · [Gridded SPI for Hawaiʻi][spi-highlight] · [A Century of Drought][drought-century] | *Show the SPI map* | `spi-3-map`, `research-spi-dataset`, `research-century-of-drought` |
| TE3 | hawaiian words for rain | `navigate` | open [Climate Glossary][glossary] | [Hawaiian Moon Calendar][moon] · [Cultural Resources][cultural] · [Indigenous Drought Perspective][indigenous-drought] | *Moon calendar* | `climate-glossary` |
| TE4 | percipitation map lowell for slides | `navigate` | `/viewer/rainfall/day/2026-09-07/kauai?units=in` | [Lowell report][lowell] · `/viewer/rainfall/day/2026-09-07/oahu?units=in` · `/extreme-events#lowell` | *Share this* · *Oʻahu too* · *Extreme scale* | `lowell-rainfall-map` |
| TE5 | science fair: is my school in waimea kauai drier than the mountains | `analysis` | hand-off | `/viewer/rainfall/month/2026-08/kauai?units=in` · [Rainfall Atlas][atlas] · [Lāwaʻi NTBG 0621][st-0621]‡ | *Open the analysis AI* | `hcdp-ai-interface` |
| TE6 | lesson plans about hawaii climate | `navigate` | open [Educational Resources][edu] | [Factsheets][factsheets] · `/data/tutorials` · [Hawaiian Moon Calendar][moon] | *Map-making tutorial* | `educational-resources` |
| TE7 | tutorial how to make a map on hcdp | `navigate` | `/data/tutorials` | [Tutorial: download a map][tut-map] · [Tutorial: station data][tut-station] · `/viewer/rainfall/month/2026-08/statewide` | *Open a map now* | `tutorials` |
| TE8 | has hawaii gotten hotter in the last 100 years (essay) | `navigate` | open [Temperature trends 1917-2016][temp-trends] (a published study; a new trend for a place would be analysis) | hand-off (a recent trend at one place) · `/viewer/temperature-mean/month/2026-08/statewide` · `/about/how-to-cite` | *How to cite it* | `research-temperature-trends` |

### 2.6 Farmer or rancher

> A Kula vegetable grower on county water, a Waimea (Hawaiʻi Island) cattle rancher deciding when to destock, a Molokaʻi homesteader near Kaunakakai.  
> Practical and place-specific: wants the rain at their gauge, the drought on their land and the moon calendar, on a phone between chores.

| # | What they type | Intent | Primary target | Alternatives | Dock offers next | Catalog ids |
|---|---|---|---|---|---|---|
| FA1 | rangeland drought waimea | `navigate` | open [H-RIP rangeland portal][hrip]† + `/tools` ("rangeland" places this Waimea on Hawaiʻi Island) | `/viewer/spi-3/month/2026-08/statewide?lat=20.0230&lng=-155.6718&z=11` · [Lālāmilo 0252 (Waimea)][st-0252]‡ · `/viewer/ndvi/day/2026-09-20/hawaii` | *12-month drought* · *Pasture greenness* · *Lālāmilo gauge* | `h-rip` |
| FA2 | kula rain last month | `navigate` | `/viewer/rainfall/month/2026-08/maui?lat=20.7700&lng=-156.3300&z=12` | [Kula Ag Station 0119][st-0119]‡ · [Climate Summary, Aug 2026][summary-aug]‡ · hand-off (Kula's total in inches) | *In inches* · *Compare with Aug 2025* · *Kula gauge now* | `rainfall-monthly-map` |
| FA3 | did kaunakakai get any rain this week | `navigate` | open [Kualapuʻu 0421 graphs][st-0421-graph]‡ (the station's graphs cover the week; the nearest gauges, Kualapuʻu and Nāʻiwa, are about 7.5 km away) | [Nāʻiwa 0422][st-0422]‡ · `/viewer/rainfall/day/2026-09-24/molokai?units=in` · hand-off (the 7-day total) | *Molokaʻi rain map* · *7-day total* | `mesonet-graphing` |
| FA4 | usdm drought monitor maui county | `navigate` | `/viewer/spi-3/month/2026-08/statewide?lat=20.8000&lng=-156.3000&z=10` (say the U.S. Drought Monitor comes from the National Drought Mitigation Center with USDA and NOAA; SPI is HCDP's nearest product) | [Climate Summary, Aug 2026][summary-aug]‡ · `/viewer/spi-12/month/2026-08/statewide?lat=20.8000&lng=-156.3000&z=10` · [H-RIP rangeland portal][hrip]† | *12-month view* · *What is SPI?* | `spi-3-map` |
| FA5 | when will it rain next in waimea | `info` | “Forecasts are the National Weather Service's. For what has fallen: the Lālāmilo gauge (Waimea, Hawaiʻi Island) or Lāwaʻi (the nearest to Waimea, Kauaʻi, 17 km).” | [NWS Honolulu][nws]† · [Lālāmilo 0252 (Waimea)][st-0252]‡ · [Lāwaʻi NTBG 0621][st-0621]‡ | *Rain in the last 24 hours* | `nws-honolulu`, `mesonet-live-data` |
| FA6 | average rainfall by month for my farm in kula | `navigate` | open [Rainfall Atlas map][atlas-map]† (click the farm for mean monthly rainfall, 1978–2007) | [CCVD climate portfolios][ccvd]† · hand-off (values for a coordinate) · [Kula Ag Station 0119][st-0119]‡ | *This year against the average* | `rainfall-atlas-interactive-map` |
| FA7 | ignition probablity pasture fire waimea | `navigate` | `/viewer/ignition/day/2026-09-24/hawaii?lat=20.0230&lng=-155.6718&z=11` | `/viewer/spi-3/month/2026-08/statewide?lat=20.0230&lng=-155.6718&z=11` · `/viewer/humidity/day/2026-09-24/hawaii` · [Mesonet wind map][mesonet-wind]‡ | *Day before* · *Share this* | `ignition-daily-map` |
| FA8 | moon calendar for planting kalo | `navigate` | open [Hawaiian Moon Calendar][moon] | [Dryland Agriculture][dryland] · [Climate Glossary][glossary] · [Indigenous Drought Perspective][indigenous-drought] | — | `hawaiian-moon-calendar` |

### 2.7 Water utility or land-use planner

> A hydrologist at a county water department or the state water commission tracking source-water drought; a county planner preparing a community plan with sea-level-rise overlays.  
> Wants long records, normals, projections and GIS-ready files with citations, and links that stay valid in a memo.

| # | What they type | Intent | Primary target | Alternatives | Dock offers next | Catalog ids |
|---|---|---|---|---|---|---|
| PL1 | 12-month SPI maui for the last 5 years | `analysis` | hand-off (a series of 60 monthly maps) | `/viewer/spi-12/month/2026-08/statewide?lat=20.8000&lng=-156.3000&z=10` · [A Century of Drought][drought-century] · [Drought and Maui drinking water][drought-maui-water] | *Open the latest map* | `hcdp-ai-interface` |
| PL2 | sea level rise exposure lahaina | `navigate` | open [Sea Level Rise Viewer][slr]† + `/tools` | [SOEST Coastal Viewer][soest-coastal]† · [Climate Tools][tools] | — | `sea-level-rise-viewer` |
| PL3 | future rainfall projections maui 2100 | `navigate` | `/data` (projections are in Access Data, not in this site's viewer) | [Downscaling 2026-2035][downscaling] · [Climate Tools][tools] · hand-off (numbers for a place) | *Cite the projections* | `access-data` |
| PL4 | groundwater recharge tool | `navigate` | open [Groundwater Recharge Tool][recharge]† + `/tools` | [Recharge tool highlight][recharge-highlight] · [Evapotranspiration atlas][et-atlas] | — | `groundwater-recharge-tool` |
| PL5 | 1991-2020 rainfall normals oahu by month | `navigate` | `/data` (the contemporary-climatology layers) | [Rainfall Atlas][atlas] · [Climate of Hawaiʻi][climate-atlas] · `/about/how-to-cite` | *Old and new normals compared* | `access-data` |
| PL6 | august 2026 climate summary by ahupuaa | `navigate` | open [Climate Summary, Aug 2026][summary-aug]‡ + `/climate-summary` | [2025 Annual Climate Report][annual] · `/viewer/rainfall/month/2026-08/statewide` | *July instead* · *Subscribe to the summary* | `climate-summary` |
| PL7 | mean annual rainfall gis layers shapefile | `navigate` | open [Rainfall Atlas downloads][atlas-downloads]† (250 m grids and isohyet shapefiles, inches or mm) | [Rainfall Atlas][atlas] · [Climate of Hawaiʻi][climate-atlas] · `/about/how-to-cite` | *Cite the atlas* | `rainfall-atlas-downloads` |
| PL8 | compare maui drought now vs 2019 for our water shortage declaration | `analysis` | hand-off | `/viewer/spi-12/month/2026-08/statewide?compare=2019-08&lat=20.8000&lng=-156.3000&z=10` · [Drought and Maui drinking water][drought-maui-water] | *Open the side-by-side map* | `hcdp-ai-interface` |

### 2.8 Journalist

> A reporter for a Honolulu newsroom or public radio on deadline during Nolo, or writing a retrospective on the March Kona lows.  
> Needs a citable figure with its source, a map that can be linked or embedded, and a person to interview.

| # | What they type | Intent | Primary target | Alternatives | Dock offers next | Catalog ids |
|---|---|---|---|---|---|---|
| JO1 | how many gallons did hurricane lala drop | `navigate` | open [UH News on Lala][news-lala]† + `/extreme-events#lala` (quote the published figure, about 1.3 trillion US gallons, with its source; the catalog entry uh-news-lala carries it) | [Lala report][lala] · hand-off (recompute for one island) · `/viewer/rainfall/day/2026-08-15/hawaii` | *Same for Lowell* | `uh-news-lala` |
| JO2 | map of the march kona low flooding for our story | `navigate` | `/viewer/rainfall/month/2026-03/statewide?units=in` | [Kona Low #1 viewer][kona1] · [Kona Low #2 viewer][kona2] · [UH News on the March floods][news-march]† | *Oʻahu only* · *Share this* · *Kona Low #2 viewer* | `march-2026-rainfall-map` |
| JO3 | who can i interview about the mesonet | `navigate` | `/about/team` | [Team][team] · [Hawaiʻi Mesonet][mesonet-page] | *Email HCDP* | `team` |
| JO4 | was august the driest on record for maui | `navigate` | open [Climate Summary, Aug 2026][summary-aug]‡ + `/climate-summary` (the summary publishes island ranks against the record) | hand-off (verify the rank) · `/viewer/rainfall/month/2026-08/maui` | *August rain map* · *July instead* | `climate-summary` |
| JO5 | lowell wind hour by hour kauai | `navigate` | open [Lowell report][lowell] + `/extreme-events#lowell` (the report's hourly 250 m wind maps) | [Lowell Mesonet viewer][lowell-viewer] · [Lowell Kauaʻi/Oʻahu focus][lowell-focus] | *Rain map, 7 September* | `lowell` |
| JO6 | nolo rain totals so far | `navigate` | open [Nolo tracker][nolo] + `/extreme-events#nolo` (per-gauge totals since 22 Sep, 10 pm HST) | `/viewer/rainfall/day/2026-09-24/hawaii?units=in&stations=1` · hand-off (rank or sum the gauges) | *Share this* · *Top five gauges* | `nolo` |
| JO7 | can we embed your rain map on our site | `info` | “There is no embed code yet. Every map has a stable link, and HCDP (hcdp@hawaii.edu) can advise on reuse and credit.” | `/viewer/rainfall/day/2026-09-24/statewide` · `/about/how-to-cite` · `/data/api` | *Copy link* | `rainfall-daily-map`, `how-to-cite`, `api` |
| JO8 | 2025 annual climate report pdf | `navigate` | open [2025 Annual Climate Report][annual] | [Annual report PDF][annual-pdf] · [Monthly Climate Summary][summary] · `/about/how-to-cite` | — | `annual-climate-report-2025` |

### 2.9 Software developer

> An app developer adding rainfall to an irrigation tool, a hobbyist wiring the nearest Mesonet station into a home dashboard, a GIS developer automating monthly map ingestion.  
> Wants the API, the token, the docs, stable URL patterns and honest limits.

| # | What they type | Intent | Primary target | Alternatives | Dock offers next | Catalog ids |
|---|---|---|---|---|---|---|
| DE1 | api token | `navigate` | `/data/api` (the token request form is on the portal's API page) | [HCDP / Mesonet API page][api-page] · [API docs][api-docs]† · [HCDP on GitHub][gh-hcdp] | *Python example* · *Mesonet endpoint* | `api` |
| DE2 | python example download rainfall geotiff | `navigate` | open [HCDP API notebook][api-notebook] + `/data/api` | [API docs][api-docs]† · [hcdp_api_docs repo][api-repo] · [HCDP / Mesonet API page][api-page] | *OpenAPI spec* | `api-python-notebook` |
| DE3 | mesonet 5 minute data endpoint | `navigate` | `/data/api` | [API docs][api-docs]† · [station metadata repo][gh-stations] · `/mesonet` | *Station list* | `api` |
| DE4 | openapi spec yaml | `navigate` | open [hcdp_api_docs repo][api-repo] + `/data/api` | [API docs][api-docs]† | — | `hcdp-github` |
| DE5 | latest date available for daily rainfall via api | `info` | “Daily grids run through yesterday (24 September 2026), monthly grids through August 2026, NDVI about four days behind; /datasets/date/range returns the first and last date (live, not in the published spec).” | `/data/api` · [API docs][api-docs]† | — | `api`, `api-docs` |
| DE6 | station list csv with lat lon | `navigate` | open [station metadata repo][gh-stations] (csv_data/stations/station_metadata.csv) | [Mesonet station table][mesonet-table]‡ · `/data/api` | — | `mesonet-station-metadata-csv` |
| DE7 | how do your map links work, i want to generate them | `info` | “/viewer/{dataset}/{period}/{date}/{extent} plus options units, stations, scale, ramp, compare and lat/lng/z; for example /viewer/rainfall/day/2026-09-07/kauai.” | `/viewer/rainfall/day/2026-09-07/kauai` · `/viewer/spi-3/month/2026-08/statewide` · `/data/api` | — | `lowell-rainfall-map`, `spi-3-map`, `api` |
| DE8 | rate limits on the hcdp api? | `info` | “HCDP does not publish API rate limits; ask hcdp@hawaii.edu when requesting a token.” | [HCDP / Mesonet API page][api-page] · [API docs][api-docs]† | — | `api`, `api-docs` |

### Mix of intents

| Persona | navigate | analysis | info | clarify |
|---|---|---|---|---|
| Climate scientist | 7 | 1 | 0 | 0 |
| Emergency response personnel | 5 | 1 | 2 | 0 |
| Researcher from another field | 5 | 2 | 1 | 0 |
| Everyday citizen | 4 | 1 | 2 | 1 |
| Teacher or student | 6 | 1 | 1 | 0 |
| Farmer or rancher | 7 | 0 | 1 | 0 |
| Water utility or land-use planner | 6 | 2 | 0 | 0 |
| Journalist | 7 | 0 | 1 | 0 |
| Software developer | 5 | 0 | 3 | 0 |
| **All 72** | **52** | **8** | **11** | **1** |

## 3. (a) Navigation or analysis: 15 boundary pairs

Each pair differs by a few words and lands on opposite sides of the line between this site (navigate, or info) and the AI interface (analysis).

| # | Navigate: this site does it | Target | Analysis: hand-off | Why they fall on opposite sides | Catalog ids |
|---|---|---|---|---|---|
| 1 | Show me rainfall on Kauaʻi on 7 September 2026 | `/viewer/rainfall/day/2026-09-07/kauai` | How much rain fell on Kauaʻi on 7 September 2026? | A map to look at, against a number computed from it (island mean or volume). | `lowell-rainfall-map` |
| 2 | Show me Nolo's rain totals | open [Nolo tracker][nolo] | Which gauge has the most rain from Nolo, and by how much? | The tracker already displays each gauge's running total; ranking and differences are computation. | `nolo` |
| 3 | Drought map for Maui, August 2026 | `/viewer/spi-3/month/2026-08/statewide?lat=20.8000&lng=-156.3000&z=10` | Is Maui's drought worse than a year ago? | One map, against a comparison across dates. | `spi-3-map` |
| 4 | Put August 2026 next to August 2025 on Oʻahu | `/viewer/rainfall/month/2026-08/oahu?compare=2025-08` | How many inches wetter was August 2026 than August 2025 on Oʻahu? | Side by side is a viewer option; the difference is arithmetic. | `rainfall-monthly-map` |
| 5 | Is it raining in Hilo right now? | open [Hilo gauge 0281][st-0281]‡ | Has Hilo had more rain than normal this month? | A live reading a page shows, against an anomaly from a baseline. | `mesonet-live-data` |
| 6 | Zoom the August rain map to Kaunakakai | `/viewer/rainfall/month/2026-08/molokai?lat=21.0906&lng=-157.0226&z=13` | How much rain fell at Kaunakakai in August 2026? | Moving the map, against sampling the grid at a point. | `rainfall-monthly-map` |
| 7 | Temperature map for Oʻahu yesterday | `/viewer/temperature-max/day/2026-09-24/oahu` | Where was the hottest spot on Oʻahu yesterday? | Display, against finding a maximum over the grid. | — |
| 8 | Fire-risk map for Maui yesterday | `/viewer/ignition/day/2026-09-24/maui` | What share of Maui is above 50 % ignition probability? | Display, against an area statistic. | `ignition-daily-map` |
| 9 | Show the gauges on the Lowell rain map | `/viewer/rainfall/day/2026-09-07/kauai?stations=1` | Do the gauges agree with the map at Waiʻaleʻale? | Markers on a map, against a grid-versus-station comparison. | `lowell-rainfall-map` |
| 10 | Where can I download Kauaʻi daily rainfall grids? | `/data` + `/data/api` | Chart Līhuʻe's daily rainfall for 2025 | Pointing to files, against extracting a series and drawing a chart. | `access-data`, `api` |
| 11 | Wettest place in Hawaiʻi | open [Rainfall Atlas][atlas] | Which ahupuaʻa got the most rain in August 2026? | A published long-term map answers the first; the second needs a ranking over a monthly table. | `rainfall-atlas` |
| 12 | Was August 2026 dry on Maui? | open [Climate Summary, Aug 2026][summary-aug]‡ | Rank August 2026 at Kula among every August since 1990 | The monthly summary publishes island ranks; a custom rank at a point is computation. | `climate-summary` |
| 13 | Has Hawaiʻi warmed over the last century? | open [Temperature trends 1917-2016][temp-trends] | How much has Kula's mean temperature changed since 1990? | A published study, against a new trend at a new place. | `research-temperature-trends` |
| 14 | How many gallons of rain did Hurricane Lala drop? | open [UH News on Lala][news-lala]† | How many gallons of rain did Hurricane Lowell drop? | Lala has a published figure (1.3 trillion US gallons, UH News); Lowell has none (extreme_events.json lists no published volume), so it must be computed. | `uh-news-lala` |
| 15 | SPI-12 map for the state, August 2026 | `/viewer/spi-12/month/2026-08/statewide` | Chart the statewide drought index for the last 24 months | One map, against a time series drawn as a chart. | `spi-12-map` |

Signals the model should weigh:

- **Navigate words:** show, map, open, where is, link, download, zoom, next to, side by side, in inches, with the gauges, report, tracker.
- **Analysis words:** how much, total, average, which (most, least, hottest), rank, difference, compare the numbers, trend, change since, percent of normal, chart, plot, correlate, why.
- **Tie-breakers:** if an HCDP page already shows the value (a live gauge, a tracker total, the monthly summary's rank, a published figure), navigate there and say where on the page. Coordinates, "my sites" or "my plots" mean analysis. "Why" is always analysis.

## 4. (b) The dock after a navigation: three flows

Each flow starts in the landing page's box and continues in the dock. The address column is the current tab after the step; `open` and hand-off targets appear in a new tab and are named in the action column.

### A. County emergency manager during Tropical Storm Nolo (phone)

| Step | Visitor | Intent and actions | Current tab after | Dock shows |
|---|---|---|---|---|
| 1 | On `/` types *nolo rain big island* | `navigate`: navigate `/extreme-events#nolo`; open [Nolo tracker][nolo] (new tab) | `/extreme-events#nolo` | Minimizes. Reply: "Opened the Nolo Mesonet tracker in a new tab." Chips: *Yesterday's rain map* · *Hilo gauge now* · *Wind gusts now* |
| 2 | Taps *Yesterday's rain map* | `navigate` | `/viewer/rainfall/day/2026-09-24/hawaii` | *In inches* · *Show gauges* · *Day before* |
| 3 | Types *inches and gauges* | `navigate` (options change) | `/viewer/rainfall/day/2026-09-24/hawaii?units=in&stations=1` | *Now Maui* · *Extreme scale* · *Share this* |
| 4 | Types *now maui* | `navigate` (extent changes) | `/viewer/rainfall/day/2026-09-24/maui?units=in&stations=1` | *Day before* · *Share this* |
| 5 | Taps *Day before* | `navigate` (date − 1) | `/viewer/rainfall/day/2026-09-23/maui?units=in&stations=1` | *Next day* · *Share this* |
| 6 | Types *which gauge had the most?* | `analysis`: hand-off (new tab). Proposed ask: `Daily rainfall, 23 September 2026, Maui: which gauge had the most?`; today the ask is only the typed words | unchanged | Reply names the analysis AI; button *Open the analysis AI (new tab)* |
| 7 | Types *share this* | proposed `share` action, handled in the browser with no model call; on a viewer page it can trigger the page's own *Copy link* | unchanged | "Link copied" with the full address, or the phone's share sheet |

### B. Ikaika, a Kula farmer, checking drought (phone)

| Step | Visitor | Intent and actions | Current tab after | Dock shows |
|---|---|---|---|---|
| 1 | On `/` types *how dry is it up in kula* | `navigate` | `/viewer/spi-3/month/2026-08/statewide?lat=20.7700&lng=-156.3300&z=12` | Reply: "The 3-month drought index for August 2026, zoomed to Kula (SPI maps are statewide)." Chips: *12-month* · *Rain in August* · *Kula gauge now* |
| 2 | Taps *12-month* | `navigate` (dataset changes) | `/viewer/spi-12/month/2026-08/statewide?lat=20.7700&lng=-156.3300&z=12` | *Same for July* · *Rain in August* |
| 3 | Types *same for july* | `navigate` (date changes) | `/viewer/spi-12/month/2026-07/statewide?lat=20.7700&lng=-156.3300&z=12` | *Back to August* · *Rain in August* |
| 4 | Types *august rain in inches* | `navigate` (dataset, date, extent and units change; rainfall has island grids) | `/viewer/rainfall/month/2026-08/maui?units=in&lat=20.7700&lng=-156.3300&z=12` | *Kula gauge now* · *Compare with Aug 2025* · *August report* |
| 5 | Taps *Kula gauge now* | `navigate`: open [Kula gauge on the Mesonet app][m-0119] (new tab; proposed: the app on narrow screens, the [dashboard][st-0119] on wide ones) | unchanged | *Is this worse than normal?* · *August report* |
| 6 | Types *is this worse than normal?* | `analysis`: hand-off (new tab). Proposed ask: `Rainfall, August 2026, Maui near Kula (20.77, -156.33): is this worse than normal?` | unchanged | Button *Open the analysis AI (new tab)* |
| 7 | Taps *August report* | `navigate`: navigate `/climate-summary`; open [Climate Summary, Aug 2026][summary-aug] (new tab) | `/climate-summary` | *July report* · *Subscribe* |

### C. Teacher making slides about Hurricane Lowell (laptop)

| Step | Visitor | Intent and actions | Current tab after | Dock shows |
|---|---|---|---|---|
| 1 | On `/` types *percipitation map from hurricane lowell for my class* | `navigate` (a map was asked for, so the viewer is primary and the Lowell report an alternative) | `/viewer/rainfall/day/2026-09-07/kauai` | *In inches* · *Oʻahu* · *Open the report* |
| 2 | Types *inches please* | `navigate` | `/viewer/rainfall/day/2026-09-07/kauai?units=in` | *Extreme scale* · *Share this* |
| 3 | Types *it all looks the same colour, bigger range* | `navigate` | `/viewer/rainfall/day/2026-09-07/kauai?scale=extreme&units=in` | *Day before* · *Share this* |
| 4 | Types *put the day before next to it* | `navigate` (compare := the previous day; daily maps take `YYYY-MM-DD`) | `/viewer/rainfall/day/2026-09-07/kauai?scale=extreme&units=in&compare=2026-09-06` | *Zoom on Hanalei* · *Whole-storm total* |
| 5 | Taps *Zoom on Hanalei* | `navigate` (view changes; both panes follow) | `/viewer/rainfall/day/2026-09-07/kauai?scale=extreme&units=in&compare=2026-09-06&lat=22.2044&lng=-159.5010&z=13` | *Share this* · *Show gauges* |
| 6 | Taps *Share this* | proposed `share` action (the viewer page already has *Copy link*) | unchanged | Copies `https://<site>/viewer/rainfall/day/2026-09-07/kauai?scale=extreme&units=in&compare=2026-09-06&lat=22.2044&lng=-159.5010&z=13` |
| 7 | Types *how many inches fell in hanalei over the whole storm?* | `analysis`: hand-off (new tab). Proposed ask carries the Lowell window from the catalog (6 to 8 September 2026) and the point | unchanged | Button *Open the analysis AI (new tab)* |

### Follow-up grammar for the dock

How a follow-up rewrites the current viewer address. Examples start from `/viewer/rainfall/day/2026-09-07/kauai?units=in` unless stated. The server already receives the parsed view in `context.viewer`, so these are prompt rules, and simple ones could be handled without the model.

| Visitor says | Change | Result |
|---|---|---|
| *now Maui*, *Maui instead*, *same for the Big Island* | extent := maui / hawaii; everything else kept | `/viewer/rainfall/day/2026-09-07/maui?units=in` |
| *day before*, *next day* | date ± 1 day on a daily map, ± 1 month on a monthly map; never past the latest available date | `/viewer/rainfall/day/2026-09-06/kauai?units=in` |
| *same for August* | on a monthly map date := 2026-08; on a daily map switch to the August monthly map when the dataset has one, else ask which day | `/viewer/rainfall/month/2026-08/kauai?units=in` |
| *last year* | the same date one year earlier | `/viewer/rainfall/day/2025-09-07/kauai?units=in` |
| *compare with last year*, *next to the day before* | compare := the second date in the map's own format (`YYYY-MM` on monthly maps, `YYYY-MM-DD` on daily maps); a mismatched format is ignored by the viewer | `/viewer/rainfall/day/2026-09-07/kauai?units=in&compare=2025-09-07` |
| *in inches*, *in Fahrenheit*, *metric* | units := in / f / mm / c (rainfall takes in or mm, temperature f or c) | `/viewer/rainfall/day/2026-09-07/kauai?units=in` |
| *show the gauges*, *hide the stations* | stations := 1 / removed | `/viewer/rainfall/day/2026-09-07/kauai?units=in&stations=1` |
| *bigger range*, *extreme scale* | scale := extreme (daily rainfall only) | `/viewer/rainfall/day/2026-09-07/kauai?scale=extreme&units=in` |
| *zoom to Hanalei* | lat, lng and z from Appendix A | `/viewer/rainfall/day/2026-09-07/kauai?units=in&lat=22.2044&lng=-159.5010&z=13` |
| *drought instead* | dataset := spi-3, period := month, date := the last complete month at or before the current date; extent := statewide (SPI has no island grids) with lat, lng and z set to the current island | `/viewer/spi-3/month/2026-08/statewide?lat=22.0600&lng=-159.5000&z=10` |
| *temperature instead* | dataset := temperature-mean; keep period, date and extent; drop rainfall-only options | `/viewer/temperature-mean/day/2026-09-07/kauai` |
| *share this*, *copy the link* | no navigation; the client copies or shares the current address | unchanged |
| *how much*, *which*, *compare the numbers*, *why* | hand-off; the ask should carry the current view | unchanged, new tab for the AI interface |
| *go back* | browser history back (client side, no model call needed) | previous address |

## 5. (c) Deep links people will share

`<site>` stands for this site's public host (`SITE_ADDRESS`). The first kind of link is this site's viewer grammar; the others are shareable addresses that HCDP's own apps already support, which the navigator should hand out as well.

| # | Who | What they paste | Link | What the link encodes | Catalog ids |
|---|---|---|---|---|---|
| 1 | Teacher, Waimea (Kauaʻi) | Class, open this and find where the rain stops on the west side: that's the rain shadow. | `https://<site>/viewer/rainfall/month/2026-08/kauai?units=in` | dataset, month, island, inches | `rainfall-monthly-map` |
| 2 | Reporter | Rainfall on Kauaʻi on Sept. 7 as Hurricane Lowell passed, from UH's climate data portal: | `https://<site>/viewer/rainfall/day/2026-09-07/kauai?scale=extreme&units=in` | a storm's peak day, the 0-250 mm extreme scale, inches | `lowell-rainfall-map` |
| 3 | Rancher, Waimea (Hawaiʻi Island), to the cattlemen's group | Three-month drought index for August, zoomed on our side of the island. Have a look before Thursday. | `https://<site>/viewer/spi-3/month/2026-08/statewide?lat=20.0230&lng=-155.6718&z=11` | drought index, month, a Google-Maps-style view (SPI maps are statewide, so the view does the zooming) | `spi-3-map` |
| 4 | Water planner, in a memo | Twelve-month SPI for Maui, August 2026 beside August 2019: | `https://<site>/viewer/spi-12/month/2026-08/statewide?compare=2019-08&lat=20.8000&lng=-156.3000&z=10` | side by side (the closest thing to a YouTube timestamp: a second date; daily maps take a second day) | `spi-12-map` |
| 5 | County EM duty officer, EOC chat | Latest daily rain for Hawaiʻi Island with the gauges on, in inches: | `https://<site>/viewer/rainfall/day/2026-09-24/hawaii?units=in&stations=1` | day, island, gauges, inches | `rainfall-daily-map` |
| 6 | Fire crew lead | Yesterday's ignition probability for Maui: | `https://<site>/viewer/ignition/day/2026-09-24/maui` | a daily-only dataset | `ignition-daily-map` |
| 7 | Utility storm desk | Live Mesonet wind map. Keep it open during Nolo: | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/wind-map`‡ | a route inside HCDP's Mesonet viewer (the page forwards its #hash) | `mesonet-wind-map` |
| 8 | Hilo homeowner, neighbourhood group | Rain gauge at the forestry institute in Hilo, updates every 15 minutes: | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0281`‡ | one station's dashboard (`?id=` is the station number) | `mesonet-live-data` |
| 9 | Ikaika, a Kula farmer, texting a neighbour | Kula Ag Station on your phone: | `https://hawaiimesonet.app/station/0119` | one station in the Mesonet phone app | `hawaii-mesonet-app` |
| 10 | Journalist | UH's monthly climate summary for August, with island ranks: | `https://www.hawaii.edu/climate-data-portal/climate-summary/#/?year=2026&month=8`‡ | a month inside HCDP's Climate Summary (`?year=&month=`) | `climate-summary` |
| 11 | Scientist, team chat | Mānoa, March 2026 monthly rainfall with gauges (the Kona Low #2 flash floods): | `https://<site>/viewer/rainfall/month/2026-03/oahu?stations=1&lat=21.3100&lng=-157.8100&z=13` | month, gauges, exact view | `rainfall-monthly-map` |
| 12 | Someone typing a link into an email by hand | Big Island rain for October 21, 2025: | `https://<site>/viewer/rainfall/day/october/21/2025/hawaii` | loose date form the frontend parser accepts; the page should replace it with `/viewer/rainfall/day/2025-10-21/hawaii` | `rainfall-daily-map` |

Links people will type that do not work yet, and what should happen:

- `/viewer/rainfall/day/2026-09-06..2026-09-08/kauai` (a storm window): today "unreadable date". Support a range period, or show the three days and offer the hand-off for a total.
- `/viewer/rainfall/day/latest/kauai`: today "unreadable date". Accept `latest` and replace the address with the concrete date, so a shared link keeps meaning the same map.
- `/viewer/humidity/month/2026-08/statewide`: today an error page (humidity is daily only). Offer the last day of the month and the dock.
- `/viewer/rainfall/day/2026-09-07/kauai?compare=2026-09`: a month on a daily map. The viewer says the date does not fit and shows one map; the navigator should always emit the map's own date format.
- `/viewer/rainfall/day/2026-09-24/tutuila` or `.../guam`: unknown extent. Send the visitor to `/pacific`.
- `?place=hanalei` instead of `lat`/`lng`/`z`: an unknown option, which the backend's validator rejects. Worth adding, resolved through Appendix A, because people remember names, not coordinates.

## 6. (d) Gaps, by persona

What HCDP or this site would need so each persona's questions get a good answer. *Who can close it*: HCDP (portal, API, network), this site, the AI interface, an HCDP decision (policy), or outside HCDP (another agency; the navigator can only say so).

| Persona | Need | Example | Rows | Who can close it | Proposal, and what the navigator does meanwhile |
|---|---|---|---|---|---|
| Climate scientist | Uncertainty and anomaly layers | standard error map June 2026 | SC3 | this site | Add `layer=se\|anom\|anom_se` to the viewer grammar; `/raster` already serves `type=se\|anom\|anom_se\|metadata`. Meanwhile: `/data`. |
| Climate scientist | Rainfall before 1990 | legacy monthly rainfall 1920s | SC5 | this site | A `rainfall-legacy` dataset (monthly, 1920–2012, production=legacy). The viewer maps rainfall to production=new, which starts in 1990. Meanwhile: `/data`. |
| Climate scientist | Normals and projections | 1991–2020 normals; rainfall in 2100 | PL3, PL5 | this site | Viewer datasets for `contemporary_climatology` and `downscaling_rainfall` / `downscaling_temperature`, which `/raster` serves. Meanwhile: `/data`. |
| Climate scientist | A citation for the exact map | how do I cite this map | SC7 | this site | A "Cite this map" line under each viewer title: product citation from How to Cite plus dataset, date and access date. |
| Emergency response | Forecasts, warnings, storm position, flood stage | where is Nolo now | EM4, EM5, CI3, CI5, FA5 | HCDP decision | The catalog already carries NWS Honolulu (`nws-honolulu`, kind external), which makes weather.gov an allowed host. Decide whether to add the Central Pacific Hurricane Center and USGS the same way, and whether such links may be primary targets or only alternatives (this case book keeps them as alternatives). |
| Emergency response | Storm totals as one map | Lowell's total rain on Kauaʻi, as a map | TE4, flow C | this site | A range period, e.g. `/viewer/rainfall/range/2026-09-06..2026-09-08/kauai`, or `/viewer/event/lowell`; HCDP's own storm viewers already publish cumulative maps. Meanwhile: the peak day plus a hand-off for the total. |
| Emergency response | Fire risk for the coming days | fire danger today | EM6 | this site | Access Data offers predicted ignition probability 1 to 3 days ahead (API `lead01`–`lead03`); the viewer shows only the day-of map, which is yesterday's. Add a `lead=1\|2\|3` option for the ignition dataset. Meanwhile: yesterday's map plus `/data`. |
| Emergency response | Wind as a map | wind gusts now | EM7, JO5 | HCDP | The API has no wind product; wind exists as images inside event reports (hourly WindNinja maps) and as the Mesonet wind map. Meanwhile: open the Mesonet wind map. |
| Emergency response | Niʻihau | rain on Niʻihau during Lowell | — | HCDP | The rainfall grids cover seven islands and list Niʻihau as unavailable (extreme_events.json), though Lowell struck it. The navigator must say so. |
| Emergency response | A room behind one address | twenty people in an EOC asking at once | — | this site | `NAV_PER_MINUTE` is 12 per IP; a shared office or shelter network hits it. Raise the per-IP burst, or key the limit by a per-tab token. The 429 reply already carries alternatives. |
| Emergency response | Low bandwidth | any viewer map on a phone during a storm | EM1 | this site | `/api/raster` now re-encodes grids to about 1 MB (rasters.py), but the first request for a map still pulls the 2–15 MB original from HCDP. During an event, pre-fetch the latest day for each island so the first visitors do not wait. |
| Emergency response | Nolo on the portal's event index | storm reports | EM1, JO6 | HCDP | The Extreme Events index lists Lowell, Lala and both Kona lows but not Nolo, although `/nolo-mesonet-viewer/` is live. Add the card. |
| Researcher | Many sites, long series | monthly rain and temperature at my 12 plots, 2000–2020 | RE3 | AI interface | `/raster/timeseries` returns one grid cell's series in one small call; the AI interface should accept a CSV of coordinates. The navigator hands off. |
| Researcher | Derived indices | heat index in Honolulu | RE4 | AI interface | Heat index, degree days and vapour-pressure deficit are computable from HCDP temperature and humidity grids; the hand-off should say which inputs it uses. |
| Researcher | Design storms | 100-year 24-hour rainfall | RE5 | outside HCDP | NOAA Atlas 14. Info reply; offer HCDP's daily record. |
| Researcher | Sensor heights and depths | at what depth is soil moisture measured | RE7 | HCDP | `/mesonet/db/sensors` has them; the station pages do not show them. |
| Researcher | Land cover | fractional land cover 1999–2016 | — | HCDP | Downloadable through the API's file browser since August 2026 but linked from no page; add it to Access Data or the catalog. |
| Everyday citizen | The gauge nearest to me | is it raining in Hilo | CI1, EM2, FA3 | this site (catalog) | The catalog needs the 80 active Hawaiʻi and 10 American Samoa Mesonet stations with coordinates and place aliases (Appendix A) so the navigator can open the nearest dashboard, not just `/mesonet`. |
| Everyday citizen | Plain-language help for products | what is ignition probability | TE2 | HCDP / this site | The Climate Glossary is Hawaiian vocabulary; there is no plain-English glossary of product terms. Add a two-sentence "what am I looking at" to each viewer dataset. |
| Everyday citizen | Phones | is it raining, from a phone | CI1, flow B | this site | Prefer the Mesonet app's station page on narrow screens; send a viewport hint in `context`. |
| Everyday citizen | Things HCDP does not measure | vog, surf, UV | — | outside HCDP | Info reply; nothing to build. |
| Teacher or student | Classroom network | thirty students on one school address | — | this site | Same rate-limit issue as the EOC row. |
| Teacher or student | Slide-ready images | map for my slides | TE4 | this site | "Download PNG" on every viewer map with title, date, legend, units and credit line. |
| Teacher or student | Reply language | ke ua nei ma Hilo? | CI2 | HCDP decision | Decide whether the navigator answers in ʻŌlelo Hawaiʻi when asked in it (and in other languages spoken in Hawaiʻi). Either way, match place names with or without ʻokina and kahakō. |
| Teacher or student | West Kauaʻi has no active gauge | rain at my school in Waimea, Kauaʻi | TE5 | HCDP | The nearest active gauge is 17 km away; Polihale (0631) and Kitano Reservoir (0632) are planned. |
| Farmer or rancher | Drought declarations | USDM Maui County | FA4 | outside HCDP | The U.S. Drought Monitor is produced by the National Drought Mitigation Center with USDA and NOAA; say so and offer SPI and H-RIP. |
| Farmer or rancher | Rain since a date at my farm | rain this week in Kaunakakai | FA3 | AI interface | Hand-off for the total; the station's graphing page shows the series (up to 90 days) but not a sum. |
| Farmer or rancher | H-RIP address | rangeland drought | FA1 | HCDP / tool owner | The portal's Climate Tools page links `http://hrip.manoa.hawaii.edu/`; the catalog uses https. Neither was fetched here; check which works and correct the other. |
| Farmer or rancher | Daily evapotranspiration | how much to irrigate this week | — | HCDP | Only climatological ET (the atlas); no daily ET product. |
| Water or land-use planner | One division by link | August summary for one ahupuaʻa | PL6 | HCDP | The Climate Summary accepts `?year=&month=` but no division or name; add them so a memo can link one ahupuaʻa, moku or watershed. |
| Water or land-use planner | GIS files from a view | the GeoTIFF of this map | SC2, PL7 | this site | The viewer tells visitors it shows maps only and sends downloads to the portal. A GeoTIFF button would be cheap: the re-encoded file already sits in the `/api/raster` cache. |
| Journalist | Link previews | pasting a `/viewer/...` link into a chat or CMS | section 5 | this site | The server returns the same `index.html` for every path, so every deep link unfurls with the same generic card; the viewer sets `document.title` in the browser, which link unfurlers never run. Inject `<title>`, `og:title` ("Rainfall, 7 September 2026, Kauaʻi") and an `og:image` rendered for the view on the server. |
| Journalist | Embeds | embed your rain map | JO7 | this site / HCDP decision | An `/embed/viewer/...` route (map, legend, credit, link back) and a stated reuse policy. |
| Journalist | Published figures with their source | gallons from Lala | JO1 | this site (catalog) | Carry `published_claims` from extreme_events.json into the catalog so the navigator can quote a figure with its source instead of handing off. |
| Software developer | Docs behind the API | latest-date endpoint | DE5 | HCDP | `/datasets/date/range`, `/files/explore`, `/stations/value` and the acquisition endpoints are live but not in the published spec. |
| Software developer | Rate limits and token terms | rate limits? | DE8 | HCDP | Publish them on the API page. |
| Software developer | This site's link grammar | how do your map links work | DE7 | this site | Publish the CONTRACT.md grammar on a public page (for example a section of `/data/api`). |
| All | SPI has no island grids | drought map for Maui | CI6, FA4, PL1 | this site | HCDP publishes SPI statewide only (the API survey's file-tree probe; `_STATEWIDE_ONLY` in the AI interface's raster_spec.py), yet `navigator.py` and `urlGrammar.js` accept `/viewer/spi-3/month/2026-08/maui`, which asks the API for a grid that does not exist. Either reject island extents for spi-N and emit `/statewide` plus `lat`/`lng`/`z` (as this case book does), or fetch the statewide grid for spi-N and use the extent only as the view. |
| All | Dock missing on arrival | a visitor opens a shared `/viewer/...` link | section 5 | this site | `AssistantDock` returns nothing while the mode is `inline`, and `inline` is the starting mode, so people who arrive by a deep link never see the assistant. Show the pill on every page except `/`. |
| All | "Start over" hides the assistant | X on a viewer page | — | this site | `reset()` sets the mode to `inline`; off the landing page that renders nothing. Reset to `dock` there. |
| All | Hand-off loses the view | "which gauge had the most?" from the dock | flow A step 6 | this site | `handoff_url()` encodes only the typed message. Prefix the current view server-side: "Daily rainfall, 23 September 2026, Maui: which gauge had the most?". |
| All | "Yesterday" computed in UTC | any "latest" question after 14:00 HST | CI7, EM6 | this site | `Navigator.today()` uses the container's local date, which is UTC in python:3.12-slim unless `TZ` is set. From 14:00 HST, "yesterday" is today in Hawaiʻi and that map does not exist yet. Use `Pacific/Honolulu` and confirm with `/api/dates`. |
| All | NDVI and other lags | vegetation map yesterday | RE1 | this site | The prompt says daily maps run through yesterday; NDVI ran through 20 September on 24 September. Ask `/api/dates` per dataset before emitting a date. |
| All | New tabs blocked | every `open` action | EM1, CI1 | this site | `window.open` runs after `await fetch`, outside the click, so Safari and Firefox may block it and the visitor sees nothing. Check the return value and show an *Open …* button in the reply. |
| All | Follow-ups and sharing in the protocol | "share this" | all flows | this site | Add `followups: [str]` (2–3 chips) to the response and an action `{"type": "share", "path": …}` handled by the client. On viewer pages it can trigger the page's existing *Copy link* (`ShareActions` in `map/Controls.jsx`); elsewhere it needs its own clipboard or Web Share call. |
| All | Guam and American Samoa | Guam rainfall map | EM8 | this site + HCDP | Viewer extents are Hawaiʻi only. The API serves American Samoa daily rainfall (`location=american_samoa`); Guam is files only. Meanwhile: `/pacific` plus the portal's Guam and American Samoa pages. |

## 7. (e) Accessibility and mobile

Observations refer to `frontend/src/assistant/AssistantDock.jsx`, `AssistantPanel.jsx` and `AssistantProvider.jsx` as read on 25 September 2026.

**Dock presence and state**

- Show the pill on every page except `/` from the first load. Today the dock renders nothing while the mode is `inline`, which is the starting mode, so a visitor who opens a shared `/viewer/...` link never sees the assistant.
- *Start over* (the X) calls `reset()`, which sets the mode to `inline`; off the landing page the assistant then disappears. Reset to `dock` there, and ask for confirmation before clearing a conversation.
- Give the pill `aria-expanded` and `aria-controls`. Escape minimizes the panel and returns focus to the pill; opening puts focus in the input (the panel already autofocuses).
- The panel is a non-modal dialog: keep `role="dialog"` with `aria-modal="false"` (or use `role="complementary"`) and do not trap focus.

**Announcements**

- The whole message list carries `aria-live="polite"`, so screen readers may re-read it on every render. Keep one visually hidden live region that announces only the newest reply, and a status line for navigations ("Opened: Rainfall, 7 September 2026, Kauaʻi").
- After a navigation, move focus to the new page's `h1` (the viewer's `describeViewer()` text), so the change of page is perceivable without sight.
- "Looking…" should be `role="status"`; mark the log `aria-busy` while waiting.

**Links and new tabs**

- External alternatives show an icon marked `aria-hidden`; add visually hidden "(opens in a new tab)" text, since CONTRACT.md requires external links to say so. The hand-off button should read *Open the analysis AI (new tab)*.
- `open` and `handoff` actions call `window.open` after `await fetch`, outside the click that started them; Safari and Firefox may block that and the visitor sees nothing. Check the return value and show an *Open ...* button in the reply.
- On phones a new tab strands the dock in the old tab. On narrow screens prefer same-tab navigation to the internal page that frames the external one, with the external link as a button.

**Phones and touch**

- The panel is `h-[480px] w-[360px]`; with the keyboard up on a 667 px-tall phone the input can be pushed off screen. Below 640 px use a bottom sheet: full width, `max-height: calc(100dvh - 4rem)`, bottom padding `env(safe-area-inset-bottom)`.
- The input uses `text-sm` (14 px); iOS Safari zooms the page when an input under 16 px is focused. Use 16 px on small screens.
- Minimize and Start-over are about 24 px squares (`p-1` around a 16 px icon); make touch targets 44 px.
- The pill sits at `bottom-4 right-4`, which is where Leaflet puts its attribution by default and where a legend tends to go; on `/viewer/*` reserve that corner or move the pill to the left.
- Add `enterKeyHint="send"` and `autoCapitalize="sentences"` to the textarea; phone dictation then works without a microphone button.

**Maps and content**

- A map must not carry its meaning in colour alone: each viewer page needs a text title (dataset, date, place), the units, the legend's values as text and the no-data colour named.
- Keep the portal's Viridis defaults, which are colour-blind safe; `nwsradar` and `rdylgn` (both in `NAMED_RAMPS`) are not, so offer them only on request.
- Accept ʻokina written as ʻ ' ‘ ` or left out, and kahakō or plain vowels, when matching places (Kauaʻi, Kaua'i, Kauai); display the correct spelling in replies.
- Check `text-subtle` on `bg-surface` for 4.5:1 contrast in both themes (alternative reasons and example chips use it). Support `forced-colors`; if the minimize is ever animated, respect `prefers-reduced-motion`.

**Slow and failing networks**

- Emergency users ask on congested networks: time out the navigator call after about 10 s on the client (the `fetch` has no timeout today) and show the tool cards and keyword matches.
- The 429 reply and the model-down fallback both return alternatives; render them as ordinary chips so the visitor still gets somewhere.
- Rasters reach the browser at about 1 MB after the backend re-encodes them; still show the map title and legend before the raster arrives, and keep the last good map on screen if a request fails.

## 8. (f) Acceptance tests for POST /api/navigate

Ten request and expectation pairs. Context is `{"path": "/"}` unless stated. `P` is `https://www.hawaii.edu/climate-data-portal/`.

| # | Message | Expected intent | Expected action | Fails if | Catalog ids |
|---|---|---|---|---|---|
| T1 | `hurrican lowel rainfal data download` | navigate | open `P/hurricane-lowell/` or navigate `/extreme-events#lowell`; `minimize` true | neither target; typos not tolerated | `lowell` |
| T2 | `rainfall map for Kauai on September 7 2026` | navigate | navigate `/viewer/rainfall/day/2026-09-07/kauai` (options allowed) | any other path | `lowell-rainfall-map` |
| T3 | `drought map for Maui August 2026` | navigate | navigate `/viewer/spi-N/month/2026-08/statewide`, N in 1, 3, 6, 9, 12, 24 (spi-3 preferred), ideally with `lat`/`lng`/`z` on Maui | an island extent (SPI grids are statewide only, so the map would not load), a daily or a non-SPI path | `spi-3-map` |
| T4 | `what was the total rainfall at Hilo during Hurricane Lowell?` | analysis | exactly one `handoff` whose url starts with `AI_INTERFACE_URL/?ask=` and contains `Hilo`; no navigate or open; `minimize` false | any navigation, or no hand-off | `hcdp-ai-interface` |
| T5 | `Is it raining in Hilo right now?` | navigate | open `P/hawaii-mesonet-data/` (ideally `#/dashboard?id=0281`) or `https://hawaiimesonet.app/...`, or navigate `/mesonet` | a `/viewer/` path: grids are daily, not live | `mesonet-live-data` |
| T6 | `where is the tropical storm nolo tracker` | navigate | open `P/nolo-mesonet-viewer/` or `https://cherryleh.github.io/climate-summary/#/nolo-viewer`, or navigate `/extreme-events#nolo` | anything else | `nolo` |
| T7 | `American Samoa rainfall` | navigate | navigate `/pacific`, or open `P/americansamoaportal/`, `P/american-samoa-...` or `https://hcdp.github.io/ascdp/` | a `/viewer/` path: there is no American Samoa extent | `pacific-portal` |
| T8 | `what's the weather forecast for Kula this weekend?` | info | no navigate or open; the reply names the National Weather Service | any navigation | `nws-honolulu` |
| T9 | `humidity map for August 2026` | navigate or clarify | navigate `/viewer/humidity/day/2026-08-DD/<extent>`, or clarify which day | `/viewer/humidity/month/...`, which the server drops, degrading to info | `humidity-daily-map` |
| T10 | `now show Maui`; context path `/viewer/rainfall/day/2026-09-07/kauai?units=in` with the parsed view, and two history turns | navigate | navigate `/viewer/rainfall/day/2026-09-07/maui` (keeping `units=in` preferred) | another date or dataset | `rainfall-daily-map` |

### Runner

Standard library only; paced at one request every 6 s because `/api/navigate` allows 12 per minute per address (`NAV_PER_MINUTE`). It was checked against a stub server returning the ideal answers (10/10), not against the live model.

```python
"""Acceptance tests for POST /api/navigate (docs/USE_CASES.md, section f).

    BASE=http://localhost:8010 AI=https://hcdp-ai-interface.cis251375.projects.jetstream-cloud.org python acceptance.py

Standard library only. Paced at one request every 6 s to stay under the
navigator's per-IP limit (12/min). Dates assume the tests run on 2026-09-25 HST;
move them with the calendar.
"""
import json, os, re, sys, time, urllib.request

BASE = os.environ.get("BASE", "http://localhost:8010").rstrip("/")
AI = os.environ.get("AI", "https://hcdp-ai-interface.cis251375.projects.jetstream-cloud.org").rstrip("/")
P = "https://www.hawaii.edu/climate-data-portal/"
VIEW_KAUAI = "/viewer/rainfall/day/2026-09-07/kauai?units=in"

def primary(r):
    return next((a.get("path") or a.get("url") for a in r["actions"] if a["type"] in ("navigate", "open")), "")

def targets(r):
    return [a.get("path") or a.get("url") or "" for a in r["actions"] if a["type"] in ("navigate", "open")]

def any_t(r, *prefixes):
    return any(t.startswith(p) for t in targets(r) for p in prefixes)

TESTS = [
    ("T1 typo storm -> report", "hurrican lowel rainfal data download", {"path": "/"}, [],
     lambda r: r["intent"] == "navigate" and any_t(r, P + "hurricane-lowell/", "/extreme-events#lowell") and r["minimize"]),
    ("T2 exact daily map", "rainfall map for Kauai on September 7 2026", {"path": "/"}, [],
     lambda r: r["intent"] == "navigate" and primary(r).split("?")[0] == "/viewer/rainfall/day/2026-09-07/kauai"),
    ("T3 drought month map", "drought map for Maui August 2026", {"path": "/"}, [],  # SPI grids are statewide only
     lambda r: r["intent"] == "navigate" and re.match(r"^/viewer/spi-(1|3|6|9|12|24)/month/2026-08/statewide", primary(r))),
    ("T4 analysis hand-off", "what was the total rainfall at Hilo during Hurricane Lowell?", {"path": "/"}, [],
     lambda r: r["intent"] == "analysis" and not targets(r) and not r["minimize"]
     and [a["url"].startswith(AI + "/?ask=") and "Hilo" in a["url"] for a in r["actions"] if a["type"] == "handoff"] == [True]),
    ("T5 live station", "Is it raining in Hilo right now?", {"path": "/"}, [],
     lambda r: r["intent"] == "navigate" and any_t(r, P + "hawaii-mesonet-data/", "/mesonet", "https://hawaiimesonet.app/")
     and not any_t(r, "/viewer/")),
    ("T6 Nolo tracker", "where is the tropical storm nolo tracker", {"path": "/"}, [],
     lambda r: r["intent"] == "navigate" and any_t(r, P + "nolo-mesonet-viewer/", "https://cherryleh.github.io/climate-summary/#/nolo-viewer", "/extreme-events#nolo")),
    ("T7 American Samoa", "American Samoa rainfall", {"path": "/"}, [],
     lambda r: r["intent"] == "navigate" and any_t(r, "/pacific", P + "americansamoaportal/", P + "american-samoa", "https://hcdp.github.io/ascdp/")
     and not any_t(r, "/viewer/")),
    ("T8 forecast is info", "what's the weather forecast for Kula this weekend?", {"path": "/"}, [],
     lambda r: r["intent"] == "info" and not targets(r) and "National Weather Service" in r["reply"]),
    ("T9 daily-only dataset", "humidity map for August 2026", {"path": "/"}, [],
     lambda r: (r["intent"] == "clarify" and not targets(r))
     or (r["intent"] == "navigate" and re.match(r"^/viewer/humidity/day/2026-08-\d\d/[a-z]+", primary(r)))),
    ("T10 follow-up keeps context", "now show Maui",
     {"path": VIEW_KAUAI, "viewer": {"dataset": "rainfall", "period": "day", "date": "2026-09-07", "extent": "kauai", "opts": {"units": "in"}}},
     [{"role": "user", "content": "rainfall map for Kauai on September 7 2026"},
      {"role": "assistant", "content": "Opened daily rainfall for 7 September 2026 on Kauai."}],
     lambda r: r["intent"] == "navigate" and primary(r).split("?")[0] == "/viewer/rainfall/day/2026-09-07/maui"),
]

def post(message, context, history):
    body = json.dumps({"message": message, "history": history, "context": context}).encode()
    req = urllib.request.Request(BASE + "/api/navigate", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)

failed = 0
for i, (name, message, context, history, check) in enumerate(TESTS):
    if i:
        time.sleep(6)
    try:
        r = post(message, context, history)
        ok = bool(check(r))
    except Exception as e:  # a 429 or a network error counts as a failure to rerun
        r, ok = {"intent": type(e).__name__, "actions": []}, False
    failed += not ok
    print(("PASS " if ok else "FAIL ") + name + " | intent=" + str(r.get("intent")) + " | " + (primary(r) if r.get("actions") is not None else ""))
print(str(len(TESTS) - failed) + "/" + str(len(TESTS)) + " passed")
sys.exit(1 if failed else 0)
```

Notes:

- Model output varies between runs. Run the set three times and count a test as passing when it passes at least twice; file every single failure with its `reply`.
- A 429 prints as `FAIL ... intent=HTTPError`; wait a minute and rerun.
- The same cases fit `backend/eval_usecases.py`, which runs the navigator in-process, in the `usecases.json` shape, for example `{"id": "T2", "persona": "acceptance", "query": "rainfall map for Kauai on September 7 2026", "context": {"path": "/"}, "expected_intent": "navigate", "expected_path_prefix": "/viewer/rainfall/day/2026-09-07/kauai"}`.

## Appendix A. Place names, extents and nearest gauges

Town-centre coordinates are approximate (to about 1 km) and are what the navigator would put in `lat`/`lng`; `z` is the suggested zoom. Station ids, names, status and coordinates come from `csv_data/stations/station_metadata.csv` in [HCDP/loggernet_station_data][gh-stations] (main, read 25 September 2026: 108 Hawaiʻi stations of which 80 active, plus 10 in American Samoa). Distances are great-circle from the town centre to active stations. Dashboard links follow the pattern `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=<station id>`‡; phone links `https://hawaiimesonet.app/station/<station id>`.

| Place | Typed as | Resolves to | Extent | Zoom: lat, lng, z | Nearest active gauges | Note |
|---|---|---|---|---|---|---|
| Hilo | hilo | Hawaiʻi Island | hawaii | 19.7241, -155.0868, 12 | 0281 Institute of Pacific Islands Forestry 3.1 km; 0213 Piʻihonua 10.7 km | — |
| Waimea (Kamuela) | waimea, kamuela | Hawaiʻi Island when the query says ranch, rangeland, pasture, Kamuela, Parker or Big Island | hawaii | 20.0230, -155.6718, 11 | 0252 Lālāmilo 0.7 km; 0256 Mealani 6.9 km | ambiguous: three Waimeas |
| Waimea (Kauaʻi) | waimea kauai, waimea canyon | Kauaʻi | kauai | 21.9570, -159.6690, 12 | 0621 Lāwaʻi NTBG 17.3 km | no active gauge on the west side; Polihale 0631 and Kitano Reservoir 0632 are planned |
| Waimea Bay | waimea bay, north shore | Oʻahu | oahu | 21.6417, -158.0660, 13 | 0551 Kalaheʻe Ridge 2.8 km | — |
| Hanalei | hanalei | Kauaʻi | kauai | 22.2044, -159.5010, 13 | 0601 Waipā 1.8 km; 0603 Lower Limahuli 7.8 km | — |
| Kula | kula, upcountry | Maui | maui | 20.7700, -156.3300, 12 | 0119 Kula Agricultural Experiment Station 1.7 km; 0118 Pūlehu 4.2 km | — |
| Kaunakakai | kaunakakai | Molokaʻi | molokai | 21.0906, -157.0226, 12 | 0422 Nāʻiwa 7.5 km; 0421 Kualapuʻu 7.5 km | — |
| Lahaina | lahaina | Maui | maui | 20.8783, -156.6825, 12 | 0131 Lahaina Water Treatment Plant 3.2 km; 0132 Olowalu 9.5 km | — |
| Kailua-Kona | kona, kailua-kona | Hawaiʻi Island | hawaii | 19.6400, -155.9969, 12 | 0241 Keahuolū 5.2 km; 0286 Pālamanui 10.8 km | — |
| Kailua (Oʻahu) | kailua | Oʻahu, unless the query says Kona | oahu | 21.4022, -157.7394, 13 | 0533 Maunawili Pālāwai 4.5 km | ambiguous |
| Līhuʻe | lihue | Kauaʻi | kauai | 21.9811, -159.3711, 12 | 0641 Hanamāʻulu 8.0 km | — |
| Lānaʻi City | lanai city | Lānaʻi | lanai | 20.8275, -156.9203, 12 | 0302 Maunalei Mauka 3.0 km; 0301 ʻĀwehi 7.6 km | — |
| Mānoa | manoa | Oʻahu | oahu | 21.3100, -157.8100, 13 | 0501 Lyon Arboretum 2.7 km | — |
| Hāna | hana | Maui | maui | 20.7575, -155.9884, 12 | 0165 Hāmoa 4.5 km | — |
| Volcano | volcano, kilauea | Hawaiʻi Island | hawaii | 19.4330, -155.2340, 12 | 0201 Nāhuku 2.0 km | — |
| Pāhoa | pahoa, puna | Hawaiʻi Island | hawaii | 19.4944, -154.9453, 12 | 0204 Pāhoa 0.8 km | — |
| Kīhei | kihei | Maui | maui | 20.7644, -156.4450, 12 | 0121 Līpoa 2.6 km | — |
| Haleakalā summit | haleakala | Maui | maui | 20.7097, -156.2533, 13 | 0153 Haleakalā Summit 0.4 km; 0152 Nēnē Nest 3.3 km | — |
| Big Island | big island, hawaii island | Hawaiʻi Island | hawaii | — | — | "Hawaii" alone means the state unless a Hawaiʻi Island place is named |
| Maui County, Maui Nui | maui county | Maui County | maui | — | — | the Maui County grid also covers Molokaʻi, Lānaʻi and Kahoʻolawe |
| Niʻihau | niihau | not covered by the rainfall grids | (none) | — | — | say so; extreme_events.json lists Niʻihau as unavailable |
| Pago Pago, Tutuila | pago pago, american samoa | American Samoa | (none) | — | 1313 Vaipito 1.0 km; 1411 Nuʻuuli 3.2 km | navigate `/pacific`; open [American Samoa Mesonet live][as-mesonet] or the [American Samoa portal][as-portal] |
| Guam | guam | Guam | (none) | — | — | navigate `/pacific`; open the [Guam Data Viewer][guam] |

## Appendix B. Links and their verification

Every external link used above. Status: **200** = answered HTTP 200 on 25 September 2026 (curl, following redirects, one request at least 1.2 s after the previous); **redirect** = reached through a verified redirect; **derived‡** = route read from the app's code, host page 200; **seen†** = taken from a source file, not fetched.

| Label | URL | Status | Note |
|---|---|---|---|
| [2025 Annual Climate Report][annual] | `https://www.hawaii.edu/climate-data-portal/annual-report/` | 200 | embeds cherryleh.github.io/climate-summary/#/climate-summary-2025 |
| [A Century of Drought][drought-century] | `https://www.hawaii.edu/climate-data-portal/a-century-of-drought-in-hawaii/` | 200 | research highlight |
| [Access Data][access] | `https://www.hawaii.edu/climate-data-portal/data-portal/` | 200 | embeds https://rainfall.ikewai.org (the portal's map viewer) |
| [American Samoa Mesonet live][as-mesonet] | `https://www.hawaii.edu/climate-data-portal/american-samoa-mesonet-live-data-access/` | 200 | — |
| [American Samoa portal][as-portal] | `https://www.hawaii.edu/climate-data-portal/americansamoaportal/` | 200 | — |
| [Annual report PDF][annual-pdf] | `https://www.hawaii.edu/climate-data-portal/wp-content/uploads/2026/02/2025-Climate-Report-Final_HCDP_Library.pdf` | 200 | HEAD only: application/pdf, 10.1 MB |
| [Avian malaria tool][avian-malaria] | `https://www.hawaii.edu/climate-data-portal/developing-a-real-time-tool-to-identify-the-likelihood-of-avian-malaria-insitu-development-to-help-the-targeting-of-mosquito-control-efforts/` | 200 | research highlight |
| [Climate Glossary][glossary] | `https://www.hawaii.edu/climate-data-portal/climate-glossary/` | 200 | Hawaiian-language climate terms (ua, pāuli ...) |
| [Climate of Hawaiʻi][climate-atlas] | `https://www.hawaii.edu/climate-data-portal/climate-atlas/` | 200 | — |
| [Climate Tools][tools] | `https://www.hawaii.edu/climate-data-portal/climate-tools/` | 200 | — |
| [Cloud water interception][cloud-water] | `https://www.hawaii.edu/climate-data-portal/cloud-water-interception-in-hawaii/` | 200 | research highlight |
| [Cultural Resources][cultural] | `https://www.hawaii.edu/climate-data-portal/news/` | 200 | the nav label for /news/ |
| [Downscaling 2026-2035][downscaling] | `https://www.hawaii.edu/climate-data-portal/dynamical-downscaling-of-near-term-2026-2035-climate-variability-and-change-for-the-main-hawaiian-islands/` | 200 | research highlight |
| [Drought and Maui drinking water][drought-maui-water] | `https://www.hawaii.edu/climate-data-portal/drought-effects-on-drinking-water-supply-on-maui/` | 200 | research highlight |
| [Dryland Agriculture][dryland] | `https://www.hawaii.edu/climate-data-portal/dryland-agriculture/` | 200 | — |
| [Educational Resources][edu] | `https://www.hawaii.edu/climate-data-portal/educational-resources/` | 200 | books, web, courses, videos, factsheets |
| [Evapotranspiration atlas][et-atlas] | `https://www.hawaii.edu/climate-data-portal/evapotranspiration-atlas/` | 200 | — |
| [Export Data Tutorial][tut-export] | `https://www.hawaii.edu/climate-data-portal/export-data-tutorial/` | 200 | — |
| [Factsheets][factsheets] | `https://www.hawaii.edu/climate-data-portal/factsheets/` | 200 | — |
| [Gridded SPI for Hawaiʻi][spi-highlight] | `https://www.hawaii.edu/climate-data-portal/long-term-gridded-standardized-precipitation-index-for-hawai/` | 200 | research highlight |
| [Guam Data Viewer][guam] | `https://www.hawaii.edu/climate-data-portal/guam-data-viewer/` | 200 | embeds https://hcdp.github.io/gcdp/ |
| [Hawaiian Moon Calendar][moon] | `https://www.hawaii.edu/climate-data-portal/hawaiian-lunar-calendar/` | 200 | links a classroom calendar PDF |
| [Hawaiʻi Mesonet][mesonet-page] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet/` | 200 | — |
| [HCDP / Mesonet API page][api-page] | `https://www.hawaii.edu/climate-data-portal/hcdp-hawaii-mesonet-api/` | 200 | token request form |
| [HCDP API notebook][api-notebook] | `https://github.com/HCDP/hcdp_api_notebook` | 200 | Python examples for the API |
| [HCDP on GitHub][gh-hcdp] | `https://github.com/HCDP` | 200 | — |
| [hcdp_api_docs repo][api-repo] | `https://github.com/HCDP/hcdp_api_docs` | 200 | hcdp_api.yaml, OpenAPI 3.0.4 |
| [Hilo gauge on the Mesonet app][m-0281] | `https://hawaiimesonet.app/station/0281` | 200 | route /station/:stationId in the app bundle; server answers 200 |
| [How to Cite][cite] | `https://www.hawaii.edu/climate-data-portal/how-to-cite-3/` | 200 | — |
| [Indigenous Drought Perspective][indigenous-drought] | `https://www.hawaii.edu/climate-data-portal/climate-perspective/` | 200 | — |
| [Kaʻala cloud-water station][kaala] | `https://www.hawaii.edu/climate-data-portal/ka%ca%bbala-station/` | 200 | research highlight |
| [Kona Low #1 viewer][kona1] | `https://www.hawaii.edu/climate-data-portal/2026-kona-low-1/` | 200 | 10-16 Mar 2026 |
| [Kona Low #2 viewer][kona2] | `https://www.hawaii.edu/climate-data-portal/2026-kona-low-2/` | 200 | 17-23 Mar 2026 |
| [Kula gauge on the Mesonet app][m-0119] | `https://hawaiimesonet.app/station/0119` | 200 | same pattern |
| [Lala report][lala] | `https://www.hawaii.edu/climate-data-portal/hurricane-lala/` | 200 | — |
| [Library][library] | `https://www.hawaii.edu/climate-data-portal/publications-list/` | 200 | — |
| [Lowell Kauaʻi/Oʻahu focus][lowell-focus] | `https://www.hawaii.edu/climate-data-portal/hurricane-lowell-kauai-and-oahu-focus/` | 200 | every station on one island, shared y-axis |
| [Lowell Mesonet viewer][lowell-viewer] | `https://www.hawaii.edu/climate-data-portal/hurricane-lowell-viewer/` | 200 | — |
| [Lowell report][lowell] | `https://www.hawaii.edu/climate-data-portal/hurricane-lowell/` | 200 | story map: hourly wind maps, daily rainfall 6-8 Sep, waves, gust animation |
| [Mesonet Live Data Access][mesonet-live] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/` | 200 | WordPress page that forwards its #hash to cherryleh.github.io/mesonet |
| [Monthly Climate Summary][summary] | `https://www.hawaii.edu/climate-data-portal/climate-summary/` | 200 | WordPress page that forwards its #hash to cherryleh.github.io/climate-summary |
| [Nolo tracker][nolo] | `https://www.hawaii.edu/climate-data-portal/nolo-mesonet-viewer/` | 200 | live since 22 Sep 2026 22:00 HST; rainfall-total and max-gust modes |
| [Rainfall Mapping History][rf-history] | `https://www.hawaii.edu/climate-data-portal/rainfall-mapping-history/` | 200 | — |
| [Recharge tool highlight][recharge-highlight] | `https://www.hawaii.edu/climate-data-portal/hawai%ca%bbi-groundwater-recharge-tool/` | 200 | research highlight |
| [Research Highlights][research] | `https://www.hawaii.edu/climate-data-portal/research-highlights/` | 200 | — |
| [Solar Radiation atlas][solar-atlas] | `https://www.hawaii.edu/climate-data-portal/solar-radiation-atlas/` | 200 | — |
| [station metadata repo][gh-stations] | `https://github.com/HCDP/loggernet_station_data` | 200 | csv_data/stations/station_metadata.csv, read for Appendix A |
| [Streamflow extremes][streamflow] | `https://www.hawaii.edu/climate-data-portal/shifting-magnitude-and-timing-of-streamflow-extremes-and-the-relationship-with-rainfall-across-the-hawaiian-islands/` | 200 | research highlight |
| [Team][team] | `https://www.hawaii.edu/climate-data-portal/team/` | 200 | — |
| [Temperature trends 1917-2016][temp-trends] | `https://www.hawaii.edu/climate-data-portal/temperature-trends-in-hawai%ca%bbi-a-century-of-change-1917-2016/` | 200 | research highlight |
| [Tutorial: download a map][tut-map] | `https://www.hawaii.edu/climate-data-portal/visualize-data-tutorial/` | 200 | — |
| [Tutorial: station data][tut-station] | `https://www.hawaii.edu/climate-data-portal/visualize-data-tutorial-explore-station-data/` | 200 | — |
| [Rainfall Atlas][atlas] | `https://rainfall.geography.hawaii.edu/` | redirect | https://www.hawaii.edu/climate-data-portal/rainfall-atlas/ redirects here (200) |
| [Climate Summary, Aug 2026][summary-aug] | `https://www.hawaii.edu/climate-data-portal/climate-summary/#/?year=2026&month=8` | derived‡ | root route reads ?year=&month= (clamped to the latest month) |
| [Haleakalā Park HQ 0151][st-0151] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0151` | derived‡ | — |
| [Haleakalā Summit 0153][st-0153] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0153` | derived‡ | — |
| [Hilo gauge 0281][st-0281] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0281` | derived‡ | Institute of Pacific Islands Forestry, Hilo; the Mesonet app builds these dashboard links itself |
| [Kaʻala 0521][st-0521] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0521` | derived‡ | — |
| [Kualapuʻu 0421 graphs][st-0421-graph] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/graphing?id=0421` | derived‡ | graphing route reads ?id=; the catalog describes graphs over up to 90 days |
| [Kula Ag Station 0119][st-0119] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0119` | derived‡ | Kula Agricultural Experiment Station, 964 m |
| [Lyon Arboretum 0501][st-0501] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0501` | derived‡ | Mānoa, Oʻahu |
| [Lālāmilo 0252 (Waimea)][st-0252] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0252` | derived‡ | 0.7 km from Waimea town, Hawaiʻi Island |
| [Lāwaʻi NTBG 0621][st-0621] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0621` | derived‡ | nearest active gauge to Waimea, Kauaʻi (17 km) |
| [Lāʻie 0552][st-0552] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0552` | derived‡ | new station, reporting since August 2026 |
| [Mesonet station map][mesonet-map] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/station-map` | derived‡ | route station-map |
| [Mesonet station table][mesonet-table] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/station-table` | derived‡ | route station-table |
| [Mesonet wind map][mesonet-wind] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/wind-map` | derived‡ | route wind-map |
| [Mesonet, American Samoa view][mesonet-as] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/american-samoa` | derived‡ | route american-samoa |
| [Nāʻiwa 0422][st-0422] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0422` | derived‡ | about 7.5 km from Kaunakakai |
| [Waipā 0601 (Hanalei)][st-0601] | `https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0601` | derived‡ | — |
| [American Samoa data viewer][as-viewer] | `https://hcdp.github.io/ascdp/` | seen† | Climate Tools page (scraped) |
| [API docs][api-docs] | `https://hcdp.github.io/hcdp_api_docs/` | seen† | linked from the API page (scraped) |
| [CCVD climate portfolios][ccvd] | `https://ccvd.manoa.hawaii.edu/` | seen† | Climate Tools page (scraped) |
| [Groundwater Recharge Tool][recharge] | `https://recharge.ikewai.org/#/workspace` | seen† | Climate Tools page (scraped) |
| [H-RIP rangeland portal][hrip] | `http://hrip.manoa.hawaii.edu/` | seen† | Climate Tools page (scraped); plain http |
| [NWS Honolulu][nws] | `https://www.weather.gov/hfo/` | seen† | catalog.json entry nws-honolulu (kind external); not fetched |
| [Rainfall Atlas downloads][atlas-downloads] | `https://rainfall.geography.hawaii.edu/downloads` | seen† | catalog.json entry rainfall-atlas-downloads |
| [Rainfall Atlas map][atlas-map] | `https://rainfall.geography.hawaii.edu/interactive-map` | seen† | catalog.json entry rainfall-atlas-interactive-map; click a point for mean monthly rainfall |
| [Sea Level Rise Viewer][slr] | `https://www.pacioos.hawaii.edu/shoreline/slr-hawaii/` | seen† | Climate Tools page (scraped) |
| [SOEST Coastal Viewer][soest-coastal] | `https://www.soest.hawaii.edu/crc/slr-viewer/` | seen† | Climate Tools page (scraped) |
| [UH News on Lala][news-lala] | `https://www.hawaii.edu/news/2026/08/20/hurricane-lala/` | seen† | backend/data/extreme_events.json: 1.3 trillion US gallons, 14-16 Aug |
| [UH News on the March floods][news-march] | `https://www.hawaii.edu/news/2026/03/31/hawaii-mesonet-flooding-data/` | seen† | backend/data/extreme_events.json |

## Appendix C. Sources and method

- `CONTRACT.md`, `README.md`.
- `backend/navigator.py` (seed catalog, system prompt, path and host validation, hand-off URL, keyword fallback), `backend/app.py` and `backend/ratelimit.py` (12 requests per minute and 120 per hour per address, 5,000 per day overall), `backend/eval_usecases.py`, `backend/tests/`.
- `frontend/src/assistant/*.jsx` (dock and panel behaviour), `frontend/src/viewer/urlGrammar.js` (grammar, loose date forms), `rasterSpec.reference.js` (ramp names), `frontend/src/site/nav.js`, `frontend/src/pages/Landing.jsx`.
- `backend/data/hcdp_pages_scraped.json` (20 portal pages, their links and iframes); `backend/data/extreme_events.json` (version 2, as of 17 September 2026: Lala, the March 2026 Kona storms, Lowell, with windows, sources and published claims).
- The API and GitHub survey digest (52 confirmed findings) in the session scratchpad and its public report `hcdp-queries/query_responses/2026-09-24_hcdp-api-and-github-survey.md` (dataset date ranges, anomaly and error layers, normals, projections, Nolo, Kona lows, Mesonet stations, American Samoa and Guam).
- Live checks on 25 September 2026, one request at a time at least 1.2 s apart: the portal home page and its navigation; the portal's WordPress page search (`/wp-json/wp/v2/pages?search=`, 15 terms) to find the annual report, both Kona low pages, the Lowell focus page, the glossary, the moon calendar and the education pages; HTTP status of every unmarked link in Appendix B; the JavaScript bundles of `cherryleh.github.io/mesonet`, `cherryleh.github.io/climate-summary` and `hawaiimesonet.app` for their routes and URL parameters; the station metadata CSV through github.com.
- Not fetched: hcdp.github.io, ccvd.manoa.hawaii.edu, hrip.manoa.hawaii.edu, recharge.ikewai.org, pacioos.hawaii.edu, soest.hawaii.edu, rainfall.ikewai.org, UH News articles and the AI interface (marked †). Rendering of hash routes inside the embedded apps was not tested (marked ‡).

[spi-highlight]: https://www.hawaii.edu/climate-data-portal/long-term-gridded-standardized-precipitation-index-for-hawai/
[access]: https://www.hawaii.edu/climate-data-portal/data-portal/
[tut-export]: https://www.hawaii.edu/climate-data-portal/export-data-tutorial/
[api-docs]: https://hcdp.github.io/hcdp_api_docs/
[cite]: https://www.hawaii.edu/climate-data-portal/how-to-cite-3/
[atlas]: https://rainfall.geography.hawaii.edu/
[rf-history]: https://www.hawaii.edu/climate-data-portal/rainfall-mapping-history/
[summary-aug]: https://www.hawaii.edu/climate-data-portal/climate-summary/#/?year=2026&month=8
[library]: https://www.hawaii.edu/climate-data-portal/publications-list/
[nolo]: https://www.hawaii.edu/climate-data-portal/nolo-mesonet-viewer/
[mesonet-wind]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/wind-map
[mesonet-live]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/
[st-0281]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0281
[m-0281]: https://hawaiimesonet.app/station/0281
[lowell-focus]: https://www.hawaii.edu/climate-data-portal/hurricane-lowell-kauai-and-oahu-focus/
[lowell-viewer]: https://www.hawaii.edu/climate-data-portal/hurricane-lowell-viewer/
[lowell]: https://www.hawaii.edu/climate-data-portal/hurricane-lowell/
[nws]: https://www.weather.gov/hfo/
[st-0601]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0601
[mesonet-map]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/station-map
[st-0552]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0552
[as-mesonet]: https://www.hawaii.edu/climate-data-portal/american-samoa-mesonet-live-data-access/
[mesonet-as]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/american-samoa
[as-portal]: https://www.hawaii.edu/climate-data-portal/americansamoaportal/
[as-viewer]: https://hcdp.github.io/ascdp/
[avian-malaria]: https://www.hawaii.edu/climate-data-portal/developing-a-real-time-tool-to-identify-the-likelihood-of-avian-malaria-insitu-development-to-help-the-targeting-of-mosquito-control-efforts/
[tools]: https://www.hawaii.edu/climate-data-portal/climate-tools/
[ccvd]: https://ccvd.manoa.hawaii.edu/
[st-0501]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0501
[streamflow]: https://www.hawaii.edu/climate-data-portal/shifting-magnitude-and-timing-of-streamflow-extremes-and-the-relationship-with-rainfall-across-the-hawaiian-islands/
[et-atlas]: https://www.hawaii.edu/climate-data-portal/evapotranspiration-atlas/
[solar-atlas]: https://www.hawaii.edu/climate-data-portal/solar-radiation-atlas/
[climate-atlas]: https://www.hawaii.edu/climate-data-portal/climate-atlas/
[recharge]: https://recharge.ikewai.org/#/workspace
[st-0119]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0119
[gh-stations]: https://github.com/HCDP/loggernet_station_data
[cloud-water]: https://www.hawaii.edu/climate-data-portal/cloud-water-interception-in-hawaii/
[kaala]: https://www.hawaii.edu/climate-data-portal/ka%ca%bbala-station/
[st-0521]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0521
[research]: https://www.hawaii.edu/climate-data-portal/research-highlights/
[glossary]: https://www.hawaii.edu/climate-data-portal/climate-glossary/
[m-0119]: https://hawaiimesonet.app/station/0119
[lala]: https://www.hawaii.edu/climate-data-portal/hurricane-lala/
[st-0153]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0153
[st-0151]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0151
[drought-maui-water]: https://www.hawaii.edu/climate-data-portal/drought-effects-on-drinking-water-supply-on-maui/
[temp-trends]: https://www.hawaii.edu/climate-data-portal/temperature-trends-in-hawai%ca%bbi-a-century-of-change-1917-2016/
[drought-century]: https://www.hawaii.edu/climate-data-portal/a-century-of-drought-in-hawaii/
[moon]: https://www.hawaii.edu/climate-data-portal/hawaiian-lunar-calendar/
[cultural]: https://www.hawaii.edu/climate-data-portal/news/
[indigenous-drought]: https://www.hawaii.edu/climate-data-portal/climate-perspective/
[st-0621]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0621
[edu]: https://www.hawaii.edu/climate-data-portal/educational-resources/
[factsheets]: https://www.hawaii.edu/climate-data-portal/factsheets/
[tut-map]: https://www.hawaii.edu/climate-data-portal/visualize-data-tutorial/
[tut-station]: https://www.hawaii.edu/climate-data-portal/visualize-data-tutorial-explore-station-data/
[hrip]: http://hrip.manoa.hawaii.edu/
[st-0252]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0252
[st-0421-graph]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/graphing?id=0421
[st-0422]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/dashboard?id=0422
[atlas-map]: https://rainfall.geography.hawaii.edu/interactive-map
[dryland]: https://www.hawaii.edu/climate-data-portal/dryland-agriculture/
[slr]: https://www.pacioos.hawaii.edu/shoreline/slr-hawaii/
[soest-coastal]: https://www.soest.hawaii.edu/crc/slr-viewer/
[downscaling]: https://www.hawaii.edu/climate-data-portal/dynamical-downscaling-of-near-term-2026-2035-climate-variability-and-change-for-the-main-hawaiian-islands/
[recharge-highlight]: https://www.hawaii.edu/climate-data-portal/hawai%ca%bbi-groundwater-recharge-tool/
[annual]: https://www.hawaii.edu/climate-data-portal/annual-report/
[atlas-downloads]: https://rainfall.geography.hawaii.edu/downloads
[news-lala]: https://www.hawaii.edu/news/2026/08/20/hurricane-lala/
[kona1]: https://www.hawaii.edu/climate-data-portal/2026-kona-low-1/
[kona2]: https://www.hawaii.edu/climate-data-portal/2026-kona-low-2/
[news-march]: https://www.hawaii.edu/news/2026/03/31/hawaii-mesonet-flooding-data/
[team]: https://www.hawaii.edu/climate-data-portal/team/
[mesonet-page]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet/
[annual-pdf]: https://www.hawaii.edu/climate-data-portal/wp-content/uploads/2026/02/2025-Climate-Report-Final_HCDP_Library.pdf
[summary]: https://www.hawaii.edu/climate-data-portal/climate-summary/
[api-page]: https://www.hawaii.edu/climate-data-portal/hcdp-hawaii-mesonet-api/
[gh-hcdp]: https://github.com/HCDP
[api-notebook]: https://github.com/HCDP/hcdp_api_notebook
[api-repo]: https://github.com/HCDP/hcdp_api_docs
[mesonet-table]: https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/station-table
[guam]: https://www.hawaii.edu/climate-data-portal/guam-data-viewer/
