// Single source of truth for configuration.
//
// Only this module reads process.env, so the rest of the code depends on a plain
// config object instead of reaching into the environment (SRP + DIP). createConfig()
// takes an env map, which keeps it pure and reusable/testable with a custom env.

import './env.js'; // load .env into process.env before we read it

export function createConfig(env = process.env) {
  return Object.freeze({
    port: Number(env.NODE_SERVICE_PORT || 8100),
    gemma: Object.freeze({
      apiKey: env.GOOGLE_API_KEY || env.GEMINI_API_KEY || '',
      model: env.GEMMA_MODEL || 'gemma-4-31b-it',
    }),
    // Local fallback (Ollama) — used automatically when no cloud key is set.
    local: Object.freeze({
      model: env.LOCAL_MODEL || 'gemma3',
      host: env.OLLAMA_HOST || 'http://localhost:11434',
    }),
    tts: Object.freeze({
      voice: env.TTS_VOICE || 'bn-BD-NabanitaNeural',
    }),
  });
}

export const config = createConfig();
