# O.A.S.I.S.

**Offline AI System for Immediate Survivial** — a fully offline emergency first-aid voice assistant running on Raspberry Pi 5 + Whisplay HAT.

Press the button, speak your emergency, and get evidence-based first-aid guidance — no internet required.

---

## How It Works

```
Voice Input (Whisper STT)
  → Intent Classifier (Python :5002)   — medical intent + severity triage
  → RAG Pipeline     (Python :5001)    — 3-stage hybrid retrieval from first-aid manuals
      Stage 1: Medical keyword lexical filter  (inverted index, top-50)
      Stage 2: Hybrid re-ranking               (cosine 0.6 + BM25 0.4, top-4)
      Stage 3: Context compression             (sentence-level pruning, 20–40% token reduction)
  → LLM (gemma3:1b via Ollama)
  → Voice Output (Piper TTS)
```

**Knowledge base:** WHO Basic Emergency Care 2018 + Red Cross Wilderness First Aid — 317 chunks, validated across 109 test cases.

---

## Hardware

- Raspberry Pi 5 (8 GB RAM recommended)
- PiSugar Whisplay HAT (LCD, speaker, microphone)
- PiSugar 3 battery

---

## Installation

```bash
# 1. Install audio drivers
# Follow: https://github.com/PiSugar/whisplay

# 2. Clone and install dependencies
git clone <repo-url>
cd oasis
bash install_dependencies.sh
source ~/.bashrc

# 3. Configure environment
cp .env.template .env
# Edit .env with your settings

# 4. Build TypeScript layer
bash build.sh

# 5. Build knowledge index
bash index_knowledge.sh
```

---

## Running

```bash
ollama serve                              # Start LLM (gemma3:1b)
cd python/oasis-rag && python app.py      # RAG service      :5001
cd python/oasis-classify && python app.py # Classifier service :5002
bash run_chatbot.sh                       # Node.js chatbot layer
```

To start on boot (headless):
```bash
sudo bash startup.sh
```

---

## Project Structure

| Path | Description |
|------|-------------|
| `src/core/ChatFlow.ts` | Main loop: button → STT → backend → LLM → TTS |
| `src/core/OasisAdapter.ts` | Backend result → LLM system prompt (fallback chain) |
| `python/oasis-rag/` | 3-Stage Hybrid RAG pipeline (FAISS + gte-small) |
| `python/oasis-classify/` | Medical intent classifier + pre-generated manual dispatch |
| `data/knowledge/` | Validated first-aid source documents |
| `docs/` | Architecture, testing, roadmap, and decisions |

---

## Running Tests

```bash
cd python/oasis-rag && python validation/run_all.py
```

---

## Rebuilding After Changes

```bash
bash build.sh           # TypeScript
bash index_knowledge.sh # Knowledge index (after adding documents to data/knowledge/)
```

---

## License

[GPL-3.0](LICENSE)
