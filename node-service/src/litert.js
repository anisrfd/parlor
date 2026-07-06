// Local Gemma via LiteRT-LM — the fallback backend that mirrors Parlor's *original*
// on-device stack (Gemma-4 E2B/E4B `.litertlm` on Metal GPU; see artifacts/05-*.md).
//
// LiteRT-LM is a native C++ engine with no built-in REST server, so this provider
// targets a thin HTTP shim in front of it (the C++ httplib server the architecture doc
// describes) exposing:
//
//   POST {host}/generate
//     { prompt: string, image?: base64, max_tokens: number, temperature: number }
//   -> { text: string }            // also accepts { response } for convenience
//
// It satisfies the same "reasoning provider" contract as the cloud and Ollama backends
//   { infer({text, image, context}) -> {response, degraded?}, hasKey, provider, modelName }
// so the composition root swaps it in purely by config — nothing downstream changes.

import { composeUserPrompt, ERROR_MESSAGE } from './prompt.js';

/**
 * @param {object}   opts
 * @param {string}   opts.model       Model label for logs/health (e.g. 'gemma-4-e2b-it')
 * @param {string}   opts.host        LiteRT-LM HTTP shim base URL
 * @param {number}  [opts.timeoutMs]  Per-request generation timeout (on-device decode can
 *                                     be slow on first token, but an unbounded fetch would
 *                                     hang the voice turn)
 * @param {Function}[opts.fetchImpl]  Inject a fake fetch for tests
 */
export function createLiteRtService({
  model = 'gemma-4-e2b-it',
  host = 'http://localhost:8110',
  timeoutMs = 60000,
  fetchImpl = fetch,
} = {}) {
  const base = host.replace(/\/+$/, '');

  async function infer({ text, image, context } = {}) {
    const body = {
      prompt: composeUserPrompt({ text, context }),
      max_tokens: 220,
      temperature: 0.8,
    };
    if (image) body.image = image; // base64 JPEG; the engine is natively multimodal

    try {
      const res = await fetchImpl(`${base}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        throw new Error(`litert ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const data = await res.json();
      const reply = (data.text ?? data.response ?? '').trim();
      return reply ? { response: reply } : { response: ERROR_MESSAGE, degraded: true };
    } catch (err) {
      // LiteRT-LM shim not running, model not loaded, or the timeout fired — degrade to
      // a spoken Bengali error rather than throwing and breaking the turn.
      console.error(`[litert] ${err?.message || err}`);
      return { response: ERROR_MESSAGE, degraded: true };
    }
  }

  return { infer, hasKey: false, provider: 'local', modelName: `${model} (local via LiteRT-LM)` };
}
