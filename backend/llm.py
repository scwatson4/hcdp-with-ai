"""The navigator's model client.

gpt-5.6-sol on the NAIRR resource, reached through its OpenAI-compatible
endpoint: the same model and credentials Codex uses here. The key stays on the
server; the browser only ever talks to /api/navigate.
"""
from __future__ import annotations

import json
import os
import re
import time

from openai import OpenAI

DEFAULT_BASE = "https://sam-watson-codex-key-resource.services.ai.azure.com/openai/v1"
DEFAULT_MODEL = "gpt-5.6-sol"


def parse_json(text: str) -> dict:
    """Parse the model's JSON, tolerating prose or code fences around it."""
    text = (text or "").strip()
    try:
        out = json.loads(text)
        if isinstance(out, dict):
            return out
    except ValueError:
        pass
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("model returned no JSON object")
    out = json.loads(m.group(0))
    if not isinstance(out, dict):
        raise ValueError("model returned JSON that is not an object")
    return out


def _is_bad_request(err: Exception) -> bool:
    return getattr(err, "status_code", None) == 400


class NavigatorLLM:
    def __init__(self, base_url=None, api_key=None, model=None, reasoning_effort=None, timeout=60):
        self.base_url = base_url or os.environ.get("NAVIGATOR_API_BASE") or DEFAULT_BASE
        # NAVIGATOR_API_KEY lets the navigator use a different gateway (e.g. LiteLLM) than the rest of the env.
        self.api_key = api_key if api_key is not None else (os.environ.get("NAVIGATOR_API_KEY") or os.environ.get("AZURE_OPENAI_API_KEY", ""))
        self.model = model or os.environ.get("NAVIGATOR_MODEL") or DEFAULT_MODEL
        self.reasoning_effort = reasoning_effort or os.environ.get("NAVIGATOR_REASONING") or "low"
        # Fast mode ("priority" on Azure): honoured for gpt-5.6-sol/terra on the NAIRR resource; a gateway
        # (LiteLLM) forwards it only when whitelisted, which NAVIGATOR_ALLOW_PARAMS=1 turns on.
        self.service_tier = (os.environ.get("NAVIGATOR_SERVICE_TIER") or "").strip() or None
        self.allow_params = os.environ.get("NAVIGATOR_ALLOW_PARAMS", "0") == "1"
        self._client = OpenAI(base_url=self.base_url, api_key=self.api_key, timeout=timeout, max_retries=1) if self.api_key else None
        self.stats = {"calls": 0, "errors": 0, "last_ms": None, "last_error": None}

    @property
    def configured(self) -> bool:
        return self._client is not None

    def complete_json(self, system: str, messages: list[dict]) -> dict:
        if not self._client:
            raise RuntimeError("navigator model not configured (AZURE_OPENAI_API_KEY is empty)")
        msgs = [{"role": "system", "content": system}, *messages]
        base = dict(model=self.model, messages=msgs)
        if self.service_tier:
            if self.allow_params:
                base["extra_body"] = {"service_tier": self.service_tier, "allowed_openai_params": ["service_tier"]}
            else:
                base["service_tier"] = self.service_tier
        # Try the richest request first; drop parameters the endpoint rejects.
        attempts = [
            dict(base, response_format={"type": "json_object"}, reasoning_effort=self.reasoning_effort),
            dict(base, response_format={"type": "json_object"}),
            dict(base),
            dict(model=self.model, messages=msgs),
        ]
        t0 = time.monotonic()
        self.stats["calls"] += 1
        last = None
        for kw in attempts:
            try:
                resp = self._client.chat.completions.create(**kw)
                self.stats["last_ms"] = int((time.monotonic() - t0) * 1000)
                u = getattr(resp, "usage", None)
                if u is not None:
                    cached = getattr(getattr(u, "prompt_tokens_details", None), "cached_tokens", None)
                    self.stats["last_usage"] = {"prompt_tokens": u.prompt_tokens, "completion_tokens": u.completion_tokens, "cached_tokens": cached}
                self.stats["last_tier"] = getattr(resp, "service_tier", None)
                return parse_json(resp.choices[0].message.content or "")
            except Exception as e:  # noqa: BLE001 - we decide below whether to retry
                last = e
                if not _is_bad_request(e):
                    break
        self.stats["errors"] += 1
        self.stats["last_error"] = type(last).__name__
        self.stats["last_ms"] = int((time.monotonic() - t0) * 1000)
        raise last


NARRATION_SYSTEM = (
    "You are the navigator of the Hawaiʻi Climate Data Portal website. The visitor just asked something; while the "
    "real answer is being worked out, say in ONE short line (at most eight words, present progressive, no quotes, no "
    "trailing period) what you are doing for them — for example 'Pulling up the API access info', "
    "'Finding the Kauaʻi rainfall map', 'Opening the Hurricane Lowell report'. Plain words only."
)


class NarrationLLM:
    """A quick, simple, short line to show beside the wait indicator (the user's rule, 13 Oct): always gpt-6-luna,
    through the navigator's route, with a hard 3-second timeout; any failure means the caller shows its fallback."""

    def __init__(self, base_url=None, api_key=None, model=None, timeout=3.0):
        self.base_url = base_url or os.environ.get("NAVIGATOR_API_BASE") or DEFAULT_BASE
        self.api_key = api_key if api_key is not None else (os.environ.get("NAVIGATOR_API_KEY") or os.environ.get("AZURE_OPENAI_API_KEY", ""))
        self.model = model or os.environ.get("NARRATION_MODEL") or "gpt-6-luna"
        self._client = OpenAI(base_url=self.base_url, api_key=self.api_key, timeout=timeout, max_retries=0) if self.api_key else None
        self.stats = {"calls": 0, "errors": 0, "last_ms": None}

    @property
    def configured(self) -> bool:
        return self._client is not None

    def narrate(self, message: str) -> str | None:
        if not self._client or not (message or "").strip():
            return None
        msgs = [{"role": "system", "content": NARRATION_SYSTEM}, {"role": "user", "content": message.strip()[:500]}]
        t0 = time.monotonic()
        self.stats["calls"] += 1
        for kw in (dict(model=self.model, messages=msgs, max_completion_tokens=24, reasoning_effort="low"), dict(model=self.model, messages=msgs, max_completion_tokens=24), dict(model=self.model, messages=msgs)):
            try:
                resp = self._client.chat.completions.create(**kw)
                self.stats["last_ms"] = int((time.monotonic() - t0) * 1000)
                line = (resp.choices[0].message.content or "").strip().strip('"').strip("'").rstrip(".").strip()
                line = line.split("\n")[0][:80]
                return line or None
            except Exception as e:  # noqa: BLE001
                if not _is_bad_request(e):
                    break
        self.stats["errors"] += 1
        self.stats["last_ms"] = int((time.monotonic() - t0) * 1000)
        return None
