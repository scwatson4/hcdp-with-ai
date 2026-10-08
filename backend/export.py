"""Native data export: what the HCDP v2 rewrite's export form offers, validated here and turned into
the exact request body its export service sends to HCDP's genzip endpoints. Pure functions; app.py owns
the HTTP client (the HCDP token stays there), the rate limits and the routes.

The recipes mirror hcdp_v2's dataset configs (src/assets/datasets/time-dependent-variables/*.json, read
2026-10-08): per product, the gridded files (data_map, se, anom, anom_se, metadata; GeoTIFF or text) over
one or more extents, and the station CSVs (partial-filled, and unfilled where HCDP has it). A file that
`requires` another (every grid needs the metadata file) pulls it in.

The payload (ExportDataHandler.getExportPackageGroupDetails + ExportContainer.getExportPackageData):

    {"email": "...", "data": [{
        "fileData": [{"fileParams": {"extent": ["statewide", "oa"], "units": ["mm"]}, "files": ["data_map", "metadata"]},
                     {"fileParams": {"extent": ["statewide"], "units": ["mm"], "fill": ["partial", "raw"]},
                      "files": ["station_data", "station_data"]}],
        "params": {"location": "hawaii", "datatype": "rainfall", "production": "new", "period": "month"},
        "dates": {"start": "2026-01", "end": "2026-08", "unit": "month", "interval": 1}}]}

(hcdp_v2 appends one file tag per selected file, so two station files give "station_data" twice, with both
fills in fileParams.fill — reproduced as is.) hcdp_v2 downloads in the browser up to IN_SITE_EXPORT_MAX = 150
files (periods × Σ over groups of (Σ property values × files)); beyond that the package is emailed.
"""
from __future__ import annotations

import datetime as dt
import re

INSTANT_MAX_FILES = 150          # hcdp_v2's IN_SITE_EXPORT_MAX
EMAIL_MAX_FILES = 50_000         # our own ceiling for an emailed package
MAX_YEARS = {"day": 40, "month": 120}
EXTENT_CODES = {"statewide": "statewide", "hawaii": "bi", "maui": "mn", "molokai": "mn", "lanai": "mn", "oahu": "oa", "kauai": "ka"}
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

FILE_TYPES = {
    "tif": {"label": "GeoTIFF", "ext": ".tif", "description": "A georeferenced raster: the gridded map, readable in QGIS, ArcGIS, rasterio, GDAL."},
    "txt": {"label": "Text", "ext": ".txt", "description": "A plain-text file."},
    "csv": {"label": "Comma-separated values", "ext": ".csv", "description": "A text table with the values separated by commas."},
}
_GRID_FILES = {
    "data_map": {"label": "{what} map", "description": "The gridded {what_lc} map: estimated values over the whole extent.", "type": "tif", "requires": ["metadata"]},
    "se": {"label": "Standard error map", "description": "The standard error of the gridded values.", "type": "tif", "requires": ["metadata"]},
    "anom": {"label": "Anomaly map", "description": "The gridded values as anomalies against the long-term mean.", "type": "tif", "requires": ["metadata"]},
    "anom_se": {"label": "Anomaly standard error", "description": "The standard error of the anomaly values.", "type": "tif", "requires": ["metadata"]},
    "metadata": {"label": "Metadata and error metrics", "description": "Product metadata and error metrics for each map.", "type": "txt", "requires": []},
}
_STATION_FILES = {
    "partial": {"label": "Partial-filled station data", "description": "Quality-controlled station values; some missing values are estimated. The gridded maps are made from these.", "type": "csv"},
    "raw": {"label": "Unfilled station data", "description": "Station values as reported, before QA/QC.", "type": "csv"},
}
ALL_EXTENTS = ["statewide", "hawaii", "maui", "oahu", "kauai"]


def _product(id_, label, what, periods, params, units, grid_files, station_fills, extents=ALL_EXTENTS):
    return {"id": id_, "label": label, "what": what, "periods": periods, "params": params, "units": units,
            "grid_files": grid_files, "station_fills": station_fills, "extents": extents}


