# Parlor(পার্লার) — Bengali Voice(বাংলা ভয়েস) + Vision AI(ভিশন এআই)

Real-time, natural **Bengali** voice-and-vision conversations in the browser. Talk to
it in Bangla, show it your camera, and it talks back in a natural Bengali voice.

> This is a localized + re-platformed fork of the original on-device Parlor. The UI,
> the assistant's language, and the whole model stack have been adapted for Bengali,
> and the on-device models have been swapped for free cloud services behind a small
> Node glue layer — so it runs on any machine, no GPU required.

## What changed from the original

The original ran everything on-device (Gemma via LiteRT-LM + Kokoro TTS on an Apple
GPU). Two hard blockers for Bengali: Kokoro has **no Bengali voice**, and the on-device
stack needs a specific GPU + a 2.6 GB model download. So the pipeline was re-shaped:

| Stage | Original (on-device) | Now |
| --- | --- | --- |
| 👂 Speech → text | Gemma audio encoder | **Browser Web Speech API** (Bengali `bn-BD`) |
| 🧠 Reply + vision | Gemma 4 E2B via LiteRT-LM | **Gemma 3** via Google AI Studio (free tier) |
| 🗣️ Text → speech | Kokoro (no Bengali) | **edge-tts** Bengali neural voice (`bn-BD-NabanitaNeural`) |
| Language | English | **Natural, conversational Bengali** everywhere |

## Architecture

```
Browser (Chrome)
  ├─ Web Speech API  →  Bengali speech → text (on-device, no key)
  ├─ Camera (JPEG frames)
  └─ WebSocket ───────────────┐
                              ▼
              Python FastAPI server (src/server.py)
              • WebSocket lifecycle, barge-in / interrupt
              • Bengali sentence splitting (danda-aware ।)
              • streams audio chunks back
                              │  HTTP
                              ▼
              Node glue service (node-service/)   ← the new code, in JS
              • POST /infer → Gemma 3 (Google AI Studio) → Bengali reply
              • POST /tts   → edge-tts → Bengali MP3
                              │
                              ▼
              Browser decodes MP3 (Web Audio API) and plays it
```

Two design choices worth calling out:

- **Python stays the browser-facing server** (adapted, not replaced): it keeps the
  WebSocket streaming, barge-in, and now Bengali-aware sentence splitting.
- **All new cloud integration lives in Node** (`node-service/`) — the Gemma proxy and
  the edge-tts voice — kept out of the Python on purpose.

## Requirements

