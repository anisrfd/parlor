// Local Gemma fallback — runs a Gemma model on the user's own machine via Ollama.
//
// Satisfies the same "reasoning provider" contract as gemma.js
//   { infer({text, image, context}) -> {response, degraded?}, hasKey, modelName }
// so the composition root can swap it in whenever no cloud GOOGLE_API_KEY is set. No
// key, no network egress — everything stays on the machine.
//
// Requires Ollama (https://ollama.com) running with the model pulled once:
//   ollama pull gemma3
// Unlike the cloud Gemma-4 models, Ollama's gemma3 doesn't burn a hidden "thinking"
// budget, so a modest num_predict is enough for the visible reply.

import { SYSTEM_PROMPT, ERROR_MESSAGE } from './prompt.js';

/**
 * @param {object}   opts
 * @param {string}   opts.model      Ollama model tag (e.g. 'gemma3', 'gemma3:12b')
 * @param {string}   opts.host       Ollama base URL
 * @param {Function} [opts.fetchImpl] Inject a fake fetch for tests
 */
export function createLocalGemmaService({
  model = 'gemma3',
  host = 'http://localhost:11434',
  fetchImpl = fetch,
} = {}) {
  const base = host.replace(/\/+$/, '');

  // Gemma has no system role, so the system prompt is prepended to the user turn.
  function buildPrompt({ text, context }) {
    const lead = [SYSTEM_PROMPT];
    if (context) lead.push(context);
    lead.push(`ব্যবহারকারী বলেছে: "${text || ''}"`);
    return lead.join('\n\n');
  }

  async function infer({ text, image, context } = {}) {
    const body = {
      model,
      prompt: buildPrompt({ text, context }),
      stream: false,
      options: { temperature: 0.8, num_predict: 220 },
    };
    if (image) body.images = [image]; // base64 JPEG, no data: prefix

    try {
      const res = await fetchImpl(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const data = await res.json();
      const reply = (data.response || '').trim();
      return reply ? { response: reply } : { response: ERROR_MESSAGE, degraded: true };
    } catch (err) {
      // Most likely Ollama isn't running or the model hasn't been pulled.
      console.error(`[local-gemma] ${err?.message || err}`);
      return { response: ERROR_MESSAGE, degraded: true };
    }
  }

  return { infer, hasKey: true, modelName: `${model} (local via Ollama)` };
}