# The products hcdp_v2 exports (in its order). `station_fills` maps period → the fills HCDP has.
PRODUCTS = [
    _product("rainfall", "Rainfall", "Rainfall", ["month", "day"], {"location": "hawaii", "datatype": "rainfall", "production": "new"}, "mm",
             ["data_map", "se", "anom", "anom_se", "metadata"], {"month": ["partial"], "day": ["partial", "raw"]}),
    _product("rainfall-legacy", "Rainfall (legacy, 1920–2012)", "Rainfall", ["month"], {"location": "hawaii", "datatype": "rainfall", "production": "legacy"}, "mm",
             ["data_map"], {"month": []}, extents=["statewide"]),
    _product("temperature-max", "Maximum temperature", "Temperature", ["month", "day"], {"location": "hawaii", "datatype": "temperature", "aggregation": "max"}, "c",
             ["data_map", "se", "metadata"], {"month": ["partial"], "day": ["partial"]}),
    _product("temperature-min", "Minimum temperature", "Temperature", ["month", "day"], {"location": "hawaii", "datatype": "temperature", "aggregation": "min"}, "c",
             ["data_map", "se", "metadata"], {"month": ["partial"], "day": ["partial"]}),
    # hcdp_v2 spells this aggregation "avg"; the HCDP API documents min/max/mean and /api/raster works with mean.
    _product("temperature-mean", "Mean temperature", "Temperature", ["month", "day"], {"location": "hawaii", "datatype": "temperature", "aggregation": "mean"}, "c",
             ["data_map", "se", "metadata"], {"month": [], "day": []}),
]
PRODUCT_BY_ID = {p["id"]: p for p in PRODUCTS}


class ExportError(ValueError):
    """A request the form could not have sent: the message is for the visitor."""


def options() -> dict:
    """What the form offers (GET /api/export/options): the products with their files, extents and fills."""
    out = []
    for p in PRODUCTS:
        what, what_lc = p["what"], p["what"].lower()
        grid = [{"id": f, "tag": f, "label": _GRID_FILES[f]["label"].format(what=what), "description": _GRID_FILES[f]["description"].format(what_lc=what_lc),
                 "type": _GRID_FILES[f]["type"], "requires": _GRID_FILES[f]["requires"]} for f in p["grid_files"]]
        out.append({"id": p["id"], "label": p["label"], "periods": p["periods"], "units": p["units"], "extents": p["extents"],
                    "grid_files": grid, "station_fills": {k: [{"id": f, "label": _STATION_FILES[f]["label"], "description": _STATION_FILES[f]["description"], "type": "csv"} for f in v] for k, v in p["station_fills"].items()}})
    return {"datasets": out, "file_types": FILE_TYPES, "instant_max_files": INSTANT_MAX_FILES, "email_max_files": EMAIL_MAX_FILES}


def valid_email(text) -> bool:
    s = str(text or "").strip()
    return 3 <= len(s) <= 254 and bool(_EMAIL_RE.match(s)) and not any(ord(c) < 32 for c in s)


def _date(text, period: str, what: str) -> str:
    s = str(text or "").strip()
    try:
        if period == "day":
            return dt.date.fromisoformat(s).isoformat()
        if len(s) != 7:
            raise ValueError
        dt.date.fromisoformat(s + "-01")
        return s
    except ValueError:
        raise ExportError(f"{what} must be YYYY-MM-DD for daily data or YYYY-MM for monthly data") from None


