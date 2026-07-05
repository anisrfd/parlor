// Tests for the Node glue service. Built-in node:test runner: `npm test`.
//
// Fully hermetic — no API key, no network. Because the services are factory-built and
// dependency-injected, we construct them directly with stub clients and compose the
// app ourselves, exercising real logic (including the Gemma success path) offline.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createConfig } from '../src/config.js';
import { createGemmaService } from '../src/gemma.js';
import { createTtsService } from '../src/tts.js';
import { createApp } from '../src/app.js';
import { SYSTEM_PROMPT, NO_KEY_MESSAGE, ERROR_MESSAGE } from '../src/prompt.js';

const hasBengali = (s) => /[ঀ-৿]/.test(s); // Bengali Unicode block

describe('config', () => {
  test('defaults apply and custom env overrides', () => {
    const def = createConfig({});
    assert.equal(def.gemma.model, 'gemma-4-31b-it');
    assert.equal(def.tts.voice, 'bn-BD-NabanitaNeural');
    assert.equal(def.gemma.apiKey, '');

    const custom = createConfig({ GOOGLE_API_KEY: 'k', GEMMA_MODEL: 'gemma-3-4b-it', TTS_VOICE: 'bn-BD-PradeepNeural' });
    assert.equal(custom.gemma.apiKey, 'k');
    assert.equal(custom.gemma.model, 'gemma-3-4b-it');
    assert.equal(custom.tts.voice, 'bn-BD-PradeepNeural');
  });
});

describe('prompt', () => {
  test('system prompt and fallbacks are non-empty Bengali', () => {
    for (const s of [SYSTEM_PROMPT, NO_KEY_MESSAGE, ERROR_MESSAGE]) {
      assert.ok(s && s.trim().length > 0);
      assert.ok(hasBengali(s));
    }
    assert.match(SYSTEM_PROMPT, /বাংলা/);
    assert.match(NO_KEY_MESSAGE, /GOOGLE_API_KEY/);
  });
});

describe('gemma service', () => {
  test('no key → Bengali degraded message, no crash', async () => {
    const gemma = createGemmaService({ apiKey: '' });
    assert.equal(gemma.hasKey, false);
    const { response, degraded } = await gemma.infer({ text: 'হ্যালো' });
    assert.equal(degraded, true);
    assert.match(response, /GOOGLE_API_KEY/);
  });

  test('success path: forwards the model reply (injected client)', async () => {
    const seen = {};
    const fakeClient = {
      models: {
        generateContent: async (req) => {
          seen.req = req;
          return { text: 'আমি ভালো আছি।' };
        },
      },
    };
    const gemma = createGemmaService({ apiKey: '', model: 'gemma-3-4b-it', client: fakeClient });
    const { response, degraded } = await gemma.infer({ text: 'কেমন আছো?', image: 'BASE64', context: 'ctx' });
    assert.equal(response, 'আমি ভালো আছি।');
    assert.equal(degraded, undefined);
    // Prompt + context + image were assembled into the request.
    const parts = seen.req.contents[0].parts;
    assert.match(parts[0].text, /বাংলা/);
    assert.match(parts[0].text, /ctx/);
    assert.equal(parts[1].inlineData.mimeType, 'image/jpeg');
  });
});

describe('HTTP endpoints (stub providers)', () => {
  let base, server;
  const gemmaStub = {
    modelName: 'gemma-test', hasKey: false,
    infer: async ({ text }) => ({ response: `উত্তর: ${text}`, degraded: true }),
  };
  const ttsStub = {
    voiceName: 'bn-BD-NabanitaNeural', audioMime: 'audio/mpeg',
    synthesize: async () => Buffer.from([0xff, 0xf3, 0x01, 0x02]),
  };

  before(async () => {
    const app = createApp({ gemma: gemmaStub, tts: ttsStub });
    server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((resolve) => server.close(resolve)));

  test('GET /health reports config', async () => {
    const body = await (await fetch(`${base}/health`)).json();
    assert.equal(body.ok, true);
    assert.equal(body.model, 'gemma-test');
    assert.equal(body.voice, 'bn-BD-NabanitaNeural');
    assert.equal(body.keyConfigured, false);
  });

  test('POST /infer returns the provider response', async () => {
    const res = await fetch(`${base}/infer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'হ্যালো' }),
    });
    const body = await res.json();
    assert.equal(body.response, 'উত্তর: হ্যালো');
  });

  test('POST /tts returns audio/mpeg bytes', async () => {
    const res = await fetch(`${base}/tts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'আজকের দিনটা সুন্দর।' }),
    });
    assert.equal(res.headers.get('content-type'), 'audio/mpeg');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf[0], 0xff); // MP3 frame sync
  });
});

describe('edge-tts integration (network)', () => {
  test('synthesizes real Bengali MP3', { skip: !process.env.RUN_TTS_TEST }, async () => {
    const tts = createTtsService({ voice: 'bn-BD-NabanitaNeural' });
    const buf = await tts.synthesize('আজকের দিনটা সুন্দর।');
    assert.ok(buf.length > 1000);
    assert.equal(buf[0], 0xff);
  });
});
