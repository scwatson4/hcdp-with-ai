"""The navigator: turns "what are you looking for?" into a place to go.

It reasons over the site catalog (backend/data/catalog.json) with the model,
then validates everything the model proposes: internal paths must be routes
this site has or valid viewer deep links, external URLs must belong to HCDP's
own hosts (or appear in the catalog), and the analysis hand-off URL is built
here, never taken from the model. If the model is unreachable it falls back to
a keyword search over the catalog so the visitor still gets somewhere.
"""
from __future__ import annotations

import datetime as dt
import json
import re
from zoneinfo import ZoneInfo
from pathlib import Path
from urllib.parse import quote, urlparse

DATA_DIR = Path(__file__).resolve().parent / "data"
CATALOG_PATH = DATA_DIR / "catalog.json"

# Mirrors frontend/src/viewer/urlGrammar.js (keep the two in step).
DATASETS = {
    "rainfall": {"label": "Rainfall", "periods": ["month", "day"], "api": {"datatype": "rainfall", "production": "new"}},
    "temperature-mean": {"label": "Mean temperature", "periods": ["month", "day"], "api": {"datatype": "temperature", "aggregation": "mean"}},
    "temperature-max": {"label": "Maximum temperature", "periods": ["month", "day"], "api": {"datatype": "temperature", "aggregation": "max"}},
    "temperature-min": {"label": "Minimum temperature", "periods": ["month", "day"], "api": {"datatype": "temperature", "aggregation": "min"}},
    "humidity": {"label": "Relative humidity", "periods": ["day"], "api": {"datatype": "relative_humidity"}},
    "ndvi": {"label": "Vegetation (NDVI)", "periods": ["day"], "api": {"datatype": "ndvi_modis"}},
    "ignition": {"label": "Ignition probability", "periods": ["day"], "api": {"datatype": "ignition_probability"}},
    "spi-1": {"label": "Drought index SPI 1-month", "periods": ["month"], "api": {"datatype": "spi", "timescale": "timescale001"}},
    "spi-3": {"label": "Drought index SPI 3-month", "periods": ["month"], "api": {"datatype": "spi", "timescale": "timescale003"}},
    "spi-6": {"label": "Drought index SPI 6-month", "periods": ["month"], "api": {"datatype": "spi", "timescale": "timescale006"}},
    "spi-9": {"label": "Drought index SPI 9-month", "periods": ["month"], "api": {"datatype": "spi", "timescale": "timescale009"}},
    "spi-12": {"label": "Drought index SPI 12-month", "periods": ["month"], "api": {"datatype": "spi", "timescale": "timescale012"}},
    "spi-24": {"label": "Drought index SPI 24-month", "periods": ["month"], "api": {"datatype": "spi", "timescale": "timescale024"}},
    "spi-36": {"label": "Drought index SPI 36-month", "periods": ["month"], "api": {"datatype": "spi", "timescale": "timescale036"}},
    "spi-48": {"label": "Drought index SPI 48-month", "periods": ["month"], "api": {"datatype": "spi", "timescale": "timescale048"}},
    "spi-60": {"label": "Drought index SPI 60-month", "periods": ["month"], "api": {"datatype": "spi", "timescale": "timescale060"}},
    "rainfall-legacy": {"label": "Rainfall (legacy, 1920–2012)", "periods": ["month"], "api": {"datatype": "rainfall", "production": "legacy"}},
    "ignition-lead-1": {"label": "Ignition probability, 1 day ahead", "periods": ["day"], "api": {"datatype": "ignition_probability", "lead": "lead01"}},
    "ignition-lead-2": {"label": "Ignition probability, 2 days ahead", "periods": ["day"], "api": {"datatype": "ignition_probability", "lead": "lead02"}},
    "ignition-lead-3": {"label": "Ignition probability, 3 days ahead", "periods": ["day"], "api": {"datatype": "ignition_probability", "lead": "lead03"}},
}
# Station values exist for these (markers and time series); the rest are grids only.
STATION_DATASETS = {"rainfall", "temperature-mean", "temperature-max", "temperature-min", "humidity"}
# Spellings people type (and links already published) → the canonical slug. Mirrors urlGrammar.js.
DATASET_ALIASES = {
    "rain": "rainfall", "precipitation": "rainfall", "precip": "rainfall", "legacy-rainfall": "rainfall-legacy", "rainfall-1920": "rainfall-legacy",
    "temperature": "temperature-mean", "temp": "temperature-mean", "temp-mean": "temperature-mean", "tmean": "temperature-mean",
    "temp-max": "temperature-max", "tmax": "temperature-max", "temperature-maximum": "temperature-max",
    "temp-min": "temperature-min", "tmin": "temperature-min", "temperature-minimum": "temperature-min",
    "rh": "humidity", "relative-humidity": "humidity", "vegetation": "ndvi", "fire": "ignition", "ignition-probability": "ignition", "fire-risk": "ignition",
    "ignition-1": "ignition-lead-1", "ignition-2": "ignition-lead-2", "ignition-3": "ignition-lead-3", "ignition+1": "ignition-lead-1", "ignition+2": "ignition-lead-2", "ignition+3": "ignition-lead-3",
    "spi": "spi-3", "drought": "spi-3",
    **{f"spi{n}": f"spi-{n}" for n in (1, 3, 6, 9, 12, 24, 36, 48, 60)},
    **{f"spi-{n:02d}": f"spi-{n}" for n in (1, 3, 6, 9)},
    **{f"spi-{n:03d}": f"spi-{n}" for n in (1, 3, 6, 9, 12, 24, 36, 48, 60)},
}
PERIOD_ALIASES = {"monthly": "month", "months": "month", "m": "month", "daily": "day", "days": "day", "d": "day"}
EXTENT_ALIASES = {"state": "statewide", "all": "statewide", "hawaii-island": "hawaii", "bigisland": "hawaii", "big-island": "hawaii", "bi": "hawaii", "hawaiʻi": "hawaii",
                  "hawaiʻi-island": "hawaii", "oa": "oahu", "oʻahu": "oahu", "ka": "kauai", "kauaʻi": "kauai", "mn": "maui", "maui-county": "maui", "molokaʻi": "molokai", "lānaʻi": "lanai", "lanaʻi": "lanai"}
