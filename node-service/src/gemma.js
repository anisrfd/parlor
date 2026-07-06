// Gemma reasoning service (Google AI Studio, free tier).
//
// Exposed as a factory so it can be constructed with explicit config or a stubbed
// client — no hidden dependency on process.env or a module-level singleton. This is
// the concrete implementation of the "reasoning provider" contract that the HTTP app
// depends on:  { infer({text, image, context}) -> {response, degraded?}, hasKey, modelName }
// A different provider (OpenRouter, a local model, …) can satisfy the same shape.

import { GoogleGenAI } from '@google/genai';
import { composeUserPrompt, NO_KEY_MESSAGE, ERROR_MESSAGE } from './prompt.js';

/**
 * @param {object}  opts
 * @param {string}  opts.apiKey   Google AI Studio key ('' → degraded, no-network mode)
 * @param {string}  opts.model    Gemma model id
 * @param {object} [opts.client]  Inject a fake { models.generateContent } for tests
 */
export function createGemmaService({ apiKey = '', model = 'gemma-4-31b-it', client } = {}) {
  const genai = client || (apiKey ? new GoogleGenAI({ apiKey }) : null);
  const hasKey = Boolean(apiKey);

  // The SDK wants structured parts; the prompt text is shared with the local backends.
  function buildContents({ text, image, context }) {
    const parts = [{ text: composeUserPrompt({ text, context }) }];
    if (image) parts.push({ inlineData: { mimeType: 'image/jpeg', data: image } });
    return [{ role: 'user', parts }];
  }

  async function generate(contents) {
    const res = await genai.models.generateContent({
      model,
      contents,
      // Gemma-4 is a reasoning model: it spends ~350 tokens "thinking" before the
      // visible reply, and the budget must cover BOTH or res.text comes back empty.
      // (Thinking cannot be disabled on these models — 400 "not supported".)
      config: { temperature: 0.8, maxOutputTokens: 640 },
    });
    return (res.text || '').trim();
  }

  async function infer({ text, image, context } = {}) {
    if (!genai) return { response: NO_KEY_MESSAGE, degraded: true };

    try {
      const reply = await generate(buildContents({ text, image, context }));
      if (reply) return { response: reply };
      // Empty completion — retry once without the image in case vision tripped it up.
      if (image) {
        const retry = await generate(buildContents({ text, context }));
        if (retry) return { response: retry };
      }
      return { response: ERROR_MESSAGE, degraded: true };
    } catch (err) {
      const msg = String(err?.message || err);
      console.error(`[gemma] ${msg}`);
      // Some Gemma variants reject image input — degrade gracefully to text-only.
      if (image && /image|inline|vision|modal|unsupported|not support/i.test(msg)) {
        try {
          const retry = await generate(buildContents({ text, context }));
          if (retry) return { response: retry };
        } catch (err2) {
          console.error(`[gemma] text-only retry failed: ${err2?.message || err2}`);
        }
      }
      return { response: ERROR_MESSAGE, degraded: true };
    }
  }

  return { infer, hasKey, provider: 'cloud', modelName: model };
}
