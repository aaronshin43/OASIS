# O.A.S.I.S. Architecture

Detailed architecture reference for the classify pipeline, dispatch modes, Flask API, manual format, and TypeScript bridge.

---

## 1. Classify Dispatch Pipeline

`service.py` orchestrates the full dispatch on every query. Two fast-path tiers run before the embedding model is touched.

```
User Query (raw ASR text)
  │
  ▼  normalize()  — lowercase, strip punctuation, collapse whitespace
  │
  ▼
┌──────────────────────────────────────────────────┐
│  Tier 0A: Short Query Dict Lookup                 │
│  word count ≤ 3 → short_queries.json             │
│  edit-distance-1 tolerance for ASR noise          │
│  → direct_response text OR category_id           │
└───────────────────┬──────────────────────────────┘
        no match    │ match → build prompt / return response
                    ▼
┌──────────────────────────────────────────────────┐
│  Tier 0B: Sentence Match Dict Lookup              │
│  word count > 3 → sentence_matches.json          │
│  → direct_response text OR category_id           │
└───────────────────┬──────────────────────────────┘
        no match    │ match → build prompt / return response
                    ▼
┌──────────────────────────────────────────────────┐
│  Tier 1: Centroid Classifier                      │
│  gte-small (384-dim) embed → cosine to centroids  │
│  33 centroids: 32 medical + out_of_domain         │
│  Apply prev_triage_hint boost if active           │
└───────────────────┬──────────────────────────────┘
                    │
         ┌──────────┴──────────────┐
         ▼                         ▼
  score < OOD_FLOOR (0.30)   out_of_domain cluster best
  → ood_response              → ood_response
         │
         ▼
  0.30 ≤ score < 0.65
  → triage_prompt  (LLM asks clarifying question)
         │
         ▼
  score ≥ 0.65
  → manual lookup → build_prompt() → llm_prompt
```

**Prompt size target:** ~200–350 tokens total (vs ~500–800 in a typical RAG approach).

---

## 2. Four Dispatch Modes

Every `/dispatch` response has one of four `mode` values. The TypeScript layer acts on this field directly.

| Mode | Trigger | TypeScript behavior |
|------|---------|---------------------|
| `direct_response` | Tier 0 returned a canned response text | Speak `response_text` via TTS. No LLM call. Clear triage hint. |
| `llm_prompt` | Classifier hit (score ≥ 0.65) or Tier 0 category match | Send `system_prompt` → LLM → TTS. Clear triage hint. |
| `triage_prompt` | Score in [0.30, 0.65) — ambiguous query | Send `system_prompt` → LLM → TTS. Store `category` as triage hint with 60s TTL. |
| `ood_response` | score < 0.30, OOD cluster, empty query, or network failure | Speak `response_text` via TTS. No LLM call. Clear triage hint. |

---

## 3. Triage Hint System

Allows multi-turn context without session state on the Python side. The service is stateless.

```
Turn 1: "I cut myself"
  → score = 0.45 (triage band)
  → mode = triage_prompt, category = "bleeding"
  → TypeScript stores { category: "bleeding", expiresAt: now + 60s }

Turn 2: "there's a lot of blood" (sent with prev_triage_hint="bleeding")
  → Python applies TRIAGE_HINT_BOOST (+0.05) to "bleeding" centroid score
  → score may cross CLASSIFY_THRESHOLD → mode = llm_prompt
  → TypeScript clears triage hint
```

**Rules:**
- TTL is **60 seconds** — managed entirely by TypeScript (`ChatFlow.ts`)
- Python checks `TRIAGE_HINT_MIN_RELEVANCE (0.20)` — if the new query has cosine similarity < 0.20 to the hint category, the boost is skipped (topic shift detection)
- `hint_changed_result: true` in the response means the hint actually changed the dispatch outcome
- Do not inspect query text in TypeScript to decide whether to send the hint — pass it blindly; Python handles topic shift

---

## 4. Multi-Label Dispatch

When a second category scores ≥ `primary_score × MULTI_LABEL_RATIO (0.80)`, both are included in the prompt.

```
prompt_builder.py
  ├── primary manual (full STEPS + NEVER DO)
  └── secondary: one-liner from also_check_summaries.json
      prefixed with "ALSO CHECK: [Category] — [one-liner]"

Hard ceiling: MAX_PROMPT_TOKENS = 400 (tiktoken cl100k_base)
Max categories: 2 (MAX_CATEGORIES)
```