EXTENTS = {"statewide": "statewide", "hawaii": "bi", "maui": "mn", "molokai": "mn", "lanai": "mn", "oahu": "oa", "kauai": "ka"}
# HCDP publishes SPI grids statewide only; an island link shows the statewide grid zoomed to the island.
STATEWIDE_ONLY = {k for k in DATASETS if k.startswith("spi-")} | {"rainfall-legacy"}
HST = "Pacific/Honolulu"

ROUTES = [
    "/", "/about", "/about/team", "/about/history", "/about/acknowledgements", "/about/how-to-cite",
    "/data", "/data/api", "/data/tutorials", "/mesonet", "/climate-summary", "/pacific", "/extreme-events", "/tools",
]
# Deep-link routes beyond ROUTES: per-storm and per-tool pages — only the slugs that exist.
STORM_SLUGS = ("lowell", "lala", "nolo", "kona-low-1", "kona-low-2", "kona-lows")
TOOL_SLUGS = ("rainfall-atlas", "ccvd-portfolios", "h-rip", "groundwater-recharge", "monthly-climate-summary", "sea-level-rise-viewer",
              "american-samoa-data-viewer", "soest-coastal-viewer", "climate-of-hawaii", "avian-malaria")
ROUTE_PATTERNS = [re.compile(r"^/extreme-events/(" + "|".join(STORM_SLUGS) + r")$"), re.compile(r"^/tools/(" + "|".join(TOOL_SLUGS) + r")$")]
# Query keys each page understands (everything else is dropped as invalid).
PAGE_QUERY_KEYS = {"/": {"ask"}, "/mesonet": {"viewer", "station", "view"}, "/climate-summary": {"year", "month"}}
STATIONS_PATH = DATA_DIR / "mesonet_stations.json"
INTENTS = {"navigate", "analysis", "info", "clarify"}
# The query layer, in the one order urlGrammar.formatViewerPath writes it ("stations" is the first grammar's spelling of layers=stations).
VIEWER_QUERY_KEYS = ["ramp", "scale", "units", "basemap", "opacity", "layers", "station", "pin", "ts", "tsp", "compare", "lat", "lng", "z"]
VIEWER_LEGACY_KEYS = {"stations"}
BASEMAP_KEYS = ["satellite", "street", "imagery", "topo", "relief", "light"]
DEFAULT_BASEMAP, DEFAULT_OPACITY = "satellite", 75
LAYER_KEYS = ["stations", "outline"]
UNIT_KEYS = {"mm", "in", "c", "f"}
HAWAII_BOX = (18.5, 22.5, -160.5, -154.5)   # south, north, west, east
_SKN_RE = re.compile(r"^\d{1,5}(\.\d{1,3})?$")
_RANGE_RE = re.compile(r"^(\d{4}-\d{2}(?:-\d{2})?)\.\.(\d{4}-\d{2}(?:-\d{2})?)$")
STATIC_HOSTS = {
    "www.hawaii.edu", "hawaii.edu", "manoa.hawaii.edu", "hawaiimesonet.app", "rainfall.geography.hawaii.edu",
    "evapotranspiration.geography.hawaii.edu", "solar.geography.hawaii.edu", "climate.geography.hawaii.edu",
    "api.hcdp.ikewai.org", "ikeauth.its.hawaii.edu", "cherryleh.github.io", "hcdp.github.io", "github.com",
    "www.soest.hawaii.edu", "ikewai.org", "www.ikewai.org", "atlas.uhgeography.org",
}
_VIEWER_RE = re.compile(r"^/viewer/(?P<dataset>[a-z0-9+-]+)/(?P<period>[a-z]+)/(?P<date>\d{4}-\d{2}(?:-\d{2})?)/(?P<extent>[a-zʻā-]+)$")

