# What the navigator handles today

Measured 2026-09-26 on the live model (gpt-5.6-terra) with the current catalog and URL grammar: **94 of 111 cases fully right** (intent and destination), 13 with the right destination among the alternatives, 4 misses; median answer 2.4 s. Re-run with `python backend/eval_usecases.py` after any prompt, catalog or model change.

## Handled (question → where it takes you)

### Everyday visitors (30)

- show me yesterday's rain on Kauai → `/viewer/rainfall/day/2026-09-24/kauai`
- temprature map for august big island → `/viewer/temperature-mean/month/2026-08/hawaii`
- humidity map for Honolulu on July 4 2026 → `/viewer/humidity/day/2026-07-04/oahu`
- side by side rainfall maps, August 2026 vs August 2025 on Maui → `/viewer/rainfall/month/2026-08/maui?compare=2025-08`
- did it rain in lanai city last saturday → `/viewer/rainfall/day/2026-09-19/lanai`
- nolo → `/extreme-events/nolo`
- huricane lowel rain map → `/viewer/rainfall/day/2026-09-07/kauai`
- Hurricane Lala rain map for the big island → `/viewer/rainfall/day/2026-08-15/hawaii`
- the big floods in march → `/extreme-events/kona-lows`
- storms → `/extreme-events`
- which mesonet station is closest to kailua → `/mesonet?viewer=live&view=station-map`
- is there a mesonet app for my phone → `/mesonet?viewer=app`
- I found a weather station on a hiking trail with a QR code → `/mesonet`
- open the data portal → `/data`
- sea level rise map for waikiki → `/tools/sea-level-rise-viewer`
- will it rain tomorrow in kona → `https://www.weather.gov/hfo/`
- total rainfall in Hilo during Hurricane Lala → hand-off to the AI interface
- average daily high in kona in july over the last 10 years → hand-off to the AI interface
- what can you do? (answered in place)
- is this data free (answered in place)
- does HCDP have forecasts? (answered in place)
- rain in waimea last week (asks a clarifying question)
- show me the map (asks a clarifying question)
- now show Maui → `/viewer/rainfall/day/2026-09-07/maui`
- same map for August → `/viewer/rainfall/month/2026-08/oahu`
- zoom out to the whole state → `/viewer/temperature-max/month/2026-08/statewide`
- switch to inches → `/viewer/rainfall/day/2026-08-15/hawaii?units=in`
- go back a week → `/viewer/rainfall/day/2026-09-17/statewide`
- show me the rainfall map → `/viewer/rainfall/day/2026-09-07/kauai`
- is there an app for this → `/mesonet?viewer=app`

### Researchers from other fields (14)

- SPI-3 drought map March 2026 → `/viewer/spi-3/month/2026-03/statewide`
- download rainfall data from Hurricane Lowell → `/extreme-events/lowell`
- download 5 minute mesonet data for one station as csv → `/mesonet`
- mesonet station list with coordinates as a csv → `https://github.com/HCDP/loggernet_station_data`
- rainfall maps from the 1950s → `/data`
- 1991-2020 rainfall normals geotiff → `/data`
- how do I cite the HCDP rainfall maps in my paper → `/about/how-to-cite`
- rainfall data for american samoa → `/tools/american-samoa-data-viewer`
- guam rainfall maps → `/pacific`
- climate resources for palau → `/pacific`
- compute the correlation between rainfall and NDVI on molokai → hand-off to the AI interface
- how often is the data updated (answered in place)
- how far back does the rainfall data go (answered in place)
- is there a monthly humidity map? (answered in place)

### Emergency responders (11)

- fire risk map for maui today → `/viewer/ignition/day/2026-09-24/maui`
- Nolo storm tracker with rainfall totals by station → `/extreme-events/nolo`
- wind gusts during lowell, all kauai stations side by side → `/extreme-events#lowell`
- manoa palolo flash flood in march → `/extreme-events/kona-low-2`
- how windy is it right now across the state → `/mesonet?viewer=live&view=wind-map`
- live stream gauge readings in american samoa → `/pacific`
- flash flood warning oahu → `https://www.weather.gov/hfo/`
- which mesonet station recorded the most rain yesterday? → hand-off to the AI interface
- what was the max wind gust at lihue during lowell → hand-off to the AI interface
- data for the storm (asks a clarifying question)
- what about the day after? → `/viewer/rainfall/day/2026-09-08/kauai`

### Climate scientists (9)

- rainfall map for October 21 2025 on the Big Island → `/viewer/rainfall/day/2025-10-21/hawaii`
- NDVI molokai 2026-09-15 → `/viewer/ndvi/day/2026-09-15/molokai`
- haleakala record 24 hour rain march 2026 → `/extreme-events/kona-low-1`
- dynamical downscaling rcp8.5 end of century rainfall → `/data`
- standard error maps for monthly rainfall → `/data`
- average temperature in Honolulu for August 2026 vs the 1991-2020 normal → hand-off to the AI interface
- trend in annual rainfall on kauai since 1920 → hand-off to the AI interface
- how much wetter than normal was october 2025 on the big island, in percent → hand-off to the AI interface
- go to lanai → `/viewer/ndvi/day/2026-09-15/lanai`

