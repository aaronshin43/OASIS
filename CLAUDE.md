# CLAUDE.md

This file provides top-level guidance for Claude Code when working in this repository.
For subsystem-specific rules, navigate to the relevant subfolder — each has its own CLAUDE.md.

---

## Critical Rules

- **All code, comments, and commit messages must be written in English.**
- **Never generate medical advice directly** — only reference validated manuals from `python/oasis-classify/data/manuals/`.
- **Pi5 memory budget: total pipeline ≤ 4.5 GB** — do not introduce models or dependencies that exceed this.
- **Do not modify `data/centroids.npy`** — it is a build artifact; regenerate via `python build_centroids.py`.

---

## Project Overview

**O.A.S.I.S.** (Offline AI Survival & first-aid kIt System) — fully offline emergency first-aid assistant running on Raspberry Pi 5 + Whisplay HAT.

**Stack:** Whisper STT → oasis-classify (:5002) → gemma3:1b (Ollama) → Piper TTS, orchestrated by a Node.js + TypeScript chatbot layer.

**Python backend:**

| Folder | Purpose | Port | CLAUDE.md |
|--------|---------|------|-----------|
| `python/oasis-classify/` | Medical intent classifier + pre-generated manual dispatch | :5002 | [`python/oasis-classify/CLAUDE.md`](python/oasis-classify/CLAUDE.md) |

---

## TypeScript Layer Entry Points

| File | Role |
|------|------|
| `src/core/ChatFlow.ts` | Main loop: button → STT → classify → LLM → TTS |
| `src/core/OasisAdapter.ts` | Classify result → LLM system prompt + safe fallback |
| `src/cloud-api/server.ts` | ASR/LLM/TTS provider router (reads `.env`) |
| `src/cloud-api/local/oasis-classify-client.ts` | Classify HTTP client (:5002) |

New ASR/LLM/TTS providers go in `src/cloud-api/local/` or a named subfolder — never in `server.ts` directly.

---

## Build

```bash
bash build.sh  # TypeScript: rm -rf dist && tsc
```

---

## Reference Docs

| File | Read when... |
|------|-------------|
| `docs/architecture.md` | Modifying the classify pipeline, dispatch modes, Flask API, or manual format |
| `docs/testing.md` | Writing or debugging tests; looking up test IDs |
| `docs/roadmap.md` | Investigating known bugs, planning phases, or choosing an LLM upgrade |
| `docs/decisions.md` | Before changing classifier thresholds, LLM, or dispatch strategy |
| `docs/entrypoints.md` | Looking up what any file in `python/oasis-classify/` does |