# Enough knowledge to be useful before the full catalog lands.
SEED_CATALOG = [
    {"id": "access-data", "kind": "tool", "title": "Access Data (interactive data portal)", "url": "https://www.hawaii.edu/climate-data-portal/data-portal/", "internal_path": "/data",
     "summary": "Interactive maps and downloads of gridded rainfall, temperature, SPI drought index, relative humidity, NDVI and ignition probability, plus station data, from 1920 to yesterday.",
     "when_to_use": "The visitor wants to see or download climate maps or station data for Hawaiʻi.", "example_queries": ["download rainfall data", "show me a temperature map"], "region": "hawaii", "tags": ["rainfall", "temperature", "download", "maps"]},
    {"id": "viewer", "kind": "viewer", "title": "Climate viewer deep links", "url": None, "internal_path": "/viewer/{dataset}/{period}/{date}/{extent}",
     "summary": "This site's shareable map viewer: one URL per dataset, period, date and island.", "when_to_use": "The visitor wants to look at a specific map for a specific date or month.", "example_queries": ["rainfall map for October 21 2025 on the Big Island", "drought map August 2026"], "region": "hawaii", "tags": ["map", "viewer"]},
    {"id": "mesonet", "kind": "tool", "title": "Hawaiʻi Mesonet", "url": "https://www.hawaii.edu/climate-data-portal/hawaii-mesonet/", "internal_path": "/mesonet",
     "summary": "Live weather station network: readings every five minutes from 80+ stations. Viewer, station list, API.", "when_to_use": "Current conditions, a specific station, live rainfall or wind.", "example_queries": ["is it raining in Hilo right now", "stations on Kauaʻi"], "region": "hawaii", "tags": ["stations", "live", "mesonet"]},
    {"id": "climate-summary", "kind": "page", "title": "Monthly Climate Summary", "url": "https://www.hawaii.edu/climate-data-portal/climate-summary/", "internal_path": "/climate-summary",
     "summary": "The monthly Hawaiʻi climate report: rainfall and temperature by island with ranks against the record.", "when_to_use": "How wet or warm last month was, statewide or by island.", "example_queries": ["how wet was August", "monthly climate report"], "region": "hawaii", "tags": ["report", "monthly"]},
    {"id": "pacific-portal", "kind": "page", "title": "Pacific Portal", "url": "https://www.hawaii.edu/climate-data-portal/pacific-portal/", "internal_path": "/pacific",
     "summary": "Climate data portals for American Samoa and Guam.", "when_to_use": "Anything about American Samoa or Guam.", "example_queries": ["American Samoa rainfall"], "region": "pacific", "tags": ["american samoa", "guam"]},
    {"id": "extreme-events", "kind": "page", "title": "Extreme Events", "url": "https://www.hawaii.edu/climate-data-portal/extreme-events/", "internal_path": "/extreme-events",
     "summary": "Storm trackers and reports for recent extreme events.", "when_to_use": "A named storm or extreme event.", "example_queries": ["hurricane reports"], "region": "hawaii", "tags": ["storm", "hurricane"]},
    {"id": "nolo", "kind": "event", "title": "Tropical Storm Nolo tracker", "url": "https://cherryleh.github.io/climate-summary/nolo/", "internal_path": "/extreme-events#nolo",
     "summary": "Live Mesonet tracker for Tropical Storm Nolo (from 22 September 2026).", "when_to_use": "Nolo rainfall, wind, station observations.", "example_queries": ["Nolo tracker"], "region": "hawaii", "dates": {"start": "2026-09-22", "end": None}, "tags": ["storm", "nolo", "live"]},
    {"id": "lowell", "kind": "event", "title": "Hurricane Lowell report", "url": "https://www.hawaii.edu/climate-data-portal/hurricane-lowell/", "internal_path": "/extreme-events#lowell",
     "summary": "Rainfall totals, station observations and downloads for Hurricane Lowell, 6 to 8 September 2026.", "when_to_use": "Anything about Hurricane Lowell.", "example_queries": ["download rainfall data from Hurricane Lowell"], "region": "hawaii", "dates": {"start": "2026-09-06", "end": "2026-09-08"}, "tags": ["storm", "lowell", "rainfall"]},
    {"id": "lala", "kind": "event", "title": "Hurricane Lala report", "url": "https://www.hawaii.edu/climate-data-portal/hurricane-lala/", "internal_path": "/extreme-events#lala",
     "summary": "Report for Hurricane Lala, 14 to 16 August 2026.", "when_to_use": "Anything about Hurricane Lala.", "example_queries": ["Lala rainfall"], "region": "hawaii", "dates": {"start": "2026-08-14", "end": "2026-08-16"}, "tags": ["storm", "lala"]},
    {"id": "kona-lows", "kind": "event", "title": "Kona Low storm viewers (March 2026)", "url": "https://www.hawaii.edu/climate-data-portal/extreme-events/", "internal_path": "/extreme-events#kona-lows",
     "summary": "Two Kona Low events, 10 to 16 and 17 to 23 March 2026.", "when_to_use": "The March 2026 Kona lows.", "example_queries": ["kona low March"], "region": "hawaii", "dates": {"start": "2026-03-10", "end": "2026-03-23"}, "tags": ["storm", "kona low"]},
    {"id": "climate-tools", "kind": "page", "title": "Climate Tools", "url": "https://www.hawaii.edu/climate-data-portal/climate-tools/", "internal_path": "/tools",
     "summary": "Rainfall Atlas, climate portfolios, rangeland drought, groundwater recharge, sea-level rise and other tools.", "when_to_use": "A specialised tool rather than raw data.", "example_queries": ["what tools do you have"], "region": "hawaii", "tags": ["tools"]},
    {"id": "api", "kind": "api", "title": "HCDP / Hawaiʻi Mesonet API", "url": "https://www.hawaii.edu/climate-data-portal/hcdp-hawaii-mesonet-api/", "internal_path": "/data/api",
     "summary": "Programmatic access to grids, station data and Mesonet readings; token request and examples.", "when_to_use": "The visitor writes code or wants bulk access.", "example_queries": ["API access", "python download"], "region": "hawaii", "tags": ["api", "developers"]},
    {"id": "how-to-cite", "kind": "page", "title": "How to Cite", "url": "https://www.hawaii.edu/climate-data-portal/how-to-cite-3/", "internal_path": "/about/how-to-cite",
     "summary": "Citations for every HCDP data product.", "when_to_use": "Citing data in a paper or report.", "example_queries": ["how do I cite the rainfall maps"], "region": None, "tags": ["cite"]},
    {"id": "rainfall-atlas", "kind": "atlas", "title": "Rainfall Atlas of Hawaiʻi", "url": "https://rainfall.geography.hawaii.edu/", "internal_path": None,
     "summary": "Mean annual and monthly rainfall maps (1978–2007 climatology) with station data.", "when_to_use": "Long-term average rainfall at a place.", "example_queries": ["average rainfall in Hilo"], "region": "hawaii", "tags": ["atlas", "climatology"]},
]