- **Node.js 18+** and **Python 3.10+**
- **Google Chrome** (the Bengali speech recognition uses Chrome's Web Speech API)
- A free **Google AI Studio** API key — https://aistudio.google.com/apikey
  (edge-tts needs no key at all)

## Quick start

**1. Configure the key.** Copy `.env.example` and drop in your key:

```bash
cp .env.example node-service/.env
# edit node-service/.env and set GOOGLE_API_KEY=...
```

**2. Start the Node glue service** (Gemma + Bengali voice):

```bash
cd node-service
npm install
npm start          # → http://localhost:8100
```

**3. Start the Python server** (in another terminal):

```bash
cd src
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt      # or: uv sync
python server.py                     # → http://localhost:8000
```

**4. Open http://localhost:8000 in Chrome**, allow the mic and camera, and start
talking in Bengali. It replies by voice.

> **No API key yet?** It still runs end-to-end — the assistant will simply *say* (in
> Bengali) that the key isn't set. That confirms the whole speech → server → voice
> path works before you add the key.

## Configuration

All optional except the key. Set in `node-service/.env` (or repo-root `.env`).

| Variable | Default | Description |
| --- | --- | --- |
| `GOOGLE_API_KEY` | — | Google AI Studio key for Gemma (**required** for real replies) |
| `GEMMA_MODEL` | `gemma-3-27b-it` | Any vision-capable Gemma 3 (`-12b-it`, `-4b-it`) |
| `TTS_VOICE` | `bn-BD-NabanitaNeural` | edge-tts Bengali voice (also `bn-BD-PradeepNeural`, `bn-IN-TanishaaNeural`) |
| `NODE_SERVICE_PORT` | `8100` | Node glue service port |
| `NODE_SERVICE_URL` | `http://localhost:8100` | Where Python reaches the Node service |
| `PORT` | `8000` | Python server port |

## Project structure

Both sides use dependency injection: providers/gateways are built once at a
composition root and passed in, so every unit is reusable and testable in isolation.

```
src/                      # Python — browser-facing server
├── server.py             # FastAPI app + WebSocket orchestration (barge-in, streaming)
├── node_client.py        # NodeClient — gateway to the Node service (infer / synthesize)
├── text_utils.py         # pure helpers: Bengali sentence split, camera-context hints
├── config.py             # the only module that reads the environment
├── index.html            # Bengali UI + browser Bengali ASR + MP3 playback
├── requirements.txt      # light deps (no ML); pyproject.toml also works with uv
└── tests/                # pytest
node-service/             # NEW — the JS glue layer
├── server.js             # composition root: build config → services → app → listen
├── src/
│   ├── app.js            # createApp({gemma, tts}) — routes only, deps injected
│   ├── gemma.js          # createGemmaService(config) — reasoning provider
│   ├── tts.js            # createTtsService(config) — edge-tts voice provider
│   ├── prompt.js         # Bengali system prompt (written in Bengali for fluency)
│   ├── config.js         # createConfig(env) — single source of config
│   └── env.js            # dotenv bootstrap
├── test/                 # node:test (hermetic units + endpoints)
└── e2e/                  # Playwright browser smoke test
```

**Provider contracts (Open/Closed).** The app depends on two small shapes, so a
different backend can be dropped in without touching the orchestration:
- reasoning: `{ infer({text, image, context}) → {response, degraded?}, hasKey, modelName }`
- voice: `{ synthesize(text) → Buffer, voiceName, audioMime }`

## Performance

Sentences are synthesized **concurrently** (each `/tts` call opens its own edge-tts
session) while audio chunks are still delivered strictly in order — so total TTS
latency ≈ the slowest sentence instead of the sum. Measured on this machine:

| | Sequential (before) | Concurrent (now) |
| --- | --- | --- |
| 3-sentence synthesis | 2.56s | 1.37s |
| Full live turn (2 sentences, no-key path) | ~1.3–2.4s TTS | **~0.7–0.9s** |

The next big lever (not implemented): streaming the Gemma reply and starting TTS on
the first complete sentence, before the full response finishes generating.

## CI

`.github/workflows/ci.yml` runs on every push/PR — two parallel jobs, no secrets
needed (all suites are hermetic):

- **node** — `npm test` (unit/endpoint), then the Playwright browser smoke test
  (uploads traces as artifacts on failure)
- **python** — `pytest` for sentence splitting, the gateway, and the WebSocket protocol

## Tests

Both suites are hermetic — no API key, no network, no running servers needed.

```bash
# Node glue service (built-in node:test runner)
cd node-service && npm test

# Browser smoke test (Playwright — first run: npx playwright install chromium)
cd node-service && npm run test:e2e

# Python server (pytest + FastAPI TestClient)
cd src && pip install -r requirements-dev.txt && pytest
```

- **Node unit/endpoint** (`node-service/test/glue.test.js`): config defaults/overrides,
  Bengali prompt sanity, the Gemma service (no-key degrade **and** the success path via an
  injected fake client), and `/health` + `/infer` + `/tts` endpoints with stub providers.
  The one test that hits Microsoft's edge-tts servers is skipped unless `RUN_TTS_TEST=1`.
- **Browser smoke** (`node-service/e2e/smoke.spec.js`): loads the real `index.html` with
  the WebSocket, camera, Bengali speech recognition, and MP3 decoding mocked, then
  drives one full turn — asserting the Bengali UI renders, the recognized utterance is
  sent, the reply + timing meta appear, both audio chunks decode, and it returns to
  "শুনছি". No server or key needed.
- **Python** (`src/tests/test_server.py`): Bengali danda-aware sentence splitting and
  camera-context selection (text_utils), the `NodeClient` gateway against a mocked httpx
  transport, the full WebSocket protocol (`text → audio_start → audio_chunk* →
  audio_end`), and barge-in (mid-TTS interrupt suppresses audio, session keeps working)
  with a fake gateway injected.

## Notes & limitations

- **Chrome only** for now — Web Speech API Bengali recognition isn't in Firefox/Safari.
- Barge-in (interrupt by talking) works, with a short grace period to avoid the mic
  hearing the assistant's own voice. In a loud room echo can occasionally trip it.
- This is a research preview; expect rough edges.

## Acknowledgments

- [Gemma 3](https://ai.google.dev/gemma) by Google DeepMind, via Google AI Studio
- [edge-tts](https://github.com/rany2/edge-tts) / Microsoft neural Bengali voices
- Original Parlor by [fikrikarim](https://github.com/fikrikarim/parlor)

## License

[Apache 2.0](LICENSE)
