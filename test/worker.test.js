// Runs the real transcriber logic with a fake speech model to check labels, ordering and echo removal.
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');

const posted = [];
process.parentPort = { postMessage: (m) => posted.push(m), on: () => {} };
// Fake model: says something different depending on which track and which 30 s window it hears.
const fakeAsr = async (slice) => {
  const tag = slice[0];
  const said = {
    1: [{ text: 'Hi, can you send the slides?', timestamp: [2] }],
    2: [{ text: 'Sure, I will send them tonight.', timestamp: [5] }],
    3: [{ text: 'Hi, can you send the slides', timestamp: [2.5] }] // mic picking up the speakers
  }[tag] || [];
  return { text: said.map((c) => c.text).join(' '), chunks: said };
};
require.cache[require.resolve('@huggingface/transformers')] = {
  exports: { env: {}, pipeline: async () => fakeAsr }
};
const { dropEchoes } = require('../transcribe-worker');

function track(tags) {
  const SR = 16000; const a = new Float32Array(tags.length * 30 * SR);
  tags.forEach((tag, i) => { for (let j = 0; j < 30 * SR; j++) a[i * 30 * SR + j] = tag ? (j === 0 ? tag : Math.sin(j / 5) * 0.1) : 0; });
  const f = path.join(os.tmpdir(), `t${Math.random()}.pcm`); fs.writeFileSync(f, Buffer.from(a.buffer)); return f;
}

(async () => {
  // Me: window 0 = echo of Audio, window 1 = real reply. Audio: window 0 = question.
  const you = track([3, 2]); const others = track([1, 0]);
  process.parentPort.on = (ev, fn) => fn({ data: { job: 1, tracks: [{ label: 'Me', pcmFile: you }, { label: 'Audio', pcmFile: others }], model: 'x', cacheDir: os.tmpdir() } });
  delete require.cache[require.resolve('../transcribe-worker')];
  require('../transcribe-worker');
  await new Promise((r) => setTimeout(r, 300));
  const done = posted.find((m) => m.type === 'done');
  assert.ok(done, 'worker finished: ' + JSON.stringify(posted.filter((m) => m.type !== 'progress')));
  assert.equal(done.text, '[00:02] Audio: Hi, can you send the slides?\n[00:35] Me: Sure, I will send them tonight.');
  assert.equal(dropEchoes([{ t: 1, label: 'Me', text: 'totally different words here' }, { t: 1, label: 'Audio', text: 'hello there friend' }]).length, 2);
  console.log('worker tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
