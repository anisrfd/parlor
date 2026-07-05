// Bengali text-to-speech service via edge-tts (Microsoft neural voices).
//
// Factory-built for the same reasons as the reasoning service: no module-level env
// read, easy to construct with a different voice or to stub in tests. Implements the
// "voice provider" contract:  { synthesize(text) -> Buffer, voiceName, audioMime }.
//
// Output is MP3 (this edge-tts build exposes no raw-PCM format); the browser decodes
// it with AudioContext.decodeAudioData, so no server-side audio decoding is needed.

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
const AUDIO_MIME = 'audio/mpeg';

/**
 * @param {object}   opts
 * @param {string}   opts.voice        edge-tts Bengali voice id
 * @param {number}  [opts.timeoutMs]   per-request synthesis timeout
 * @param {function}[opts.createClient] injectable factory for a fresh MsEdgeTTS (tests)
 */
export function createTtsService({
  voice = 'bn-BD-NabanitaNeural',
  timeoutMs = 20000,
  createClient = () => new MsEdgeTTS(),
} = {}) {
  /**
   * Synthesize one chunk of Bengali text to an MP3 Buffer. A fresh client per call
   * keeps the socket lifecycle simple and avoids state bleeding across concurrent
   * sentences.
   * @param {string} text
   * @returns {Promise<Buffer>}
   */
  async function synthesize(text) {
    const clean = (text || '').trim();
    if (!clean) return Buffer.alloc(0);

    const tts = createClient();
    await tts.setMetadata(voice, FORMAT);
    const { audioStream } = await tts.toStream(clean);

    return await new Promise((resolve, reject) => {
      const chunks = [];
      audioStream.on('data', (c) => chunks.push(c));
      audioStream.on('end', () => resolve(Buffer.concat(chunks)));
      audioStream.on('error', reject);
      setTimeout(() => reject(new Error('edge-tts timeout')), timeoutMs);
    });
  }

  return { synthesize, voiceName: voice, audioMime: AUDIO_MIME };
}
