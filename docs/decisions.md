# Architectural Decisions

Key decisions made during O.A.S.I.S. development. Each entry records what was decided, why, and what alternatives were rejected.

---

## DEC-001: oasis-classify over oasis-rag

**Decision:** Replace the 3-Stage Hybrid RAG pipeline (FAISS + gte-small, port 5001) with the centroid-based intent classifier + pre-generated manual dispatch (port 5002).

**Rejected alternative:** Keep oasis-rag as the primary pipeline.

**Why classify:**
- **Latency:** RAG pipeline required ~400–800ms on Pi5 for embedding + FAISS search + compression. Classify Tier 0 resolves in ~0ms (dict lookup); Tier 1 in ~10–100ms (single centroid cosine).
- **Prompt size:** RAG produced 500–800 token prompts from compressed context chunks. Classify produces 200–350 token prompts from pre-written manuals, reducing LLM TTFT from ~16s to ~3–6s on Pi5.
- **Reliability:** RAG required FAISS index to be built and loaded (~374 chunks, ~67MB model). Classify requires only `centroids.npy` (33 × 384 float32, < 1MB) and plain text manuals.
- **Medical accuracy:** Pre-written manuals (STEPS + NEVER DO) are human-reviewed and follow a fixed format, eliminating the risk of the LLM receiving poorly compressed or off-topic RAG chunks.

---

## DEC-002: Tier 0 fast path (dict lookup before embedding)

**Decision:** Before calling gte-small, attempt zero-latency dict lookups in `short_queries.json` (≤ 3 words) and `sentence_matches.json` (> 3 words).

**Why:** Common emergency phrases ("cpr", "she's choking", "someone is bleeding") are highly predictable in ASR output. A dict lookup resolves these in ~0ms with no GPU/CPU cost, ensuring the fastest possible path for the most critical queries.

**Guard:** Tier 0A is restricted to queries ≤ 3 words (`TIER0_MAX_WORDS`) to prevent false positives from keyword-only matching on full sentences.

---

## DEC-003: Stateless service + TypeScript-managed triage hint TTL

**Decision:** The Python classify service is fully stateless. Multi-turn triage context (hint) is held in TypeScript (`ChatFlow.ts`) with a 60-second TTL and passed as `prev_triage_hint` on each `/dispatch` call.

**Rejected:** Session state in Python (e.g., server-side conversation memory).

**Why stateless:** The service runs on Pi5 and may be restarted at any time. Stateless design eliminates stale session bugs, simplifies testing, and allows multiple TypeScript clients without coordination. The 60s TTL matches the realistic window in which a follow-up question relates to the previous triage turn.

---

## DEC-004: Two-threshold scoring band (OOD_FLOOR + CLASSIFY_THRESHOLD)

**Decision:** Use two separate score thresholds with distinct semantics:
- `OOD_FLOOR = 0.30` — below this, return OOD response immediately (query has no medical relevance)
- `CLASSIFY_THRESHOLD = 0.65` — above this, treat as a confident category match and build a prompt

The band `[0.30, 0.65)` triggers triage — the LLM asks a clarifying question.

**Why two thresholds:** The OOD floor and the confidence threshold represent different decisions. Merging them would either produce triage prompts for obviously non-medical queries or skip triage for genuinely ambiguous medical queries.

---

## DEC-005: Pre-written manuals as sole medical content source

**Decision:** All medical protocol content lives in `data/manuals/*.txt` (STEPS + NEVER DO format, 80–140 tokens each). The LLM prompt contains only the manual text + query — no retrieved chunks, no summarization.

**Rejected:** Dynamic context from retrieved document chunks (RAG approach).

**Why:** Pre-written manuals are human-reviewed, format-controlled, and sized to fit the 1b LLM's context window reliably. Dynamic retrieval introduces the risk of off-topic chunks, compression artifacts, and variable prompt length. For the 32 well-defined emergency categories covered by this system, pre-written manuals are more reliable than retrieval.

---

## DEC-006: tiktoken for token counting (not transformers.AutoTokenizer)

**Decision:** `prompt_builder.py` uses `tiktoken` (cl100k_base) to enforce the `MAX_PROMPT_TOKENS = 400` ceiling, not `transformers.AutoTokenizer`.

**Why:** `transformers.AutoTokenizer` requires loading a full tokenizer model (~50–200MB). On Pi5, loading it in a hot path adds unacceptable memory and latency overhead. `tiktoken` is ~1MB, pure Python, and fast enough for runtime enforcement. The token counts are slightly different from the LLM's actual tokenizer, but the 400-token ceiling has enough headroom to absorb the difference.

---

## DEC-007: LLM — gemma3:1b (current), upgrade path planned

**Decision:** Current LLM is `gemma3:1b` via Ollama.

**Context:** Model evaluation on 35 LLM response tests (2026-03-15):

| Model | Critical pass | CPR | Pi5 latency est. | RAM |
|-------|:---:|:---:|:---:|:---:|
| qwen3.5:0.8b | 95.2% | **100%** | ~64s | 1.0 GB |
| gemma3:1b | 85.7% | **0%** | ~62s | 0.8 GB |
| gemma3:4b Q4 | higher | high | ~8–12s | 3.0 GB |
| phi-4-mini Q4 | high | high | ~7–10s | 2.8 GB |

**Note:** Upgrade to `phi-4-mini Q4` or `gemma3:4b Q4` is planned pending Pi5 memory profiling. With classify reducing prompt size to ~200–350 tokens, the LLM handles shorter context and latency estimates may improve.

---

## DEC-008: gte-small as embedding model

**Decision:** Use `thenlper/gte-small` (384-dim, ~67MB) for both centroid computation (`build_centroids.py`) and Tier 1 query embedding (`classifier.py`).

**Rejected alternatives:**
- `all-MiniLM-L6-v2` — lower accuracy on medical query clustering in internal tests
- `mxbai-embed-large` — 670MB RAM; exceeds Pi5 memory budget when running concurrently with Ollama

**Why gte-small:** Best accuracy/size tradeoff for medical intent clustering. First run downloads ~67MB; after that fully offline.
