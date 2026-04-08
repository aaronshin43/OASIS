# Python Module Reference — `python/oasis-classify/`

Quick reference for every Python file in the classify service. Load only the files relevant to your task.

---

## Core Pipeline Modules

| File | Role | Read when... |
|------|------|-------------|
| `service.py` | Flask HTTP service (port 5002). Exposes `GET /health`, `POST /dispatch`. Entry point when running `python service.py`. Calls `dispatch()` which is also importable for tests. | Modifying API endpoints, request/response schema, or service startup logic |
| `classifier.py` | **Tier 1 — centroid classifier.** Loads `data/centroids.npy` at startup, embeds query with gte-small, returns `DispatchResult` with `mode`, `category`, `score`, `top3`, `threshold_path`, `latency_ms`. Applies `prev_triage_hint` boost and OOD detection. | Changing score thresholds, triage band, OOD logic, or embedding model |
| `fast_match.py` | **Tier 0 — zero-latency fast path.** Tier 0A: word count ≤ 3 → `short_queries.json` dict lookup. Tier 0B: word count > 3 → `sentence_matches.json` dict lookup. ASR-robust normalization + edit-distance-1 tolerance for short tokens. | Editing fast-path entries, normalization rules, or adding new short-query mappings |
| `prompt_builder.py` | Assembles compact LLM system prompt from manual text + user query. Handles multi-label: primary manual + short "also check" block from `also_check_summaries.json`. Enforces `MAX_PROMPT_TOKENS (400)` hard ceiling via `tiktoken`. | Changing prompt format, token budget, or multi-label assembly logic |
| `manual_store.py` | Loads `data/manuals/*.txt` at startup into a `dict[str, str]`. Serves manual text by category ID. | Adding or renaming manuals, or changing the load path |
| `triage.py` | Triage prompt template for ambiguous queries in the `[OOD_FLOOR, CLASSIFY_THRESHOLD)` score band. LLM asks a clarifying question; TypeScript stores the returned category as a hint for the next turn. | Editing the triage question format or clarification strategy |
| `categories.py` | 32 category definitions + metadata (ID, description, KB source, priority level). Priority ordering (`PRIORITY_CRITICAL`, `PRIORITY_URGENT`) determines multi-label sort order. | Adding/removing categories or adjusting priority levels |
| `config.py` | **Central configuration** — all thresholds and paths in one place. `CLASSIFY_THRESHOLD`, `OOD_FLOOR`, `TIER0_MAX_WORDS`, `MULTI_LABEL_RATIO`, `MAX_PROMPT_TOKENS`, `TRIAGE_HINT_BOOST`, `TRIAGE_HINT_MIN_RELEVANCE`. Override via env vars (`OASIS_*`). | Tuning any pipeline parameter; checking what a constant value is |

---

## Offline Build Script

| File | Role |
|------|------|
| `build_centroids.py` | **Offline only — not part of the service.** Reads `data/prototypes.json`, embeds all prototype queries with gte-small, computes per-category centroids, saves `data/centroids.npy`. Re-run after editing `prototypes.json`, adding categories, or changing `EMBEDDING_MODEL`. |

---

## Data Files

| File | Role |
|------|------|
| `data/prototypes.json` | `{ category_id: [prototype_query, ...] }` — 15–30 queries per category. Input to `build_centroids.py`. |
| `data/centroids.npy` | **Build artifact.** `(33, 384)` float32 array — one 384-dim centroid per category (32 medical + `out_of_domain`). Never edit manually. |
| `data/short_queries.json` | Tier 0A — `{ normalized_query: category_id_or_response_text }` for word count ≤ 3. |
| `data/sentence_matches.json` | Tier 0B — `{ normalized_sentence: category_id_or_response_text }` for word count > 3. |
| `data/also_check_summaries.json` | Per-category curated one-liners for multi-label "ALSO CHECK" block. Human-written; never generated at runtime. |
| `data/manuals/*.txt` | 38 manual files, one per category. STEPS + NEVER DO format. 80–140 tokens each. Single source of medical protocol content. |

---

## Test Suite (`tests/`)

Run all tests: `cd python/oasis-classify && python -m pytest tests/`

| File | Role |
|------|------|
| `tests/test_fast_match.py` | Tier 0 — exact match, sentence match, word count guard, ASR normalization, edit-distance-1 tolerance. |
| `tests/test_classifier.py` | Tier 1 — category accuracy, OOD detection, triage band coverage, `top3` field correctness. |
| `tests/test_manuals.py` | Format validation — STEPS + NEVER DO both present, token count in 150–250 range. |
| `tests/test_integration.py` | End-to-end: all four dispatch modes, multi-label token ceiling, telemetry fields populated. |
| `tests/test_contract.py` | `/dispatch` response schema stability — ensures TypeScript contract never silently breaks. |
| `tests/test_adversarial.py` | Mixed-topic inputs, ASR noise, long nonsense, foreign language, canary recall (life-critical categories recall ≥ 0.95). |

---

## Training Utilities (`training/`)

Not part of the service. Used offline to improve classifier accuracy.

| File | Role |
|------|------|
| `training/generate_data.py` | Generates synthetic prototype queries for new or underperforming categories. |
| `training/train_classifier.py` | Trains/validates the centroid model on prototype data. |
| `training/calibrate_thresholds.py` | Sweeps `CLASSIFY_THRESHOLD` / `OOD_FLOOR` values and reports precision/recall tradeoffs. |
| `training/replay_harness.py` | Replays logged real queries against the classifier to measure production accuracy. |

---

## Dependency Map

```
service.py
  ├── fast_match.py        ← tier0_lookup, normalize, is_direct_response
  ├── classifier.py        ← classify, warmup, DispatchResult
  │     └── config.py      ← CLASSIFY_THRESHOLD, OOD_FLOOR, TRIAGE_HINT_BOOST, ...
  ├── prompt_builder.py    ← build_prompt, resolve_categories
  │     ├── manual_store.py ← ManualStore (loads data/manuals/)
  │     ├── categories.py  ← PRIORITY_CRITICAL, PRIORITY_URGENT
  │     └── config.py      ← MAX_PROMPT_TOKENS, MULTI_LABEL_RATIO
  └── triage.py            ← build_triage_prompt
```