def periods_between(start: str, end: str, period: str) -> int:
    """Inclusive count of days or months from start to end."""
    if period == "day":
        return (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days + 1
    return (int(end[:4]) * 12 + int(end[5:7])) - (int(start[:4]) * 12 + int(start[5:7])) + 1


def _list(value, what: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, (list, tuple)) or not all(isinstance(x, str) for x in value):
        raise ExportError(f"{what} must be a list of names")
    out: list[str] = []
    for x in value:
        if x not in out:
            out.append(x)
    return out


def validate(body: dict) -> dict:
    """The request the form sends → a checked, normalised description:
    {product, period, start, end, extents (viewer slugs), grid_files, station_fills, email, files (estimate)}."""
    if not isinstance(body, dict):
        raise ExportError("the request must be a JSON object")
    product = PRODUCT_BY_ID.get(str(body.get("dataset", "")))
    if not product:
        raise ExportError(f"unknown dataset; one of {', '.join(PRODUCT_BY_ID)}")
    period = str(body.get("period", ""))
    if period not in product["periods"]:
        raise ExportError(f"{product['label']} is available by {' and '.join(product['periods'])}")
    start, end = _date(body.get("start"), period, "start"), _date(body.get("end"), period, "end")
    if start > end:
        raise ExportError("start must not be after end")
    if periods_between(start, end, period) / (365.25 if period == "day" else 12) > MAX_YEARS[period]:
        raise ExportError(f"a {'daily' if period == 'day' else 'monthly'} export covers at most {MAX_YEARS[period]} years at a time")
    grid_files = _list(body.get("files"), "files")
    bad = [f for f in grid_files if f not in product["grid_files"]]
    if bad:
        raise ExportError(f"{product['label']} has no file {bad[0]!r}; choose from {', '.join(product['grid_files'])}")
    for f in list(grid_files):            # a grid needs its metadata file (hcdp_v2 ticks it for you)
        for req in _GRID_FILES[f]["requires"]:
            if req in product["grid_files"] and req not in grid_files:
                grid_files.append(req)
    fills = _list(body.get("station_files"), "station_files")
    allowed_fills = product["station_fills"].get(period, [])
    bad = [f for f in fills if f not in allowed_fills]
    if bad:
        raise ExportError(f"{product['label']} by {period} has no station data {bad[0]!r}" + (f"; choose from {', '.join(allowed_fills)}" if allowed_fills else ""))
    extents = _list(body.get("extents"), "extents") if grid_files else []
    if grid_files and not extents:
        raise ExportError("choose at least one extent for the maps")
    bad = [e for e in extents if e not in product["extents"]]
    if bad:
        raise ExportError(f"{product['label']} is not published for {bad[0]!r}; choose from {', '.join(product['extents'])}")
    if not grid_files and not fills:
        raise ExportError("choose at least one file")
    email = str(body.get("email") or "").strip()
    if email and not valid_email(email):
        raise ExportError("that does not look like an email address")
    n = periods_between(start, end, period)
    files = n * (len(extents) * len(grid_files) + len(fills))
    return {"product": product, "period": period, "start": start, "end": end, "extents": extents, "grid_files": grid_files,
            "station_fills": fills, "email": email, "files": files}


def estimate_files(req: dict) -> int:
    return int(req["files"])


def package_group(req: dict) -> dict:
    """hcdp_v2's packageGroupDetails for a validated request (see the module docstring)."""
    p = req["product"]
    file_data = []
    if req["grid_files"]:
        file_data.append({"fileParams": {"extent": [EXTENT_CODES[e] for e in req["extents"]], "units": [p["units"]]}, "files": list(req["grid_files"])})
    if req["station_fills"]:
        file_data.append({"fileParams": {"extent": ["statewide"], "units": [p["units"]], "fill": list(req["station_fills"])}, "files": ["station_data"] * len(req["station_fills"])})
    return {"fileData": file_data, "params": {**p["params"], "period": req["period"]},
            "dates": {"start": req["start"], "end": req["end"], "unit": req["period"], "interval": 1}}


def payload(req: dict) -> dict:
    """The body for /genzip/instant/content and /genzip/email: {email?, data: [packageGroupDetails]}."""
    out: dict = {"data": [package_group(req)]}
    if req.get("email"):
        out["email"] = req["email"]
    return out


def zip_filename(req: dict) -> str:
    return f"hcdp_{req['product']['id']}_{req['period']}_{req['start']}_{req['end']}.zip"
