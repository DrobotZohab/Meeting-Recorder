const {
  app, BrowserWindow, ipcMain, session, desktopCapturer, shell,
  systemPreferences, clipboard, protocol, net, safeStorage, utilityProcess, dialog
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { summarize } = require('./summarize');

// macOS: let Chromium capture system audio through ScreenCaptureKit (macOS 13+).
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch(
    'enable-features',
    'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride'
  );
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { stream: true, supportFetchAPI: true, standard: true, secure: true } }
]);

// ---------- paths & storage ----------
const ROOT = () => path.join(app.getPath('documents'), 'Meeting Recordings');
const SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');
const MODELS = () => path.join(app.getPath('userData'), 'models');
const ID_RE = /^[\w-]+$/;

const DEFAULT_SETTINGS = {
  consentMode: 'say',
  sayMessage: "Hey everyone, just a heads up: I'm recording this meeting so I can take notes. Let me know if anyone isn't okay with that.",
  chatMessage: "Heads up: I'm recording this meeting for notes. Let me know if you're not okay with that.",
  whisperModel: 'Xenova/whisper-base.en',
  claudeModel: 'claude-haiku-5-5',
  autoSummarize: true,
  apiKeyEnc: null
};

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function getSettings() { return { ...DEFAULT_SETTINGS, ...readJSON(SETTINGS(), {}) }; }
function getApiKey() {
  const s = getSettings();
  if (!s.apiKeyEnc) return null;
  try {
    const buf = Buffer.from(s.apiKeyEnc, 'base64');
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch { return null; }
}
function publicSettings() {
  const { apiKeyEnc, ...rest } = getSettings();
  return { ...rest, hasApiKey: !!apiKeyEnc };
}

const meetingDir = (id) => {
  if (!ID_RE.test(id)) throw new Error('Bad meeting id');
  return path.join(ROOT(), id);
};
const metaPath = (id) => path.join(meetingDir(id), 'meeting.json');
const audioPath = (id) => path.join(meetingDir(id), 'audio.webm');

function loadMeeting(id) { return readJSON(metaPath(id), null); }
function saveMeeting(m) { writeJSON(metaPath(m.id), m); notify('meeting-updated', m); return m; }
function patchMeeting(id, patch) {
  const m = loadMeeting(id);
  if (!m) return null;
  return saveMeeting({ ...m, ...patch });
}

function listMeetings() {
  if (!fs.existsSync(ROOT())) return [];
  return fs.readdirSync(ROOT())
    .filter((d) => ID_RE.test(d) && fs.existsSync(path.join(ROOT(), d, 'meeting.json')))
    .map((d) => loadMeeting(d))
    .filter(Boolean)
    .map(({ transcript, ...m }) => m) // keep the list light
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

function newId(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  let id = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  while (fs.existsSync(path.join(ROOT(), id))) id += 'x';
  return id;
}

// ---------- window ----------
let win = null;
function notify(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 540,
    title: 'Meetings',
    backgroundColor: '#ffffff',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('close', () => finishRecording());
}

// ---------- recording ----------
let rec = null; // { id, stream }

function finishRecording() {
  return new Promise((resolve) => {
    if (!rec) return resolve(null);
    const { id, stream, started } = rec;
    rec = null;
    stream.end(() => {
      const endedAt = new Date();
      const m = patchMeeting(id, {
        endedAt: endedAt.toISOString(),
        durationSec: Math.round((endedAt - started) / 1000),
        status: 'recorded'
      });
      resolve(m);
    });
  });
}

// Meetings left in "recording"/"processing" by a crash get marked recoverable.
function recoverStale() {
  for (const m of listMeetings()) {
    if (m.status === 'recording') {
      const full = loadMeeting(m.id);
      const size = fs.existsSync(audioPath(m.id)) ? fs.statSync(audioPath(m.id)).size : 0;
      saveMeeting({ ...full, status: size ? 'recorded' : 'error', error: size ? null : 'Recording was interrupted.' });
    } else if (m.status === 'transcribing' || m.status === 'summarizing') {
      saveMeeting({ ...loadMeeting(m.id), status: 'recorded' });
    }
  }
}

// ---------- transcription (local Whisper in a background process) ----------
let worker = null;
const pending = new Map();
let jobSeq = 0;

function getWorker() {
  if (worker) return worker;
  worker = utilityProcess.fork(path.join(__dirname, 'transcribe-worker.js'), [], { serviceName: 'Transcriber' });
  worker.on('message', (msg) => {
    const job = pending.get(msg.job);
    if (!job) return;
    if (msg.type === 'progress') job.onProgress(msg);
    if (msg.type === 'done') { pending.delete(msg.job); job.resolve(msg.text); }
    if (msg.type === 'error') { pending.delete(msg.job); job.reject(new Error(msg.message)); }
  });
  worker.on('exit', () => {
    worker = null;
    for (const [, job] of pending) job.reject(new Error('Transcriber stopped unexpectedly.'));
    pending.clear();
  });
  return worker;
}

function transcribe(pcmFile, onProgress) {
  return new Promise((resolve, reject) => {
    const job = ++jobSeq;
    pending.set(job, { resolve, reject, onProgress });
    getWorker().postMessage({
      job, pcmFile, model: getSettings().whisperModel, cacheDir: MODELS()
    });
  });
}

const processing = new Set();
async function processMeeting(id, pcm) {
  if (processing.has(id)) return loadMeeting(id);
  processing.add(id);
  const pcmFile = path.join(meetingDir(id), 'audio.pcm');
  try {
    // 1) transcript
    let m = loadMeeting(id);
    if (pcm) {
      fs.writeFileSync(pcmFile, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
      saveMeeting({ ...m, status: 'transcribing', error: null });
      const text = await transcribe(pcmFile, (p) => notify('progress', { id, ...p }));
      m = saveMeeting({ ...loadMeeting(id), transcript: text });
    }
    m = loadMeeting(id);
    if (!m.transcript || !m.transcript.trim()) {
      return saveMeeting({ ...m, status: 'error', error: 'No speech was found in the recording.' });
    }

    // 2) summary
    const key = getApiKey();
    if (!key) return saveMeeting({ ...m, status: 'transcribed', error: null });
    saveMeeting({ ...m, status: 'summarizing', error: null });
    notify('progress', { id, stage: 'summarizing' });
    const out = await summarize({
      apiKey: key,
      model: getSettings().claudeModel,
      transcript: m.transcript,
      startedAt: m.startedAt,
      durationSec: m.durationSec
    });
    const cur = loadMeeting(id);
    return saveMeeting({
      ...cur,
      title: cur.titleEdited ? cur.title : (out.title || cur.title),
      summary: out.summary,
      summarizedAt: new Date().toISOString(),
      status: 'done',
      error: null
    });
  } catch (err) {
    console.error(err);
    const cur = loadMeeting(id);
    return saveMeeting({ ...cur, status: cur.transcript ? 'transcribed' : 'recorded', error: err.message });
  } finally {
    processing.delete(id);
    fs.rmSync(pcmFile, { force: true });
  }
}

// ---------- app ----------
app.whenReady().then(() => {
  protocol.handle('media', (req) => {
    const u = new URL(req.url);
    const id = decodeURIComponent(u.pathname.replace(/^\//, ''));
    try {
      const file = audioPath(id);
      if (!fs.existsSync(file)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString(), { headers: req.headers })
        .catch(() => new Response('Not found', { status: 404 }));
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      callback({ video: sources[0], audio: 'loopback' });
    } catch (err) {
      console.error(err);
      callback({});
    }
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'display-capture', 'clipboard-sanitized-write'].includes(permission));
  });

  ipcMain.handle('platform', () => process.platform);
  ipcMain.handle('ask-mic', async () => {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.askForMediaAccess('microphone');
  });

  ipcMain.handle('meetings:list', () => listMeetings());
  ipcMain.handle('meetings:get', (_e, id) => loadMeeting(id));
  ipcMain.handle('meetings:rename', (_e, id, title) =>
    patchMeeting(id, { title: String(title || '').slice(0, 200) || 'Untitled meeting', titleEdited: true }));
  ipcMain.handle('meetings:delete', async (_e, id) => {
    const r = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Move to Trash', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Delete this meeting?', detail: 'The recording, transcript and summary go to the Trash.'
    });
    if (r.response !== 0) return false;
    await shell.trashItem(meetingDir(id));
    return true;
  });
  ipcMain.handle('meetings:show', (_e, id) => shell.showItemInFolder(audioPath(id)));
  ipcMain.handle('meetings:process', (_e, id, pcm) => processMeeting(id, pcm || null));

  ipcMain.handle('rec:start', async () => {
    await finishRecording();
    const started = new Date();
    const id = newId(started);
    fs.mkdirSync(meetingDir(id), { recursive: true });
    saveMeeting({
      id,
      title: 'Untitled meeting',
      startedAt: started.toISOString(),
      endedAt: null,
      durationSec: 0,
      status: 'recording',
      summary: null,
      transcript: null,
      error: null
    });
    rec = { id, started, stream: fs.createWriteStream(audioPath(id)) };
    return loadMeeting(id);
  });
  ipcMain.handle('rec:chunk', (_e, bytes) => new Promise((resolve, reject) => {
    if (!rec) return resolve();
    rec.stream.write(Buffer.from(bytes), (err) => (err ? reject(err) : resolve()));
  }));
  ipcMain.handle('rec:stop', () => finishRecording());

  ipcMain.handle('settings:get', () => publicSettings());
  ipcMain.handle('settings:set', (_e, patch) => {
    const s = getSettings();
    const allowed = ['consentMode', 'sayMessage', 'chatMessage', 'whisperModel', 'claudeModel', 'autoSummarize'];
    for (const k of allowed) if (k in patch) s[k] = patch[k];
    if ('apiKey' in patch) {
      const key = String(patch.apiKey || '').trim();
      s.apiKeyEnc = !key ? null
        : (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key)).toString('base64');
    }
    writeJSON(SETTINGS(), s);
    return publicSettings();
  });
  ipcMain.handle('copy', (_e, text) => clipboard.writeText(String(text)));
  ipcMain.handle('open-folder', () => {
    fs.mkdirSync(ROOT(), { recursive: true });
    return shell.openPath(ROOT());
  });
  ipcMain.handle('open-url', (_e, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });

  fs.mkdirSync(ROOT(), { recursive: true });
  recoverStale();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { if (worker) worker.kill(); });