def load_catalog(path: Path | None = None) -> list[dict]:
    p = path or CATALOG_PATH
    if p.exists():
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and "entries" in data:
            data = data["entries"]
        if isinstance(data, list) and data:
            return data
    return SEED_CATALOG


def _real_date(text: str) -> bool:
    try:
        dt.date.fromisoformat(text if len(text) == 10 else text + "-01")
        return len(text) in (7, 10)
    except ValueError:
        return False


def _in_box(lat: float, lng: float) -> bool:
    s, n, w, e = HAWAII_BOX
    return s <= lat <= n and w <= lng <= e


def parse_viewer_options(query: str, period: str) -> dict | None:
    """The query layer as the viewer reads it (urlGrammar.parseViewerOptions): unknown keys or bad values → None.
    Values come back typed; formatting them again (format_viewer_options) gives the canonical spelling."""
    from urllib.parse import parse_qsl, unquote
    opts: dict = {}
    pairs = parse_qsl(query, keep_blank_values=True)
    for k, _ in pairs:
        if k not in VIEWER_QUERY_KEYS and k not in VIEWER_LEGACY_KEYS:
            return None
    q = {k: unquote(v) for k, v in pairs}
    if q.get("ramp"):
        opts["ramp"] = q["ramp"]
    if q.get("scale"):
        if q["scale"] != "extreme":
            return None
        opts["scale"] = "extreme"
    if q.get("units"):
        if q["units"].lower() not in UNIT_KEYS:
            return None
        opts["units"] = q["units"].lower()
    if q.get("basemap"):
        if q["basemap"].lower() not in BASEMAP_KEYS:
            return None
        opts["basemap"] = q["basemap"].lower()
    if q.get("opacity") is not None:
        if not q["opacity"].isdigit() or int(q["opacity"]) > 100:
            return None
        opts["opacity"] = int(q["opacity"])
    layers = {l for l in q.get("layers", "").lower().split(",") if l}
    if layers - set(LAYER_KEYS):
        return None
    if q.get("stations") == "1":
        layers.add("stations")
    if layers:
        opts["layers"] = [l for l in LAYER_KEYS if l in layers]
    if q.get("station"):
        if not _SKN_RE.match(q["station"]):
            return None
        opts["station"] = q["station"]
    elif q.get("pin"):
        try:
            lat, lng = (float(x) for x in q["pin"].split(","))
        except ValueError:
            return None
        if not _in_box(lat, lng):
            return None
        opts["pin"] = (round(lat, 4), round(lng, 4))
    if q.get("ts"):
        m = _RANGE_RE.match(q["ts"])
        if not m or len(m.group(1)) != len(m.group(2)) or not (_real_date(m.group(1)) and _real_date(m.group(2))):
            return None
        a, b = sorted((m.group(1), m.group(2)))
        if "station" in opts or "pin" in opts:
            opts["ts"] = (a, b)
    if q.get("tsp"):
        if q["tsp"].lower() not in ("day", "month"):
            return None
        if ("station" in opts or "pin" in opts) and q["tsp"].lower() != period:
            opts["tsp"] = q["tsp"].lower()
    if q.get("compare"):
        if not _real_date(q["compare"]):
            return None
        opts["compare"] = q["compare"]
    if q.get("lat") or q.get("lng"):
        try:
            lat, lng = float(q.get("lat", "")), float(q.get("lng", ""))
        except ValueError:
            return None
        if not _in_box(lat, lng):
            return None
        z = None
        if q.get("z"):
            try:
                z = max(5, min(20, round(float(q["z"]))))
            except ValueError:
                return None
        opts["view"] = (lat, lng, z)
    return opts


