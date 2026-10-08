"""HCDP station data for the viewer: the climate station list, one date's station values, and a
station's or a grid cell's record. Pure query building and merging live here (tested without the
network); app.py owns the HTTP client, caching and the routes.

What the HCDP API wants (verified against api.hcdp.ikewai.org on 2026-10-01):

  GET /stations?q=<query>&limit=10000&offset=0 → {"result": [{"value": {...}}, ...]}, at most 10,000 rows.
  The query is the portal's own spelling (propertiesToQuery in its request factory), single quotes:
    {'name':'hcdp_station_metadata','value.station_group':'hawaii_climate_primary'}       2,684 rows
    {'name':'hcdp_station_value','value.datatype':'rainfall','value.production':'new',
     'value.period':'day','value.fill':'partial','value.date':'2026-09-30'}                 224 rows
  Every station_value query must carry the full key set below: a query keyed on datatype+date alone
  scans the collection and the API answers 500 after ~47 s.

  Station-value keys per dataset (discovered: which (period, fill, production, aggregation) rows exist):
    rainfall          datatype=rainfall, production=new, period=day|month; fill=partial (day 224, month 184)
                      or raw (day 219; NO raw monthly rows).
    temperature-max   datatype=temperature, aggregation=max, period=day|month; fill=partial|raw;
    temperature-min   there is NO production key (adding production=new returns nothing).
    temperature-mean  no rows at all — HCDP's station temperature is published as daily/monthly max and
                      min only; the endpoint answers 404 and says so.
    humidity          datatype=relative_humidity, period=day; fill=partial only; no production key.
  Station ids: rainfall rows spell an integer SKN as '1146', temperature and humidity rows as '1146.0';
  decimal SKNs ('1020.1') are spelled the same everywhere. Metadata carries both spellings for a few
  stations. norm_skn() folds '1146.0' → '1146' and series queries ask for both spellings with $in.

  A record is read in windows of 500 steps from the newest end (the portal does the same), wrapped as
    {'$and':[{...station query...,'value.station_id':{'$in':['1146','1146.0']}},
             {'value.date':{'$gte':'2026-09-01'}},{'value.date':{'$lt':'2026-10-01'}}]}
  (monthly dates are 'YYYY-MM'; string comparison works). Rows come back in no particular order.

  GET /raster/timeseries?datatype=…&period=day|month&extent=statewide&lat=&lng=&start=&end= →
    {"2026-09-01T10:00:00.000Z": 7.717, …} (HST midnight stamps; -3.4e38 where the cell is ocean/nodata;
    {} outside the grid). No span cap: 36 years of days (13,421 points) took 10.6 s in one call, 2 years
    0.6 s, so long spans are split into ≤ 3-year windows fetched four at a time. Monthly accepts start/end
    as YYYY-MM or YYYY-MM-01.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import math
import re

import httpx

# HCDP island codes → the viewer's extent slugs (KO = Kahoʻolawe, no extent of its own).
ISLAND_EXTENT = {"BI": "hawaii", "MA": "maui", "OA": "oahu", "KA": "kauai", "MO": "molokai", "LA": "lanai"}
METADATA_QUERY = {"station_group": "hawaii_climate_primary"}
# hcdp_station_value keys per viewer dataset (period, fill and date are added per request).
STATION_QUERY = {
    "rainfall": {"datatype": "rainfall", "production": "new"},
    "temperature-mean": {"datatype": "temperature", "aggregation": "mean"},   # exists in the grammar; HCDP has no rows
    "temperature-max": {"datatype": "temperature", "aggregation": "max"},
    "temperature-min": {"datatype": "temperature", "aggregation": "min"},
    "humidity": {"datatype": "relative_humidity"},
}
FILLS = ("partial", "raw")
WINDOW_STEPS = 500          # one /stations call per 500 days or months, newest first
STATION_CONCURRENCY = 4
CELL_WINDOW_YEARS = 3       # one /raster/timeseries call per ≤ 3 years of days
CELL_CONCURRENCY = 4
MAX_ROWS = 10000
SKN_RE = re.compile(r"^\d{1,5}(\.\d{1,3})?$")


# ----- query building -------------------------------------------------------------
def props_query(name: str, props: dict) -> str:
    """The portal's propertiesToQuery: {'name':'…','value.k':'v',…} with single quotes."""
    return "{" + ",".join([f"'name':'{name}'"] + [f"'value.{k}':'{v}'" for k, v in props.items()]) + "}"


