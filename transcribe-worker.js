// Runs in an Electron utility process so transcription never freezes the window.
// Input: one or more tracks of raw 16 kHz mono Float32 samples, each with an optional
// speaker label ("Me" = your mic, "Audio" = computer audio). Output: timestamped text.
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

const words = (t) => new Set(t.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter((w) => w.length > 1));
function similar(a, b) {
  const A = words(a); const B = words(b);
  if (!A.size || !B.size) return false;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size) >= 0.6;
}

// On speakers, the mic also hears the computer audio. Drop "Me" lines that just echo an "Audio" line.
function dropEchoes(segs) {
  const others = segs.filter((s) => s.label === 'Audio');
  return segs.filter((s) => s.label !== 'Me' ||
    !others.some((o) => Math.abs(o.t - s.t) <= 4 && similar(o.text, s.text)));
}

async function run({ job, tracks, model, cacheDir }) {
  const post = (msg) => process.parentPort.postMessage({ job, ...msg });
  try {
    const audio = tracks.map((t) => {
      const buf = fs.readFileSync(t.pcmFile);
      return { label: t.label || null, data: new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) };
    });
    const asr = await getPipe(model, cacheDir, post);

    const total = audio.reduce((n, a) => n + Math.ceil(a.data.length / WINDOW), 0);
    let done = 0;
    const segs = [];
    for (const { label, data } of audio) {
      for (let start = 0; start < data.length; start += WINDOW) {
        post({ type: 'progress', stage: 'transcribing', pct: Math.round((done++ / total) * 100) });
        const slice = data.subarray(start, Math.min(data.length, start + WINDOW));
        if (slice.length < SR / 2 || rms(slice) < 0.004) continue; // skip silence
        const out = await asr(slice, { return_timestamps: true });
        const chunks = out.chunks && out.chunks.length ? out.chunks : [{ text: out.text, timestamp: [0] }];
        for (const c of chunks) {
          const text = (c.text || '').trim();
          if (!text || JUNK.test(text)) continue;
          segs.push({ t: start / SR + (c.timestamp?.[0] || 0), label, text });
        }
      }
    }

    const lines = dropEchoes(segs)
      .sort((a, b) => a.t - b.t)
      .map((s) => `[${ts(s.t)}] ${s.label ? `${s.label}: ` : ''}${s.text}`);
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
if (process.parentPort) process.parentPort.on('message', (e) => { queue = queue.then(() => run(e.data)); });

module.exports = { dropEchoes, similar }; // for tests
