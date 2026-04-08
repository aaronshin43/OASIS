# Testing Guide

Tests are split across two layers.

| Layer | Scope | Runner |
|-------|-------|--------|
| Classify pipeline | Unit, integration, contract, adversarial | `python -m pytest tests/` |
| LLM integration | Real LLM response quality | manual (requires Ollama) |

---

## Layer 1: Classify Pipeline Tests

**Requires:** Python only — no Flask server, no Ollama.

```bash
cd python/oasis-classify && python -m pytest tests/
```

---

### test_fast_match.py — Tier 0

Tests `fast_match.py` in isolation. No embedding model required.

| What is tested |
|----------------|
| Exact match in `short_queries.json` (≤ 3 words) |
| Exact match in `sentence_matches.json` (> 3 words) |
| Word count guard — keyword match not applied to full sentences |
| ASR normalization — punctuation stripping, case folding, whitespace collapse |
| Edit-distance-1 tolerance for short tokens (e.g. "bleding" → "bleeding") |
| `is_direct_response()` distinguishes canned text from category IDs |

---

### test_classifier.py — Tier 1

Tests `classifier.py` centroid scoring. Requires `data/centroids.npy`.

| What is tested |
|----------------|
| Life-critical category accuracy (cpr, choking, bleeding, anaphylaxis, ...) |
| OOD detection — non-medical queries land in `out_of_domain` cluster or below `OOD_FLOOR` |
| Triage band coverage — ambiguous queries score in `[OOD_FLOOR, CLASSIFY_THRESHOLD)` |
| `top3` field is always a list of `{"category": str, "score": float}` objects |
| `prev_triage_hint` boost increases score for matching category |
| `hint_changed_result` is `True` when boost changed the dispatch outcome |

---

### test_manuals.py — Manual format validation

Tests that every file in `data/manuals/` is correctly formatted.

| What is tested |
|----------------|
| STEPS section present and non-empty |
| NEVER DO section present and non-empty |
| Token count in 150–250 range (via tiktoken) |
| No markdown characters (`*`, `#`, `` ` ``) |

---

### test_integration.py — End-to-end dispatch

Tests the full `dispatch()` function (same code path as the Flask endpoint). Requires `data/centroids.npy` and `data/manuals/`.

| What is tested |
|----------------|
| `direct_response` mode returns `response_text`, null `system_prompt` |
| `llm_prompt` mode returns non-empty `system_prompt`, null `response_text` |
| `triage_prompt` mode returns `system_prompt` and `category` |
| `ood_response` mode returns `response_text`, null `system_prompt` |
| Multi-label prompt stays within `MAX_PROMPT_TOKENS (400)` ceiling |
| All telemetry fields present: `latency_ms`, `score`, `top3`, `threshold_path`, `hint_changed_result` |

---

### test_contract.py — TypeScript schema contract

Tests that the `/dispatch` response shape never silently changes in a way that would break the TypeScript client.

| What is tested |
|----------------|
| All required fields present in every mode (`mode`, `response_text`, `system_prompt`, `category`, `top3`, `score`, `threshold_path`, `latency_ms`, `hint_changed_result`) |
| `top3` entries are dicts with `category` (str) and `score` (float), not tuples |
| `mode` is one of the four known string values |
| `threshold_path` is a non-empty string |

---

### test_adversarial.py — Robustness

| What is tested |
|----------------|
| Mixed-topic inputs (medical + non-medical in same sentence) |
| Heavy ASR noise (missing words, wrong homophones) |
| Long nonsense input (> 100 words) does not crash |
| Foreign language queries return `ood_response` |
| Canary recall — life-critical categories (cpr, choking, bleeding, anaphylaxis) recall ≥ 0.95 on known-good query set |

---

## Layer 2: LLM Integration (manual)

**Requires:** Ollama running + classify service running.

```bash
# Start classify service
cd python/oasis-classify && python service.py

# Then in another terminal, send a test query
curl -X POST http://localhost:5002/dispatch \
  -H "Content-Type: application/json" \
  -d '{"query": "my friend collapsed and is not breathing"}'

# Pipe the system_prompt to Ollama manually for response quality check
```

No automated LLM test suite currently exists for the classify pipeline. The classify service only produces the system prompt — LLM response quality validation is performed manually or via the GUI.

---

## Running a single test file

```bash
cd python/oasis-classify

# Single file
python -m pytest tests/test_classifier.py -v

# Single test
python -m pytest tests/test_integration.py::test_llm_prompt_mode -v

# With output
python -m pytest tests/ -v -s
```

---

## Smoke test

Quick manual verification after any change:

```bash
# Service health
curl http://localhost:5002/health

# Life-critical query
curl -X POST http://localhost:5002/dispatch \
  -H "Content-Type: application/json" \
  -d '{"query": "person not breathing"}'

# OOD query
curl -X POST http://localhost:5002/dispatch \
  -H "Content-Type: application/json" \
  -d '{"query": "what is the weather today"}'
```

Expected:
- Life-critical → `mode: "llm_prompt"`, `threshold_path: "classifier_hit"`, `score >= 0.65`
- OOD → `mode: "ood_response"`, `threshold_path: "ood_floor"` or `"ood_cluster"`
