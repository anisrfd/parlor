// HTTP surface for the glue service. Pure of configuration and construction: it
// receives its providers (reasoning + voice) and only wires them to routes, so the
// same app can be built with real services, stubs, or alternative providers.

import express from 'express';

/**
 * @param {object} deps
 * @param {{infer: Function, hasKey: boolean, provider: string, modelName: string}} deps.gemma
 * @param {{synthesize: Function, voiceName: string, audioMime: string}} deps.tts
 */
export function createApp({ gemma, tts }) {
  const app = express();
  app.use(express.json({ limit: '12mb' })); // camera frames arrive as base64 JPEG

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      model: gemma.modelName,
      provider: gemma.provider, // 'cloud' | 'local' — which reasoning backend is active
      voice: tts.voiceName,
      keyConfigured: gemma.hasKey, // whether a cloud API key is set (false in local mode)
    });
  });

  // Bengali reply (with optional camera frame) from the reasoning provider.
  app.post('/infer', async (req, res) => {
    const { text = '', image, context } = req.body || {};
    try {
      res.json(await gemma.infer({ text, image, context }));
    } catch (err) {
      console.error(`[/infer] ${err?.message || err}`);
      res.status(500).json({ error: 'infer_failed' });
    }
  });

  // Bengali speech for one sentence/chunk from the voice provider.
  app.post('/tts', async (req, res) => {
    const { text = '' } = req.body || {};
    try {
      const audio = await tts.synthesize(text);
      res.set('Content-Type', tts.audioMime);
      res.send(audio);
    } catch (err) {
      console.error(`[/tts] ${err?.message || err}`);
      res.status(500).json({ error: 'tts_failed' });
    }
  });

  return app;
}