Priority ordering for multi-label sort:
```python
PRIORITY_CRITICAL = ["cpr", "choking", "bleeding"]
PRIORITY_URGENT   = ["anaphylaxis", "electric_shock", "poisoning", "drowning"]
# All others: ordered by classifier score
```

---

## 5. Manual Format

Every file in `data/manuals/` must follow this exact format:

```
Category: [Human-readable name]

STEPS:
1. [First and most critical action].
2. [Second action].
...

NEVER DO:
- Do NOT [common myth or dangerous mistake].
- Do NOT [another dangerous action].
```

- Plain text only — no markdown. The 1b LLM copies markdown formatting if it sees it.
- 80–140 tokens per manual.
- STEPS and NEVER DO sections are both required.
- Content distilled from source documents — never invented.

**Rebuild required after editing manuals:** None — `manual_store.py` reloads from disk on service restart.

---

## 6. Flask API Reference

Base URL: `http://localhost:5002`

### GET /health

```bash
curl http://localhost:5002/health
```

Response:
```json
{ "status": "ok", "service": "oasis-classify", "port": 5002 }
```

### POST /dispatch

```bash
curl -X POST http://localhost:5002/dispatch \
  -H "Content-Type: application/json" \
  -d '{"query": "my friend is bleeding from the leg"}'
```

Request body:
```json
{
  "query": "my friend is bleeding from the leg",
  "prev_triage_hint": "bleeding"    // optional — category from previous triage turn
}
```

Response:
```json
{
  "mode":               "llm_prompt",
  "response_text":      null,
  "system_prompt":      "You are OASIS...\n\nSTEPS:\n1. Apply direct pressure...",
  "category":           null,
  "top3":               [{"category": "bleeding", "score": 0.81}, ...],
  "score":              0.81,
  "threshold_path":     "classifier_hit",
  "latency_ms":         42.3,
  "hint_changed_result": false
}
```

**`threshold_path` values (server-side):**

| Value | Meaning |
|-------|---------|
| `tier0_short` | Matched in `short_queries.json` (word count ≤ 3) |
| `tier0_sentence` | Matched in `sentence_matches.json` (word count > 3) |
| `classifier_hit` | Tier 1 score ≥ CLASSIFY_THRESHOLD |
| `triage` | Tier 1 score in triage band |
| `ood_floor` | Tier 1 score < OOD_FLOOR |
| `ood_cluster` | `out_of_domain` centroid was top hit |

**`threshold_path` values (client-synthesized, TypeScript only):**

| Value | Meaning |
|-------|---------|
| `network_error` | Service unreachable or timeout |
| `service_error` | Non-2xx HTTP response |
| `invalid_schema` | Response did not match expected schema |

---

## 7. TypeScript Bridge

```
ChatFlow.ts
  └── OasisAdapter.dispatchQuery(query, triageHint)
        └── oasis-classify-client.dispatch()   POST :5002/dispatch (15s timeout)
              │
              ├── mode = direct_response  → partial(responseText) → endPartial()
              ├── mode = ood_response     → partial(responseText) → endPartial()
              ├── mode = llm_prompt       → chatWithLLMStream(systemPrompt, query)
              └── mode = triage_prompt    → chatWithLLMStream(systemPrompt, query)
                                            + store triageHint in ChatFlow
```

`oasis-classify-client.ts` exports:
- `dispatch(query, prevTriageHint)` — always resolves; returns safe `ood_response` fallback on any failure
- `classifyHealth()` — health check, returns null on failure
- `isClassifyReady()` — boolean convenience wrapper

On network failure the client returns:
```json
{
  "mode": "ood_response",
  "response_text": "I am a first-aid assistant. If this is an emergency, call emergency services.",
  "threshold_path": "network_error"
}
```

---

## 8. Build Artifacts

| Artifact | Location | Regenerate with |
|----------|----------|----------------|
| Centroid array | `python/oasis-classify/data/centroids.npy` | `cd python/oasis-classify && python build_centroids.py` |

**Rebuild required after:**
- Editing `data/prototypes.json`
- Adding/removing categories in `categories.py`
- Changing `EMBEDDING_MODEL` in `config.py`

**No rebuild needed for:**
- Editing `data/manuals/*.txt`
- Changing thresholds (`CLASSIFY_THRESHOLD`, `OOD_FLOOR`, etc.) in `config.py`
- Editing `data/short_queries.json` or `data/sentence_matches.json`
