// Composition root for the Parlor glue service.
//
// The single place that wires configuration to concrete providers and starts the
// process. Everything it uses is built elsewhere and injected here, so the whole
// system is reusable without this file (see tests, which compose their own).
//
//   POST /infer  { text, image? }  -> { response }   (Gemma via Google AI Studio)
//   POST /tts    { text }          -> audio/mpeg      (edge-tts Bengali voice)
//   GET  /health                   -> { ok, ... }

import { config } from './src/config.js';
import { createGemmaService } from './src/gemma.js';
import { createTtsService } from './src/tts.js';
import { createApp } from './src/app.js';

const gemma = createGemmaService(config.gemma);
const tts = createTtsService(config.tts);
const app = createApp({ gemma, tts });

// Only listen when run directly (`node server.js`), not when imported.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  app.listen(config.port, () => {
    console.log(`Parlor glue service on http://localhost:${config.port}`);
    console.log(`  Gemma model : ${gemma.modelName}  (API key ${gemma.hasKey ? 'configured' : 'MISSING — replies will prompt for GOOGLE_API_KEY'})`);
    console.log(`  TTS voice   : ${tts.voiceName}  (edge-tts, no key needed)`);
  });
}

export { app };
