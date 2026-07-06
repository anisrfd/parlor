// Local Gemma via Ollama — one of two no-key fallback backends (see litert.js for the
// other). Runs a Gemma model on the user's own machine through Ollama's HTTP daemon.
//
// Satisfies the shared "reasoning provider" contract
//   { infer({text, image, context}) -> {response, degraded?}, hasKey, provider, modelName }
// so the composition root can swap it in whenever no cloud GOOGLE_API_KEY is set. No
// key, no network egress — everything stays on the machine.
//
// Requires Ollama (https://ollama.com) running with the model pulled once:
//   ollama pull gemma3
// Unlike the cloud Gemma-4 models, Ollama's gemma3 doesn't burn a hidden "thinking"
// budget, so a modest num_predict is enough for the visible reply.

import { composeUserPrompt, ERROR_MESSAGE } from './prompt.js';

/**
 * @param {object}   opts
 * @param {string}   opts.model       Ollama model tag (e.g. 'gemma3', 'gemma3:12b')
 * @param {string}   opts.host        Ollama base URL
 * @param {number}  [opts.timeoutMs]  Per-request generation timeout (local models can
 *                                     be slow, but an unbounded fetch would hang the turn)
 * @param {Function}[opts.fetchImpl]  Inject a fake fetch for tests
 */
export function createOllamaService({
  model = 'gemma3',
  host = 'http://localhost:11434',
  timeoutMs = 60000,
  fetchImpl = fetch,
} = {}) {
  const base = host.replace(/\/+$/, '');

  async function infer({ text, image, context } = {}) {
    const body = {
      model,
      prompt: composeUserPrompt({ text, context }),
      stream: false,
      options: { temperature: 0.8, num_predict: 220 },
    };
    if (image) body.images = [image]; // base64 JPEG, no data: prefix

    try {
      const res = await fetchImpl(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const data = await res.json();
      const reply = (data.response || '').trim();
      return reply ? { response: reply } : { response: ERROR_MESSAGE, degraded: true };
    } catch (err) {
      // Ollama not running, model not pulled, or the timeout fired — degrade to a
      // spoken Bengali error rather than throwing and breaking the turn.
      console.error(`[ollama] ${err?.message || err}`);
      return { response: ERROR_MESSAGE, degraded: true };
    }
  }

  // hasKey reflects a *cloud* key, so it's false here; `provider` tells health/startup
  // that reasoning is nonetheless available via a local backend.
  return { infer, hasKey: false, provider: 'local', modelName: `${model} (local via Ollama)` };
}
