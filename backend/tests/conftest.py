"""Shared test settings. The mirror of HCDP's pages (backend/portal.py) starts a background job with the app that fetches
from www.hawaii.edu; no test may ever start it, whatever client it builds (a `with TestClient(app)` runs startup events)."""
import os

os.environ["PORTAL_JOB"] = "0"
