// Composition root for the Parlor glue service.
//
// The single place that wires configuration to concrete providers and starts the
// process. Everything it uses is built elsewhere and injected here, so the whole
// system is reusable without this file (see tests, which compose their own).
//
//   POST /infer  { text, image? }  -> { response }   (Gemma: cloud or local fallback)
//   POST /tts    { text }          -> audio/mpeg      (edge-tts Bengali voice)
//   GET  /health                   -> { ok, ... }

import { config } from './src/config.js';
import { createGemmaService } from './src/gemma.js';
import { createOllamaService } from './src/ollama.js';
import { createLiteRtService } from './src/litert.js';
import { createTtsService } from './src/tts.js';
import { createApp } from './src/app.js';

// Local fallback engine, chosen by LOCAL_BACKEND. Unknown values fall back to Ollama.
function createLocalReasoner(local) {
  switch (local.backend) {
    case 'litert':
      return createLiteRtService(local.litert);
    case 'ollama':
      return createOllamaService(local.ollama);
    default:
      console.warn(`Unknown LOCAL_BACKEND "${local.backend}" — using ollama`);
      return createOllamaService(local.ollama);
  }
}

// Cloud Gemma when a key is present; otherwise a local backend (Ollama or LiteRT-LM).
const usingCloud = Boolean(config.gemma.apiKey);
const gemma = usingCloud
  ? createGemmaService(config.gemma)
  : createLocalReasoner(config.local);
const tts = createTtsService(config.tts);
const app = createApp({ gemma, tts });

// Only listen when run directly (`node server.js`), not when imported.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  app.listen(config.port, () => {
    console.log(`Parlor glue service on http://localhost:${config.port}`);
    console.log(`  Reasoning   : ${gemma.modelName}  (${usingCloud ? 'Google AI Studio — cloud' : 'local fallback — set GOOGLE_API_KEY to use cloud'})`);
    console.log(`  TTS voice   : ${tts.voiceName}  (edge-tts, no key needed)`);
  });
}

export { app };