def format_viewer_options(opts: dict, period: str) -> str:
    """Python twin of urlGrammar.formatViewerPath's query part: one order, defaults omitted, readable commas."""
    parts = []
    if opts.get("ramp"):
        parts.append(f"ramp={opts['ramp']}")
    if opts.get("scale"):
        parts.append("scale=extreme")
    if opts.get("units") and opts["units"] not in ("mm", "c"):
        parts.append(f"units={opts['units']}")
    if opts.get("basemap") and opts["basemap"] != DEFAULT_BASEMAP:
        parts.append(f"basemap={opts['basemap']}")
    if opts.get("opacity") is not None and int(opts["opacity"]) != DEFAULT_OPACITY:
        parts.append(f"opacity={int(opts['opacity'])}")
    if opts.get("layers"):
        parts.append("layers=" + ",".join(l for l in LAYER_KEYS if l in opts["layers"]))
    if opts.get("station"):
        parts.append(f"station={opts['station']}")
    elif opts.get("pin"):
        parts.append(f"pin={opts['pin'][0]:.4f},{opts['pin'][1]:.4f}")
    if opts.get("station") or opts.get("pin"):
        if opts.get("ts"):
            parts.append(f"ts={opts['ts'][0]}..{opts['ts'][1]}")
        if opts.get("tsp") and opts["tsp"] != period:
            parts.append(f"tsp={opts['tsp']}")
    if opts.get("compare"):
        parts.append(f"compare={opts['compare']}")
    if opts.get("view"):
        lat, lng, z = opts["view"]
        parts.append(f"lat={lat:.4f}")
        parts.append(f"lng={lng:.4f}")
        if z is not None:
            parts.append(f"z={z}")
    return "&".join(parts)


def parse_viewer_path(path: str) -> dict | None:
    """A viewer address the grammar accepts (aliases resolved, options typed), else None.
    The result carries dataset/period/date/extent as canonical slugs plus `opts` and `canonical`."""
    base, _, query = path.partition("?")
    m = _VIEWER_RE.match(base)
    if not m:
        return None
    d = m.groupdict()
    dataset = d["dataset"] if d["dataset"] in DATASETS else DATASET_ALIASES.get(d["dataset"])
    period = d["period"] if d["period"] in ("month", "day") else PERIOD_ALIASES.get(d["period"])
    extent = d["extent"] if d["extent"] in EXTENTS else EXTENT_ALIASES.get(d["extent"])
    ds = DATASETS.get(dataset or "")
    if not ds or not period or period not in ds["periods"] or not extent:
        return None
    if (period == "day") != (len(d["date"]) == 10) or not _real_date(d["date"]):
        return None
    opts = parse_viewer_options(query, period)
    if opts is None:
        return None
    out = {"dataset": dataset, "period": period, "date": d["date"], "extent": extent, "opts": opts}
    q = format_viewer_options(opts, period)
    out["canonical"] = f"/viewer/{dataset}/{period}/{d['date']}/{extent}" + (f"?{q}" if q else "")
    return out


