"""What the viewer knows about each product beyond its API mapping: display units, the portal's
fixed legend range and label rules, and the island boxes used to crop shared grids.

The ranges and label rules mirror frontend/src/viewer/portalDatasets.reference.js (copied from the HCDP
portal's dataset-form-manager.service.ts and leaflet-color-scale component), so a link preview carries
the same legend the viewer draws. Units are the viewer's urlGrammar.DATASETS units.
"""
from __future__ import annotations

from navigator import DATASETS

# dataset units as the viewer shows them (station values and time series come back in these)
UNITS = {"rainfall": "mm", "rainfall-legacy": "mm", "temperature-mean": "°C", "temperature-max": "°C", "temperature-min": "°C", "humidity": "%"}

# Portal legend settings per HCDP datatype/period: (label, units, range, range_absolute, extreme range or None).
# range_absolute marks a closed end; an open end gets a "+" (top) or "-" (bottom) suffix on its label.
_TEMP_AGG = {"mean": "Mean", "max": "Maximum", "min": "Minimum"}


def portal_dataset(dataset: str, period: str) -> dict | None:
    api = DATASETS.get(dataset, {}).get("api")
    if not api:
        return None
    dtype, cadence = api["datatype"], ("Daily" if period == "day" else "Monthly")
    if dtype == "rainfall":
        if period == "day":
            return {"label": "Daily Rainfall", "name": "Rainfall", "units": "mm", "range": (0, 20), "absolute": (True, False), "extreme": (0, 250)}
        return {"label": "Monthly Rainfall", "name": "Rainfall", "units": "mm", "range": (0, 650), "absolute": (True, False), "extreme": None}
    if dtype == "temperature":
        agg = _TEMP_AGG.get(api.get("aggregation"), "Mean")
        return {"label": f"{cadence} {agg} Temperature", "name": f"{agg} Temperature", "units": "°C", "range": (-10, 35), "absolute": (False, False), "extreme": None}
    if dtype == "relative_humidity":
        return {"label": "Daily Relative Humidity", "name": "Relative Humidity", "units": "%", "range": (0, 100), "absolute": (True, True), "extreme": None}
    if dtype == "ndvi_modis":
        return {"label": "Normalized Difference Vegetation Index (NDVI)", "name": "NDVI", "units": "", "range": (-0.2, 1), "absolute": (False, True), "extreme": None}
    if dtype == "ignition_probability":
        lead = api.get("lead")
        suffix = f", {int(lead[-2:])} day{'s' if int(lead[-2:]) > 1 else ''} ahead" if lead else ""
        return {"label": "Ignition Probability" + suffix, "name": "Ignition Probability", "units": "", "range": (0, 1), "absolute": (True, True), "extreme": None}
    if dtype == "spi":
        n = int(api["timescale"].replace("timescale", "")) or 1
        name = f"{n}-Month Standardized Precipitation Index (SPI-{n})"
        return {"label": name, "name": f"SPI-{n}", "units": "", "range": (-3, 3), "absolute": (False, False), "extreme": None}
    return None


def display_unit(dataset: str, units_opt: str | None) -> str:
    """The unit label in effect for a dataset given the ?units= option (data is never converted on the server)."""
    base = UNITS.get(dataset, "")
    if base == "mm" and units_opt == "in":
        return "in"
    if base == "°C" and units_opt == "f":
        return "°F"
    return base


def to_display(value: float, dataset: str, units_opt: str | None) -> float:
    base = UNITS.get(dataset, "")
    if base == "mm" and units_opt == "in":
        return value / 25.4
    if base == "°C" and units_opt == "f":
        return value * 9 / 5 + 32
    return value


def _fmt(v: float) -> str:
    r = round(v, 2)
    return f"{int(r):,}" if r == int(r) else f"{r:,.2f}".rstrip("0").rstrip(".")


def legend_labels(lo: float, hi: float, absolute: tuple[bool, bool]) -> tuple[str, str]:
    """(bottom, top) legend labels with the portal's "+" conventions."""
    bottom = ("+" if lo > 0 else "") + _fmt(lo) + ("" if absolute[0] else "-")
    top = ("+" if hi > 0 else "") + _fmt(hi) + ("" if absolute[1] else "+")
    return bottom, top


def legend_for(dataset: str, period: str, opts: dict) -> dict | None:
    """Domain (data units) and the display legend for a view: {"domain", "header", "lo", "hi", "units"}."""
    ds = portal_dataset(dataset, period)
    if not ds:
        return None
    rng = ds["extreme"] if opts.get("scale") == "extreme" and ds["extreme"] else ds["range"]
    unit = display_unit(dataset, opts.get("units")) if UNITS.get(dataset) else ds["units"]
    lo, hi = (to_display(rng[0], dataset, opts.get("units")), to_display(rng[1], dataset, opts.get("units")))
    bottom, top = legend_labels(lo, hi, ds["absolute"])
    return {"domain": rng, "header": f"{ds['name']} ({unit})" if unit else ds["name"], "lo": bottom, "hi": top, "units": unit, "label": ds["label"]}


# (west, south, east, north): the island a shared grid is cropped to for previews (mn = Maui County; SPI and
# legacy rainfall are statewide only).
ISLAND_BOUNDS = {
    "hawaii": (-156.10, 18.85, -154.75, 20.30),
    "maui": (-156.75, 20.55, -155.95, 21.05),
    "molokai": (-157.35, 21.03, -156.68, 21.25),
    "lanai": (-157.10, 20.70, -156.78, 20.95),
    "oahu": (-158.32, 21.22, -157.60, 21.75),
    "kauai": (-160.30, 21.80, -159.25, 22.30),
}
