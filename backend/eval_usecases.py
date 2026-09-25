"""Run backend/data/usecases.json against the navigator with the real model.

    python eval_usecases.py [--limit N] [--workers 4] [--out results.json]

Prints a summary and a Markdown table of misses. A case passes on intent when
the navigator's intent equals expected_intent; it passes on target when the
primary action (first navigate/open) resolves to one of expected_ids, or the
navigate path starts with expected_path_prefix, or (analysis) a handoff exists.
"Near" means an expected target appeared among the alternatives instead.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
from llm import NavigatorLLM  # noqa: E402
from navigator import Navigator, load_catalog  # noqa: E402


def targets_of(entry: dict) -> set[str]:
    out = set()
    if entry.get("url"):
        out.add(entry["url"].rstrip("/"))
    ip = entry.get("internal_path")
    if ip and "{" not in ip:
        out.add(ip)
    return out


def resolve(catalog: list[dict], ref: str | None) -> set[str]:
    """Catalog ids whose url/internal_path match `ref` (viewer paths match viewer templates)."""
    if not ref:
        return set()
    ids = set()
    r = ref.rstrip("/")
    for e in catalog:
        if r in targets_of(e) or r.split("#")[0] in targets_of(e):
            ids.add(e["id"])
        ip = e.get("internal_path") or ""
        if "{" in ip and r.startswith("/viewer/"):
            head = ip.split("{")[0]
            if r.startswith(head):
                ids.add(e["id"])
    return ids


def judge(case: dict, out: dict, catalog: list[dict]) -> dict:
    exp_intent = case.get("expected_intent")
    intent_ok = out.get("intent") == exp_intent
    primary = next((a.get("path") or a.get("url") for a in out.get("actions", []) if a.get("type") in ("navigate", "open")), None)
    alts = [a.get("url") for a in out.get("alternatives", [])]
    exp_ids = set(case.get("expected_ids") or [])
    prefix = case.get("expected_path_prefix")
    target_ok = near = False
    if exp_intent == "analysis":
        target_ok = any(a.get("type") == "handoff" for a in out.get("actions", []))
    elif exp_intent in ("info", "clarify"):
        target_ok = intent_ok or bool(exp_ids & set().union(*[resolve(catalog, u) for u in alts] or [set()]))
    else:
        if prefix and primary and primary.startswith(prefix):
            target_ok = True
        elif exp_ids and (resolve(catalog, primary) & exp_ids):
            target_ok = True
        elif prefix and any((u or "").startswith(prefix) for u in alts):
            near = True
        elif exp_ids and any(resolve(catalog, u) & exp_ids for u in alts):
            near = True
    return {"id": case["id"], "persona": case.get("persona"), "query": case["query"], "expected_intent": exp_intent, "intent": out.get("intent"),
            "intent_ok": intent_ok, "target_ok": target_ok, "near": near, "primary": primary, "reply": out.get("reply"), "error": out.get("error"),
            "expected": sorted(exp_ids) or prefix}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out", default="")
    ap.add_argument("--cases", default=str(Path(__file__).resolve().parent / "data" / "usecases.json"))
    args = ap.parse_args()
    data = json.loads(Path(args.cases).read_text(encoding="utf-8"))
    cases = data["cases"] if isinstance(data, dict) else data
    if args.limit:
        cases = cases[: args.limit]
    catalog = load_catalog()
    nav = Navigator(NavigatorLLM(timeout=90), catalog)

    def run(case):
        t0 = time.monotonic()
        out = nav.respond(case["query"], [], case.get("context") or {"path": "/"})
        j = judge(case, out, catalog)
        j["ms"] = int((time.monotonic() - t0) * 1000)
        return j

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        results = list(ex.map(run, cases))
    n = len(results)
    ok_i = sum(r["intent_ok"] for r in results)
    ok_t = sum(r["target_ok"] for r in results)
    near = sum(r["near"] for r in results)
    errs = sum(1 for r in results if r["error"])
    lat = sorted(r["ms"] for r in results)
    print(f"cases {n}  intent ok {ok_i} ({ok_i / n:.0%})  target ok {ok_t} ({ok_t / n:.0%})  near {near}  model errors {errs}  latency p50 {lat[n // 2]} ms p90 {lat[int(n * 0.9) - 1]} ms")
    by = {}
    for r in results:
        b = by.setdefault(r["persona"], [0, 0, 0])
        b[0] += 1; b[1] += r["intent_ok"]; b[2] += r["target_ok"]
    for p, (c, i, t) in sorted(by.items()):
        print(f"  {p:20s} n={c:2d} intent {i}/{c} target {t}/{c}")
    print("\n| case | query | expected | got intent | primary | ok |\n|---|---|---|---|---|---|")
    for r in results:
        if not (r["intent_ok"] and r["target_ok"]):
            flag = "near" if r["near"] else "MISS"
            print(f"| {r['id']} | {r['query']} | {r['expected_intent']} → {r['expected']} | {r['intent']} | {r['primary'] or ''} | {flag} |")
    if args.out:
        Path(args.out).write_text(json.dumps({"summary": {"n": n, "intent_ok": ok_i, "target_ok": ok_t, "near": near, "errors": errs}, "results": results}, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