def canonical_viewer_path(path: str) -> str | None:
    """The one spelling of a viewer address, or None when it is not one the viewer can show."""
    v = parse_viewer_path(path)
    return v["canonical"] if v else None


def describe_view(v: dict) -> str:
    """Python twin of urlGrammar.describeViewer: 'Rainfall, September 7, 2026, Kauaʻi'."""
    labels = {"statewide": "Statewide", "hawaii": "Hawaiʻi Island", "maui": "Maui", "molokai": "Molokaʻi", "lanai": "Lānaʻi", "oahu": "Oʻahu", "kauai": "Kauaʻi"}
    d = v["date"]
    when = dt.date.fromisoformat(d).strftime("%B %-d, %Y") if len(d) == 10 else dt.date.fromisoformat(d + "-01").strftime("%B %Y")
    return f"{DATASETS[v['dataset']]['label']}, {when}, {labels[v['extent']]}"


def valid_internal_path(path: str) -> bool:
    if not isinstance(path, str) or not path.startswith("/"):
        return False
    no_hash = path.split("#", 1)[0]
    base, _, query = no_hash.partition("?")
    if parse_viewer_path(no_hash) is not None:
        return True
    if base not in ROUTES and not any(p.match(base) for p in ROUTE_PATTERNS):
        return False
    if query:
        allowed = PAGE_QUERY_KEYS.get(base, set())
        return all(part.split("=", 1)[0] in allowed for part in query.split("&") if part)
    return True


def load_stations(path: Path | None = None) -> list[dict]:
    p = path or STATIONS_PATH
    if p.exists():
        with open(p, encoding="utf-8") as f:
            return json.load(f).get("stations", [])
    return []


def load_places_nearest() -> list[str]:
    p = DATA_DIR / "places_nearest.json"
    if p.exists():
        with open(p, encoding="utf-8") as f:
            return json.load(f).get("nearest", [])
    return []


def stations_text(stations: list[dict]) -> str:
    """Compact: one line per island, 'id name' pairs, active stations only."""
    by = {}
    for st in stations:
        if st.get("status", "active") != "active":
            continue
        by.setdefault(st.get("island", "?"), []).append(f"{st['id']} {st['name']}")
    return "\n".join(f"  {isl}: " + "; ".join(v) for isl, v in sorted(by.items()))


