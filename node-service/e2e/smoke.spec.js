// Browser smoke test for the Bengali frontend (src/index.html).
//
// Hermetic: no server, no API key, no network. Before the page's own script runs we
// inject mocks for the WebSocket, camera, Bengali SpeechRecognition, and MP3 decoding,
// then drive one full turn and assert the Bengali UI + streaming-playback path behave.
//
//   npm run test:e2e     (from node-service/)

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_URL = 'file://' + path.resolve(__dirname, '../../src/index.html');

// Runs in the page BEFORE index.html's <script>, replacing browser I/O with fakes.
function installMocks() {
  // ── Mock WebSocket ──
  class MockWS {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) {
      this.url = url;
      this.readyState = MockWS.OPEN;
      window.__ws = this;
      window.__sent = [];
      setTimeout(() => this.onopen && this.onopen(), 0);
    }
    send(data) { window.__sent.push(data); }
    close() { this.readyState = MockWS.CLOSED; } // don't fire onclose (avoids reconnect)
    __recv(obj) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }); }
  }
  window.WebSocket = MockWS;

  // ── Mock camera ──
  const fakeGUM = async () => new MediaStream();
  try {
    navigator.mediaDevices.getUserMedia = fakeGUM;
  } catch {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: fakeGUM }, configurable: true,
    });
  }

  // ── Mock Bengali speech recognition ──
  class MockSR {
    constructor() { window.__sr = this; }
    start() {} stop() { this.onend && this.onend(); } abort() {}
  }
  window.SpeechRecognition = MockSR;
  window.webkitSpeechRecognition = MockSR;

  // ── Stub MP3 decoding: don't decode fake bytes, just hand back a short buffer ──
  window.__decoded = 0;
  const AC = window.AudioContext || window.webkitAudioContext;
  AC.prototype.decodeAudioData = function () {
    window.__decoded++;
    return Promise.resolve(this.createBuffer(1, Math.round(this.sampleRate * 0.06), this.sampleRate));
  };
}

test('Bengali UI renders and a full turn drives through to audio playback', async ({ page }) => {
  await page.addInitScript(installMocks);
  // Keep it offline/deterministic: drop any external (font) requests.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

  await page.goto(INDEX_URL, { waitUntil: 'domcontentloaded' });

  // 1) Static Bengali UI
  await expect(page).toHaveTitle(/পার্লার/);
  await expect(page.locator('.logo h1')).toHaveText('পার্লার');
  await expect(page.locator('#cameraToggle')).toHaveText('ক্যামেরা চালু');

  // 2) After connect + init: listening + connected (both in Bengali)
  await expect(page.locator('#stateText')).toHaveText('শুনছি');
  await expect(page.locator('#status')).toHaveText('সংযুক্ত');

  // 3) Simulate a recognized Bengali utterance -> user bubble + sent over WS
  const USER_TEXT = 'তুমি কেমন আছো?';
  await page.evaluate((t) => {
    window.__sr.onresult({
      resultIndex: 0,
      results: [{ isFinal: true, length: 1, 0: { transcript: t } }],
    });
  }, USER_TEXT);

  await expect(page.locator('.msg.user')).toContainText(USER_TEXT);
  await expect(page.locator('#stateText')).toHaveText('ভাবছি…'); // processing
  const sent = await page.evaluate(() => window.__sent.map((s) => JSON.parse(s)));
  expect(sent.some((m) => m.text === USER_TEXT)).toBe(true);

  // 4) Server pushes the assistant reply
  const REPLY = 'আমি ভালো আছি। ধন্যবাদ জিজ্ঞেস করার জন্য।';
  await page.evaluate((r) => {
    window.__ws.__recv({ type: 'text', text: r, llm_time: 0.5 });
  }, REPLY);
  await expect(page.locator('.msg.assistant')).toContainText(REPLY);
  await expect(page.locator('.msg.assistant .meta')).toContainText('এআই');

  // 5) Server streams two audio chunks then ends -> both decoded, meta gets কণ্ঠ
  await page.evaluate(() => {
    const ws = window.__ws;
    ws.__recv({ type: 'audio_start', mime: 'audio/mpeg', sentence_count: 2 });
    ws.__recv({ type: 'audio_chunk', audio: btoa('chunk-zero'), index: 0 });
    ws.__recv({ type: 'audio_chunk', audio: btoa('chunk-one'), index: 1 });
    ws.__recv({ type: 'audio_end', tts_time: 1.0 });
  });

  await expect.poll(() => page.evaluate(() => window.__decoded)).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.msg.assistant .meta')).toContainText('কণ্ঠ');

  // 6) Playback finishes -> back to listening
  await expect(page.locator('#stateText')).toHaveText('শুনছি', { timeout: 10_000 });
});
