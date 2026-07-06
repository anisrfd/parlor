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
import { createLocalGemmaService } from './src/localGemma.js';
import { createTtsService } from './src/tts.js';
import { createApp } from './src/app.js';

// Cloud Gemma when a key is present; otherwise fall back to a local model (Ollama).
const usingCloud = Boolean(config.gemma.apiKey);
const gemma = usingCloud
  ? createGemmaService(config.gemma)
  : createLocalGemmaService(config.local);
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