class Navigator:
    def __init__(self, llm, catalog: list[dict] | None = None, ai_interface_url: str = "", today: dt.date | None = None, stations: list[dict] | None = None):
        self.llm = llm
        self.catalog = catalog or load_catalog()
        self.stations = stations if stations is not None else load_stations()
        self.places_nearest = load_places_nearest()
        self.ai_interface_url = (ai_interface_url or "").rstrip("/")
        self._today = today
        self.hosts = set(STATIC_HOSTS)
        for e in self.catalog:
            for u in (e.get("url"), *(e.get("links") or [])):
                host = urlparse(u).hostname if isinstance(u, str) else None
                if host:
                    self.hosts.add(host)

    # ----- prompt -----------------------------------------------------------
    def today(self) -> dt.date:
        # Hawaiʻi's date, whatever the server's clock zone: "yesterday's map" must mean yesterday in Hawaiʻi.
        return self._today or dt.datetime.now(ZoneInfo(HST)).date()

    def catalog_text(self) -> str:
        lines = []
        for e in self.catalog:
            where = " | ".join(x for x in [f"url: {e['url']}" if e.get("url") else "", f"path: {e['internal_path']}" if e.get("internal_path") else ""] if x)
            dates = e.get("dates") or {}
            when = f" Dates: {dates.get('start')}→{dates.get('end') or 'ongoing'}." if dates.get("start") else ""
            ex = "; ".join((e.get("example_queries") or [])[:3])
            lines.append(f"- [{e['id']}] ({e.get('kind', 'page')}) {e['title']} — {e.get('summary', '')} Use when: {e.get('when_to_use', '')}{when} {where}. Tags: {', '.join(e.get('tags') or [])}. Example asks: {ex}")
        return "\n".join(lines)

    def system_prompt(self, context: dict | None = None) -> str:
        today = self.today()
        yesterday = today - dt.timedelta(days=1)
        last_month = (today.replace(day=1) - dt.timedelta(days=1)).strftime("%Y-%m")
        ctx = context or {}
        where = ctx.get("path") or "/"
        viewer = ctx.get("viewer")
        viewing = f" They are looking at the viewer: {json.dumps(viewer)}." if viewer else ""
        datasets = ", ".join(f"{k} ({', '.join(v['periods'])})" for k, v in DATASETS.items())
        return f"""You are the navigator of the Hawaiʻi Climate Data Portal (HCDP) website. A visitor tells you what they are looking for; you take them there. You do not analyse data yourself.
Today is {today.isoformat()}. Daily maps exist through {yesterday.isoformat()}; monthly maps through {last_month}.
The visitor is on page {where}.{viewing}

WHAT YOU CAN DO
1. navigate — open one of this site's pages (paths below) or a viewer deep link.
2. open — open a real HCDP page or tool, or a catalogued external site (for example the National Weather Service for forecasts and warnings), in a new tab (only URLs from the catalog).
3. handoff — when the request is data ANALYSIS (numbers, totals, averages, rankings, comparisons, trends, charts, "how much", "which station recorded the most", "why"), send them to the HCDP AI interface, which can compute. Do not attempt the analysis; say in one sentence that the analysis assistant will do it. But "was it raining / how hot was it at PLACE on DAY or MONTH" with no number asked is a MAP question: navigate to that day's or month's map for the island.
4. info — answer a factual question about HCDP from the catalog, briefly, without navigating.
5. clarify — ask ONE short question, only when you truly cannot choose (prefer acting with a sensible default and offering alternatives).

SITE PAGES (internal paths): {", ".join(ROUTES)}
VIEWER DEEP LINKS: /viewer/{{dataset}}/{{period}}/{{date}}/{{extent}}
  dataset: {datasets}
  period: month (date YYYY-MM) or day (date YYYY-MM-DD)
  extent: statewide, hawaii (Hawaiʻi Island / Big Island), maui, molokai, lanai, oahu, kauai
  Examples: /viewer/rainfall/day/2026-09-07/kauai   /viewer/spi-3/month/2026-08/statewide   /viewer/temperature-max/month/2026-08/oahu
  A storm's rainfall is best shown as daily rainfall on its peak day for the island hit hardest; a drought question as spi-3 for the last complete month (SPI links may name an island: the statewide grid is shown zoomed to it).
MORE SHAREABLE LINKS (every state on this site has a URL; use ONLY these forms — an invented path is dropped):
  /extreme-events/{{{"|".join(STORM_SLUGS)}}}   one storm's section
  /tools/{{{"|".join(TOOL_SLUGS)}}}   one tool's tile — only these ten slugs; any other catalog entry is reached with an open action on its url
  /mesonet?viewer=live|app|nolo&station={{id}}&view=dashboard|graphing|station-map|station-table|wind-map   the live Mesonet viewer on one station (use viewer=live with a station id; view=graphing for charts; app = the phone app)
  /climate-summary?year=YYYY&month=M   the monthly summary for one month
  /?ask={{url-encoded question}}   a link that asks this assistant a question on arrival (for sharing a question)
MESONET STATIONS (id name), by island — use the id in station links; say the name in the reply:
{stations_text(self.stations)}
NEAREST STATION TO WELL-KNOWN PLACES (use these for "in <town>" asks; do not pick by name similarity):
  {"; ".join(self.places_nearest)}

CATALOG (the only URLs you may use):
{self.catalog_text()}

RULES
- Reply in one or two plain sentences, no markdown, no lists in the reply. Describe exactly the actions you return and nothing more: for a navigate action say "Taking you to …" (a page on this site); for an open action say "Opening … in a new tab"; never say you opened something you did not put in actions.
- At most one navigate action, plus optional open actions. Never invent URLs or paths.
- Always offer 2–4 alternatives (title, url or internal path, one-clause why) so the visitor can choose.
- Prefer this site's own pages/viewer for maps; prefer the real HCDP page (open) for reports, downloads and tools this site does not replicate.
- If the visitor asks what you can do, answer with intent info and list the main tools as alternatives.
- If a request is about a storm in the catalog, the storm's report/tracker is the primary answer; a viewer deep link for its dates is an alternative (or the primary if they ask for a map).
- Set minimize=true whenever you navigate or open.

Respond with ONLY a JSON object:
{{"intent": "navigate|analysis|info|clarify", "reply": "…", "actions": [{{"type": "navigate", "path": "/…"}} | {{"type": "open", "url": "https://…"}} | {{"type": "handoff"}}], "alternatives": [{{"title": "…", "url": "https://… or /path", "why": "…"}}], "minimize": true|false}}"""

    # ----- response ---------------------------------------------------------
    def respond(self, message: str, history: list[dict] | None = None, context: dict | None = None) -> dict:
        message = (message or "").strip()[:500]
        valid = [{"role": h["role"], "content": h["content"][:1000]} for h in (history or [])
                 if isinstance(h, dict) and h.get("role") in ("user", "assistant") and isinstance(h.get("content"), str)]
        msgs = valid[-8:] + [{"role": "user", "content": message}]
        try:
            raw = self.llm.complete_json(self.system_prompt(context), msgs)
        except Exception as e:  # noqa: BLE001 - any model failure falls back to search
            out = self.fallback(message)
            out["error"] = type(e).__name__
            return out
        return self.normalize(raw, message, context)

    def handoff_url(self, message: str, context: dict | None = None) -> str:
        """The analysis assistant gets the question plus what the visitor was looking at."""
        base = self.ai_interface_url or "https://hcdp-ai-interface.cis251375.projects.jetstream-cloud.org"
        ask = message
        viewer = (context or {}).get("viewer") or {}
        if viewer.get("dataset") and viewer.get("date"):
            label = DATASETS.get(viewer["dataset"], {}).get("label", viewer["dataset"])
            ask = f"{message} (I was looking at the {label} map for {viewer['date']}, {viewer.get('extent', 'statewide')})"
        return f"{base}/?ask={quote(ask)}"

    def allowed_url(self, url) -> bool:
        if not isinstance(url, str):
            return False
        u = urlparse(url)
        return u.scheme in ("http", "https") and (u.hostname or "") in self.hosts

    def normalize(self, raw: dict, message: str, context: dict | None = None) -> dict:
        intent = raw.get("intent") if raw.get("intent") in INTENTS else "info"
        reply = str(raw.get("reply") or "").strip()[:600]
        actions, navigated = [], False
        for a in raw.get("actions") or []:
            if not isinstance(a, dict):
                continue
            t = a.get("type")
            if t == "navigate" and not navigated and valid_internal_path(a.get("path", "")):
                actions.append({"type": "navigate", "path": a["path"]})
                navigated = True
            elif t == "open" and self.allowed_url(a.get("url")):
                actions.append({"type": "open", "url": a["url"]})
            elif t == "handoff":
                actions.append({"type": "handoff", "url": self.handoff_url(message, context)})
        if intent == "analysis" and not any(a["type"] == "handoff" for a in actions):
            actions.append({"type": "handoff", "url": self.handoff_url(message, context)})
        if intent == "analysis" and not reply:
            reply = "That is a data-analysis question; the HCDP AI interface can work it out for you."
        alternatives = []
        for alt in raw.get("alternatives") or []:
            if not isinstance(alt, dict):
                continue
            url = alt.get("url") or alt.get("path")
            if valid_internal_path(url or "") or self.allowed_url(url):
                alternatives.append({"title": str(alt.get("title") or url)[:120], "url": url, "why": str(alt.get("why") or "")[:160]})
            if len(alternatives) == 4:
                break
        if intent == "navigate" and not any(a["type"] in ("navigate", "open") for a in actions):
            intent = "info"
            if not reply:
                reply = "I could not find that page. Here are the closest places."
            if not alternatives:
                alternatives = self.fallback(message)["alternatives"]
        minimize = bool(raw.get("minimize")) or any(a["type"] in ("navigate", "open") for a in actions)
        return {"intent": intent, "reply": reply or "Here is what I found.", "actions": actions, "alternatives": alternatives, "minimize": minimize}

    # ----- fallback ---------------------------------------------------------
    def search(self, message: str, limit: int = 4) -> list[dict]:
        words = {w for w in re.findall(r"[a-zʻ0-9-]+", message.lower()) if len(w) > 2}
        scored = []
        for e in self.catalog:
            hay = " ".join([e.get("title", ""), e.get("summary", ""), e.get("when_to_use", ""), " ".join(e.get("tags") or []), " ".join(e.get("example_queries") or [])]).lower()
            score = sum(3 if w in e.get("title", "").lower() else 1 for w in words if w in hay)
            if score:
                scored.append((score, e))
        scored.sort(key=lambda x: -x[0])
        return [e for _, e in scored[:limit]]

    def fallback(self, message: str) -> dict:
        hits = self.search(message)
        alts = [{"title": e["title"], "url": e.get("internal_path") if e.get("internal_path") and "{" not in e["internal_path"] else e.get("url"), "why": (e.get("when_to_use") or "")[:160]} for e in hits]
        alts = [a for a in alts if a["url"]]
        reply = "The navigator is not answering right now, so here are the closest matches by keyword." if alts else "The navigator is not answering right now. Try again in a moment, or start from Access Data."
        if not alts:
            alts = [{"title": "Access Data", "url": "/data", "why": "maps and downloads"}, {"title": "Hawaiʻi Mesonet", "url": "/mesonet", "why": "live station readings"}]
        return {"intent": "info", "reply": reply, "actions": [], "alternatives": alts, "minimize": False}