### Journalists (9)

- I'm writing about Hurricane Lowell, where's HCDP's report? → `/extreme-events/lowell`
- the UH story about 2 trillion gallons of rain in march → `https://www.hawaii.edu/news/2026/03/31/hawaii-mesonet-flooding-data/`
- HCDP 2025 annual climate report pdf → `https://www.hawaii.edu/climate-data-portal/wp-content/uploads/2026/02/2025-Climate-Report-Final_HCDP_Library.pdf`
- how many gallons of rain fell on Maui in March 2026 → hand-off to the AI interface
- rank the islands by rainfall in august → hand-off to the AI interface
- compare lala and lowell total rainfall statewide → hand-off to the AI interface
- who runs HCDP (answered in place)
- how many mesonet stations are there (answered in place)
- total for the whole state in august? → hand-off to the AI interface

### Water utilities and planners (7)

- 12 month SPI for august → `/viewer/spi-12/month/2026-08/statewide`
- groundwater recharge tool → `/tools/groundwater-recharge`
- evapotransperation grids for irrigation planning → `https://www.hawaii.edu/climate-data-portal/evapotranspiration-atlas/`
- subscribe to monthly climate report emails for maui → `/climate-summary`
- what percent of the state is in drought right now → hand-off to the AI interface
- which ahupuaa got the most rain in july → hand-off to the AI interface
- show the 12 month one instead → `/viewer/spi-12/month/2026-08/statewide`

### Farmers and ranchers (6)

- is upcountry maui in drought right now → `/viewer/spi-3/month/2026-08/statewide`
- drought and rain conditions for ranches on the big island → `/tools/h-rip`
- climate portfolio for my farm in kula → `/tools/ccvd-portfolios`
- chart monthly rainfall at Kula since 1990 → hand-off to the AI interface
- how many dry days has north kihei had this year → hand-off to the AI interface
- what does SPI mean on the drought map (answered in place)

### Developers (4)

- how do i get an api key → `/data/api`
- python example for pulling HCDP rasters → `https://github.com/HCDP/hcdp_api_notebook`
- mesonet api docs for 5-minute data → `/data/api`
- bulk download every daily rainfall grid for 2025 → `https://www.hawaii.edu/climate-data-portal/data-portal/`

### Teachers and students (4)

- how do I use the data portal to make a map for class → `/data/tutorials`
- monthly climate summary for oahu → `/climate-summary?year=2026&month=8`
- what's the difference between the rainfall atlas and the data portal (answered in place)
- show max temps instead → `/viewer/temperature-max/month/2026-08/oahu`

## Right destination offered as an alternative (not as the first action)

- how wet was it across the islands in august — went to `/climate-summary?year=2026&month=8`; expected ['climate-summary', 'rainfall-monthly-map']
- where was it hottest last month? — went to `analysis`; expected ['temperature-max-map']
- how cold did it get at night upcountry maui in july — went to `analysis`; expected ['temperature-min-map']
- rainfal kaunakakai this month — went to `analysis`; expected ['rainfall-daily-map', 'rainfall-monthly-map']
- what did HCDP publish about hurricane lala — went to `info`; expected ['lala', 'uh-news-lala']
- Hurricane Lane 2018 rainfall — went to `/extreme-events`; expected ['hurricane-lane-2018', 'rainfall-daily-map']
- is it raining in hilo rn — went to `/mesonet?viewer=live&station=0201&view=dashboard`; expected ['hawaii-mesonet-app', 'mesonet-data-map', 'mesonet-live-data']
- what is the hawaii mesonet? my students want to know — went to `info`; expected ['mesonet']
- how sunny is kona compared to hilo, is there a solar map — went to `analysis`; expected ['solar-radiation-atlas']
- average annual rainfall at my house in manoa — went to `analysis`; expected ['climatology-normals', 'rainfall-atlas', 'rainfall-atlas-interactive-map']
- hawaiian words for rain for my 4th grade class — went to `info`; expected ['climate-glossary']
- moon calendar — went to `/pacific`; expected ['hawaiian-moon-calendar']
- videos explaining the climate data portal — went to `/tools`; expected ['presentations']

## Misses

- direct url for the august 2026 monthly rainfall tif — got info `https://ikeauth.its.hawaii.edu/files/v2/download/public/system/ikewai-annotated-data/HCDP/production/rainfall/new/month/statewide/data_map/2026/rainfall_new_month_statewide_data_map_2026_08.tif`; expected navigate ['hcdp-public-files']
- I need temperature — got navigate `/data`; expected clarify ['access-data', 'station-data', 'temperature-mean-map']
- climate data for samoa — got navigate `/pacific`; expected clarify ['american-samoa-portal', 'pacific-countries']
- monthly instead — got navigate `/data`; expected info ['access-data', 'humidity-daily-map']
