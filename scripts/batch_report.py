#!/usr/bin/env python3
"""
batch_report.py — Pretty-print a classify_batch_*.json result file.

Usage:
    python scripts/batch_report.py                  # latest file
    python scripts/batch_report.py <path_to_file>   # specific file
"""

import io
import json
import os
import re
import sys
from pathlib import Path

# Force UTF-8 output on Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


# ── Tee: write to stdout AND collect plain-text lines for file output ─────────

_plain_lines: list[str] = []
_ansi_re = re.compile(r"\033\[[0-9;]*m")

class _Tee:
    """Wraps stdout: prints normally, also accumulates ANSI-stripped lines."""
    def __init__(self, wrapped): self._w = wrapped
    def write(self, s):
        self._w.write(s)
        _plain_lines.append(_ansi_re.sub("", s))
    def flush(self): self._w.flush()
    def __getattr__(self, name): return getattr(self._w, name)

sys.stdout = _Tee(sys.stdout)  # type: ignore

# ── Find file ─────────────────────────────────────────────────────────────────

RESULTS_DIR = Path(__file__).parent.parent / "data" / "test_results"

def latest_file() -> Path:
    files = sorted(RESULTS_DIR.glob("classify_batch_*.json"))
    if not files:
        print("No result files found in", RESULTS_DIR)
        sys.exit(1)
    return files[-1]

path = Path(sys.argv[1]) if len(sys.argv) > 1 else latest_file()

with open(path, encoding="utf-8") as f:
    data = json.load(f)

results  = data["results"]
passed   = data["passed"]
total    = data["total"]
ts       = data.get("timestamp", "")[:19].replace("T", " ")
has_llm  = any(r.get("llm_response") for r in results)

# ── Helpers ───────────────────────────────────────────────────────────────────

RESET  = "\033[0m"
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
BOLD   = "\033[1m"
DIM    = "\033[2m"

def col(text, color):   return f"{color}{text}{RESET}"
def trunc(s, n):        return (s[:n] + "…") if len(s) > n else s

# ── Header ────────────────────────────────────────────────────────────────────

print()
print(col(f"  OASIS Classify Batch Report", BOLD))
print(col(f"  {ts}  ·  {path.name}", DIM))
rate = passed / total * 100
rate_color = GREEN if passed == total else (YELLOW if passed / total >= 0.85 else RED)
print(f"  Result: {col(f'{passed}/{total}', rate_color)}  ({col(f'{rate:.0f}%', rate_color)})")
print()

# ── Dispatch table ────────────────────────────────────────────────────────────

Q_W = 44
print(f"  {'Query':<{Q_W}}  {'':2}  {'Category':<22}  {'Score':>6}  {'ms':>5}")
print("  " + "─" * (Q_W + 2 + 22 + 6 + 5 + 8))

for r in results:
    mark      = col("✓", GREEN) if r["passed"] else col("✗", RED)
    query_str = trunc(r["query"], Q_W)
    cat_str   = trunc(r["actual"], 22)
    score_str = f"{r['score']:.3f}" if r["score"] is not None else "  — "
    ms_str    = f"{r['dispatch_ms']}"

    line = f"  {query_str:<{Q_W}}  {mark}  {cat_str:<22}  {score_str:>6}  {ms_str:>5}ms"
    if not r["passed"]:
        line = col(line, RED)
    print(line)

    if not r["passed"]:
        top3 = "  ".join(f"{e['category']}:{e['score']:.3f}" for e in r["top3"])
        print(col(f"    expected: {r['expected']:<22}  top3: {top3}", YELLOW))

print()

# ── LLM responses ─────────────────────────────────────────────────────────────

if has_llm:
    llm_results = [r for r in results if r.get("llm_response")]
    total_llm_ms = sum(r.get("llm_ms", 0) for r in llm_results)
    avg_llm_ms = total_llm_ms // len(llm_results) if llm_results else 0

    print(col(f"  LLM Responses  ({len(llm_results)} queries · avg {avg_llm_ms}ms)", BOLD))
    print("  " + "─" * 70)

    for r in llm_results:
        mark  = col("✓", GREEN) if r["passed"] else col("✗", RED)
        query = trunc(r["query"], 40)
        ms    = r.get("llm_ms", 0)
        print(f"\n  {mark} {col(query, BOLD)}  {col(f'[{ms}ms]', DIM)}")

        resp = r["llm_response"].strip()
        for line in resp.splitlines():
            print(f"    {line}")

    print()

# ── Failures summary ──────────────────────────────────────────────────────────

failures = [r for r in results if not r["passed"]]
if failures:
    print(col(f"  Failures ({len(failures)})", RED + BOLD))
    print("  " + "─" * 50)
    for r in failures:
        top1 = r["top3"][0] if r["top3"] else {}
        print(f"  {col('✗', RED)} {r['query']}")
        print(f"      expected  {col(r['expected'], GREEN)}")
        score_fmt = f"{r['score']:.3f}" if r["score"] is not None else "—"
        print(f"      got       {col(r['actual'], RED)}  (score {score_fmt})")
        if r["top3"]:
            top3 = "  ".join(f"{e['category']}:{e['score']:.3f}" for e in r["top3"])
            print(f"      top3      {top3}")
    print()
else:
    print(col("  All tests passed.", GREEN + BOLD))
    print()

# ── Save plain-text report ────────────────────────────────────────────────────

report_path = path.with_name(path.stem.replace("classify_batch_", "classify_report_") + ".txt")
report_path.write_text("".join(_plain_lines), encoding="utf-8")
print(f"  Saved → {report_path}", flush=True)