def norm_skn(s) -> str:
    """'1146.0' → '1146'; '1020.1' stays. The viewer's one spelling of a station id."""
    s = str(s).strip()
    return s[:-2] if s.endswith(".0") else s


def skn_spellings(skn: str) -> list[str]:
    skn = norm_skn(skn)
    return [skn, skn + ".0"] if "." not in skn else [skn]


def value_props(dataset: str, period: str, fill: str) -> dict:
    return {**STATION_QUERY[dataset], "period": period, "fill": fill}


def values_query(dataset: str, period: str, date: str, fill: str = "partial") -> str:
    return props_query("hcdp_station_value", {**value_props(dataset, period, fill), "date": date})


def series_query(dataset: str, period: str, skn: str, start: str, end_exclusive: str, fill: str = "partial") -> str:
    """One window of a station's record: [start, end_exclusive) in the period's date spelling."""
    ids = ",".join(f"'{s}'" for s in skn_spellings(skn))
    base = props_query("hcdp_station_value", value_props(dataset, period, fill))[:-1] + f",'value.station_id':{{'$in':[{ids}]}}}}"
    return f"{{'$and':[{base},{{'value.date':{{'$gte':'{start}'}}}},{{'value.date':{{'$lt':'{end_exclusive}'}}}}]}}"


# ----- dates ---------------------------------------------------------------------
def step(date: str, n: int, period: str) -> str:
    """`date` moved n steps (days or months) in the period's spelling."""
    if period == "day":
        return (dt.date.fromisoformat(date) + dt.timedelta(days=n)).isoformat()
    y, m = int(date[:4]), int(date[5:7])
    k = y * 12 + (m - 1) + n
    return f"{k // 12:04d}-{k % 12 + 1:02d}"


def steps_between(start: str, end: str, period: str) -> int:
    if period == "day":
        return (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days
    return (int(end[:4]) * 12 + int(end[5:7])) - (int(start[:4]) * 12 + int(start[5:7]))


def windows(start: str, end: str, period: str, size: int = WINDOW_STEPS) -> list[tuple[str, str]]:
    """[(lo, hi_exclusive), …] covering [start, end] inclusive, newest window first."""
    out, hi = [], step(end, 1, period)
    while True:
        lo = step(hi, -size, period)
        if steps_between(start, lo, period) <= 0:
            out.append((start, hi))
            return out
        out.append((lo, hi))
        hi = lo


def dense_points(values: dict[str, float | None], period: str) -> list[list]:
    """[[date, value|None], …] ascending, every step between the first and last observed date present
    (gaps inside the record are explicit nulls; nothing is padded outside it)."""
    if not values:
        return []
    dates = sorted(values)
    out, d, last = [], dates[0], dates[-1]
    while d <= last:
        out.append([d, values.get(d)])
        d = step(d, 1, period)
    return out


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) and -1e30 < f < 1e30 else None


# ----- shaping ---------------------------------------------------------------------
def parse_rows(payload) -> list[dict]:
    if not isinstance(payload, dict):
        return []
    return [it["value"] for it in payload.get("result") or [] if isinstance(it, dict) and isinstance(it.get("value"), dict)]


def metadata_to_stations(rows: list[dict]) -> list[dict]:
    """The viewer's station list: one entry per (normalised) SKN, island code plus extent slug, sorted by SKN."""
    by: dict[str, dict] = {}
    for v in rows:
        skn = norm_skn(v.get("skn", ""))
        if not skn or not SKN_RE.match(skn):
            continue
        lat, lng = _num(v.get("lat")), _num(v.get("lng"))
        if lat is None or lng is None:
            continue
        island = v.get("island") or None
        elev = _num(v.get("elevation_m"))
        if elev is not None and elev == int(elev):
            elev = int(elev)
        entry = {"skn": skn, "name": (v.get("name") or "").strip(), "island": island, "extent": ISLAND_EXTENT.get(island or ""),
                 "lat": lat, "lng": lng, "elevation_m": elev, "network": v.get("network") or None, "observer": v.get("observer") or None}
        prev = by.get(skn)
        if prev is None or (not prev["name"] and entry["name"]):
            by[skn] = entry
    return [by[k] for k in sorted(by, key=lambda s: (float(s), s))]


