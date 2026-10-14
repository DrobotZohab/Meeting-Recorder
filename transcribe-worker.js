// Runs in an Electron utility process so transcription never freezes the window.
// Input: a file of raw 16 kHz mono Float32 samples. Output: timestamped transcript text.
const fs = require('fs');

const SR = 16000;
const WINDOW = 30 * SR; // Whisper works on 30-second windows
let transformers = null;
const pipes = new Map();

async function getPipe(model, cacheDir, post) {
  if (!transformers) transformers = require('@huggingface/transformers');
  transformers.env.cacheDir = cacheDir;
  transformers.env.allowLocalModels = false;
  if (pipes.has(model)) return pipes.get(model);
  post({ type: 'progress', stage: 'loading', pct: 0 });
  const pipe = await transformers.pipeline('automatic-speech-recognition', model, {
    dtype: 'q8',
    progress_callback: (p) => {
      if (p.status === 'progress' && typeof p.progress === 'number') {
        post({ type: 'progress', stage: 'downloading', pct: Math.round(p.progress), file: p.file });
      }
    }
  });
  pipes.set(model, pipe);
  return pipe;
}

function rms(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length));
}

const ts = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  const p = (n) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${p(Math.floor(s / 60))}:${p(s % 60)}`;
};

// Whisper's classic hallucinations on near-silence.
const JUNK = /^(\s*(thank you\.?|thanks for watching\.?|you|\.|\[.*?\]|\(.*?\))\s*)$/i;

async function run({ job, pcmFile, model, cacheDir }) {
  const post = (msg) => process.parentPort.postMessage({ job, ...msg });
  try {
    const buf = fs.readFileSync(pcmFile);
    const audio = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const asr = await getPipe(model, cacheDir, post);

    const lines = [];
    const total = Math.ceil(audio.length / WINDOW);
    for (let i = 0; i < total; i++) {
      const start = i * WINDOW;
      const slice = audio.subarray(start, Math.min(audio.length, start + WINDOW));
      post({ type: 'progress', stage: 'transcribing', pct: Math.round((i / total) * 100) });
      if (slice.length < SR / 2 || rms(slice) < 0.004) continue; // skip silence
      const out = await asr(slice, { return_timestamps: true });
      const chunks = out.chunks && out.chunks.length ? out.chunks : [{ text: out.text, timestamp: [0] }];
      for (const c of chunks) {
        const text = (c.text || '').trim();
        if (!text || JUNK.test(text)) continue;
        lines.push(`[${ts(start / SR + (c.timestamp?.[0] || 0))}] ${text}`);
      }
    }
    post({ type: 'progress', stage: 'transcribing', pct: 100 });
    post({ type: 'done', text: lines.join('\n') });
  } catch (err) {
    const offline = /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(err.message);
    post({
      type: 'error',
      message: offline
        ? "Couldn't download the speech model. Check your internet and try again (it only downloads once)."
        : `Transcription failed: ${err.message}`
    });
  }
}

// Jobs run one at a time.
let queue = Promise.resolve();
process.parentPort.on('message', (e) => { queue = queue.then(() => run(e.data)); });