def join_values(rows: list[dict], by_skn: dict[str, dict]) -> list[dict]:
    """Station values joined with metadata; rows without metadata or without a finite value are dropped."""
    out, seen = [], set()
    for v in rows:
        skn = norm_skn(v.get("station_id", ""))
        meta = by_skn.get(skn)
        val = _num(v.get("value"))
        if meta is None or val is None or skn in seen:
            continue
        seen.add(skn)
        out.append({"skn": skn, "name": meta["name"], "island": meta["island"], "extent": meta["extent"], "lat": meta["lat"], "lng": meta["lng"], "value": val})
    return out


def merge_series(batches: list[list[dict]]) -> dict[str, float | None]:
    """Rows from every window → {date: value}; the first (newest) window wins on a duplicate date."""
    out: dict[str, float | None] = {}
    for rows in batches:
        for v in rows:
            d = str(v.get("date") or "")
            if d and d not in out:
                out[d] = _num(v.get("value"))
    return out


# ----- fetching --------------------------------------------------------------------
async def fetch_station_rows(client: httpx.AsyncClient, query: str) -> list[dict]:
    r = await client.get("/stations", params={"q": query, "limit": MAX_ROWS, "offset": 0})
    if r.status_code != 200:
        raise httpx.HTTPStatusError(f"HCDP /stations returned {r.status_code}", request=r.request, response=r)
    return parse_rows(r.json())


async def fetch_series(client: httpx.AsyncClient, dataset: str, period: str, skn: str, start: str, end: str, fill: str = "partial",
                       concurrency: int = STATION_CONCURRENCY) -> dict[str, float | None]:
    """A station's record over [start, end]: 500-step windows, newest first, a few in flight, merged."""
    sem = asyncio.Semaphore(concurrency)

    async def one(lo: str, hi: str) -> list[dict]:
        async with sem:
            return await fetch_station_rows(client, series_query(dataset, period, skn, lo, hi, fill))

    batches = await asyncio.gather(*(one(lo, hi) for lo, hi in windows(start, end, period)))
    return merge_series(list(batches))


def cell_windows(start: str, end: str, period: str, years: int = CELL_WINDOW_YEARS) -> list[tuple[str, str]]:
    """Inclusive [lo, hi] spans of at most `years` for the raster time series; one window for months."""
    if period != "day":
        return [(start, end)]
    out, lo = [], dt.date.fromisoformat(start)
    last = dt.date.fromisoformat(end)
    while lo <= last:
        hi = min(last, dt.date(lo.year + years, lo.month, lo.day) - dt.timedelta(days=1))
        out.append((lo.isoformat(), hi.isoformat()))
        lo = hi + dt.timedelta(days=1)
    return out


def parse_cell_payload(payload, period: str) -> dict[str, float | None]:
    """{"2026-09-01T10:00:00.000Z": 7.7} → {"2026-09-01": 7.7} ("2026-09" for months); nodata → None."""
    out: dict[str, float | None] = {}
    if not isinstance(payload, dict):
        return out
    for k, v in payload.items():
        d = str(k)[:10 if period == "day" else 7]
        if re.match(r"^\d{4}-\d{2}(-\d{2})?$", d):
            out[d] = _num(v)
    return out


async def fetch_cell_series(client: httpx.AsyncClient, api: dict, period: str, lat: float, lng: float, start: str, end: str,
                            concurrency: int = CELL_CONCURRENCY) -> dict[str, float | None]:
    """A grid cell's record from HCDP /raster/timeseries, long daily spans split into parallel windows."""
    sem = asyncio.Semaphore(concurrency)

    async def one(lo: str, hi: str) -> dict:
        async with sem:
            params = {**api, "period": period, "extent": "statewide", "lat": f"{lat:.5f}", "lng": f"{lng:.5f}", "start": lo, "end": hi}
            r = await client.get("/raster/timeseries", params=params)
            if r.status_code != 200:
                raise httpx.HTTPStatusError(f"HCDP /raster/timeseries returned {r.status_code}", request=r.request, response=r)
            return parse_cell_payload(r.json(), period)

    parts = await asyncio.gather(*(one(lo, hi) for lo, hi in cell_windows(start, end, period)))
    out: dict[str, float | None] = {}
    for p in parts:
        out.update(p)
    return out
