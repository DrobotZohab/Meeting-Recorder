/* global api, renderMarkdown */
const $ = (sel, root = document) => root.querySelector(sel);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICON = {
  mic: '<svg viewBox="0 0 16 16"><rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5"/><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5V14.5"/></svg>',
  cal: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3"/></svg>',
  clock: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>',
  timer: '<svg viewBox="0 0 16 16"><circle cx="8" cy="9" r="5.5"/><path d="M8 6v3M6 1.5h4"/></svg>',
  status: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor"/></svg>',
  speaker: '<svg viewBox="0 0 16 16"><path d="M2 6v4h3l4 3V3L5 6zM11.5 5.5a3.5 3.5 0 0 1 0 5"/></svg>',
  chat: '<svg viewBox="0 0 16 16"><path d="M2.5 3h11v8H6l-3.5 2.5z"/></svg>',
  more: '<svg viewBox="0 0 16 16"><circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/></svg>',
  chev: '<svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4"/></svg>',
  copy: '<svg viewBox="0 0 16 16"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/></svg>',
  redo: '<svg viewBox="0 0 16 16"><path d="M13 3v4H9"/><path d="M13 7A5.5 5.5 0 1 0 12 11"/></svg>',
  wave: '<svg viewBox="0 0 16 16"><path d="M2 8h1.5M5 5v6M8 2.5v11M11 5v6M12.5 8H14"/></svg>',
  folder: '<svg viewBox="0 0 16 16"><path d="M2 4.5h4l1.5 1.5H14v6.5H2z"/></svg>',
  trash: '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9"/></svg>',
  alert: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11h0"/></svg>',
  key: '<svg viewBox="0 0 16 16"><circle cx="5.5" cy="10.5" r="3"/><path d="M7.7 8.3 13.5 2.5M11.5 4.5l1.5 1.5"/></svg>'
};

const state = {
  meetings: [],
  current: null,        // null = new meeting page, otherwise meeting id
  meeting: null,        // full meeting object for current page
  settings: {},
  query: '',
  progress: {},         // id -> { stage, pct }
  rec: null             // active recording
};

const pref = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
};

// ---------- formatting ----------
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
function fmtDate(iso) {
  const d = new Date(iso);
  const diff = Math.round((dayStart(new Date()) - dayStart(d)) / 864e5);
  const full = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (diff === 0) return `Today, ${d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`;
  if (diff === 1) return `Yesterday, ${d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`;
  return full;
}
const fmtFullDate = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  if (sec < 60) return `${sec} sec`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr ${m % 60} min`;
}
function clock(sec) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(sec / 3600))}:${p(Math.floor(sec / 60) % 60)}:${p(Math.floor(sec % 60))}`;
}
function groupName(iso) {
  const diff = Math.round((dayStart(new Date()) - dayStart(new Date(iso))) / 864e5);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'Previous 7 days';
  if (diff < 30) return 'Previous 30 days';
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 1800);
}

// ---------- sidebar ----------
function renderNav() {
  const nav = $('#nav');
  const q = state.query.trim().toLowerCase();
  const items = state.meetings.filter((m) =>
    !q || (m.title || '').toLowerCase().includes(q) || (m.summary || '').toLowerCase().includes(q));
  nav.innerHTML = '';
  if (!items.length) {
    nav.append(h(`<div class="empty-nav">${q ? 'No matches.' : 'No meetings yet.'}</div>`));
    return;
  }
  let last = null;
  for (const m of items) {
    const g = groupName(m.startedAt);
    if (g !== last) { nav.append(h(`<div class="group">${esc(g)}</div>`)); last = g; }
    const live = state.rec && state.rec.id === m.id;
    const el = h(`<div class="item${m.id === state.current ? ' active' : ''}" title="${esc(m.title)}">
      ${live ? '<span class="live-dot"></span>' : ''}
      <span class="t">${esc(m.title || 'Untitled meeting')}</span>
      <span class="time">${esc(fmtTime(m.startedAt))}</span>
    </div>`);
    el.addEventListener('click', () => open(m.id));
    nav.append(el);
  }
}

async function refreshList() {
  state.meetings = await api.list();
  renderNav();
}

// ---------- status ----------
function statusTag(m) {
  const p = state.progress[m.id];
  if (state.rec && state.rec.id === m.id) return '<span class="tag red"><span class="live-dot"></span>Recording</span>';
  switch (m.status) {
    case 'transcribing': {
      const label = p?.stage === 'downloading' ? `Downloading model ${p.pct ?? 0}%`
        : p?.stage === 'loading' ? 'Loading model' : p?.stage === 'preparing' ? 'Preparing audio'
          : `Transcribing ${p?.pct ?? 0}%`;
      return `<span class="tag blue"><span class="spinner"></span>${label}</span>`;
    }
    case 'summarizing': return '<span class="tag blue"><span class="spinner"></span>Summarizing</span>';
    case 'done': return '<span class="tag green">Summarized</span>';
    case 'transcribed': return '<span class="tag yellow">Transcribed</span>';
    case 'recorded': return '<span class="tag gray">Recorded</span>';
    case 'error': return '<span class="tag red">Error</span>';
    default: return '<span class="tag gray">Not started</span>';
  }
}

// ---------- page: new meeting ----------
function renderNewPage() {
  const s = state.settings;
  const mode = s.consentMode || 'say';
  $('#crumb').textContent = 'New meeting';
  $('#topActions').innerHTML = '';
  const page = $('#page');
  page.innerHTML = `
    <div class="page-icon">${ICON.mic}</div>
    <h1 class="title" data-placeholder="New meeting"></h1>
    <div class="props">
      <div class="prop-k">${ICON.cal}Date</div><div class="prop-v">${esc(fmtDate(new Date().toISOString()))}</div>
      <div class="prop-k">${ICON.clock}Time</div><div class="prop-v dim">Starts when you record</div>
      <div class="prop-k">${ICON.status}Status</div><div class="prop-v"><span class="tag gray">Not started</span></div>
      <div class="prop-k">${ICON.mic}Microphone</div><div class="prop-v"><select id="micSel"><option value="">Loading...</option></select></div>
      <div class="prop-k">${ICON.speaker}Other people</div>
      <div class="prop-v"><input type="checkbox" id="sysToggle" class="switch"><span class="dim" id="sysLabel"></span></div>
    </div>

    <div class="callout">
      ${ICON.chat}
      <div class="body">
        <div class="head">
          <strong>Let people know you're recording</strong>
          <div class="seg">
            <button data-mode="say" class="${mode === 'say' ? 'on' : ''}">Say it out loud</button>
            <button data-mode="chat" class="${mode === 'chat' ? 'on' : ''}">Paste in chat</button>
          </div>
        </div>
        <textarea id="consentMsg" rows="2" spellcheck="false"></textarea>
        <div class="head">
          <label class="check"><input type="checkbox" id="consentBox"><span class="box"></span>Everyone knows this meeting is being recorded</label>
          <button id="copyMsg" class="text-btn"${mode === 'chat' ? '' : ' hidden'}>Copy message</button>
        </div>
      </div>
    </div>

    <div class="recbar">
      <div class="time" id="recTime">00:00:00</div>
      <div class="hint" id="recHint">Check the box above to start.</div>
      <button class="rec-btn" id="recBtn" disabled><span class="dot"></span>Start recording</button>
    </div>`;

  const msg = $('#consentMsg');
  const syncMsg = () => {
    const m = state.settings.consentMode || 'say';
    msg.value = m === 'say' ? state.settings.sayMessage : state.settings.chatMessage;
    msg.style.height = 'auto'; msg.style.height = msg.scrollHeight + 'px';
    $('#copyMsg').hidden = m !== 'chat';
    page.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  };
  syncMsg();
  page.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', async () => {
    state.settings = await api.setSettings({ consentMode: b.dataset.mode });
    syncMsg();
  }));
  msg.addEventListener('input', () => { msg.style.height = 'auto'; msg.style.height = msg.scrollHeight + 'px'; });
  msg.addEventListener('change', async () => {
    const key = state.settings.consentMode === 'chat' ? 'chatMessage' : 'sayMessage';
    state.settings = await api.setSettings({ [key]: msg.value });
  });
  $('#copyMsg').addEventListener('click', async () => { await api.copy(msg.value); toast('Copied. Paste it in the meeting chat.'); });

  const box = $('#consentBox');
  const btn = $('#recBtn');
  box.addEventListener('change', () => {
    btn.disabled = !box.checked;
    $('#recHint').textContent = box.checked ? 'Ready when you are.' : 'Check the box above to start.';
  });
  btn.addEventListener('click', startRecording);

  const sys = $('#sysToggle');
  sys.checked = pref.get('systemAudio', true);
  const sysLabel = () => { $('#sysLabel').textContent = sys.checked ? 'Recorded from your speakers' : 'Off: only your mic'; };
  sysLabel();
  sys.addEventListener('change', () => { pref.set('systemAudio', sys.checked); sysLabel(); });

  loadMics();
  setTimeout(() => $('h1.title').focus(), 0);
}

async function loadMics() {
  const sel = $('#micSel');
  if (!sel) return;
  try {
    await api.askMic();
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch { /* denied: list stays labelless */ }
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  if (!$('#micSel')) return;
  sel.innerHTML = '';
  sel.add(new Option('None', ''));
  devices.forEach((d, i) => sel.add(new Option(d.label || `Microphone ${i + 1}`, d.deviceId)));
  const saved = pref.get('micId', null);
  sel.value = devices.some((d) => d.deviceId === saved) ? saved : (devices.find((d) => d.deviceId === 'default') || devices[0] || { deviceId: '' }).deviceId;
  sel.addEventListener('change', () => pref.set('micId', sel.value));
}

// ---------- recording ----------
async function startRecording() {
  const micId = $('#micSel')?.value || '';
  const wantSys = $('#sysToggle')?.checked;
  const typedTitle = $('h1.title')?.textContent.trim();
  const hint = (t) => { const e = $('#recHint'); if (e) e.textContent = t; };
  if (!micId && !wantSys) { hint('Pick a microphone or turn on "Other people".'); return; }
  $('#recBtn').disabled = true;
  hint('Starting...');

  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 1;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  const streams = [];
  let got = false;

  if (micId) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: micId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      streams.push(mic);
      const src = ctx.createMediaStreamSource(mic);
      src.connect(dest); src.connect(analyser);
      got = true;
    } catch (e) { console.error('mic', e); hint('Could not open the microphone.'); }
  }

  if (wantSys) {
    try {
      const sys = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      sys.getVideoTracks().forEach((t) => t.stop());
      if (sys.getAudioTracks().length) {
        streams.push(sys);
        const src = ctx.createMediaStreamSource(new MediaStream(sys.getAudioTracks()));
        src.connect(dest); src.connect(analyser);
        got = true;
      } else {
        toast(state.platform === 'darwin' ? 'No system audio. Allow Screen Recording in System Settings.' : 'No system audio found.');
      }
    } catch (e) {
      console.error('system', e);
      toast(state.platform === 'darwin'
        ? 'Allow Screen Recording for this app in System Settings, then restart it.'
        : 'Could not capture system audio.');
    }
  }

  if (!got) {
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    ctx.close();
    const b = $('#recBtn'); if (b) b.disabled = false;
    hint('Nothing to record. Check your sources.');
    return;
  }

  const meeting = await api.recStart();
  if (typedTitle) await api.rename(meeting.id, typedTitle);
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  const mr = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 48000 });
  let queue = Promise.resolve();
  mr.ondataavailable = (ev) => {
    if (!ev.data || !ev.data.size) return;
    queue = queue.then(async () => api.recChunk(new Uint8Array(await ev.data.arrayBuffer())));
  };
  const stopped = new Promise((res) => { mr.onstop = res; });
  mr.start(1000);

  state.rec = { id: meeting.id, mr, ctx, streams, analyser, started: Date.now(), stopped, queue: () => queue, raf: 0, tick: 0 };
  state.rec.tick = setInterval(tickRecording, 250);
  meterLoop();
  await refreshList();
  open(meeting.id);
}

async function stopRecording() {
  const r = state.rec;
  if (!r) return;
  const btn = $('#recBtn'); if (btn) btn.disabled = true;
  if (r.mr.state !== 'inactive') r.mr.stop();
  await r.stopped;
  await r.queue();
  clearInterval(r.tick);
  cancelAnimationFrame(r.raf);
  r.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  r.ctx.close();
  state.rec = null;
  const m = await api.recStop();
  await refreshList();
  if (m) {
    if (state.current === m.id) { state.meeting = m; renderMeetingPage(true); }
    if (state.settings.autoSummarize) runProcess(m.id, { transcribe: true });
  }
}

function tickRecording() {
  const r = state.rec;
  if (!r) return;
  const t = $('#recTime');
  if (t && state.current === r.id) t.textContent = clock((Date.now() - r.started) / 1000);
}

function meterLoop() {
  const r = state.rec;
  if (!r) return;
  const data = new Uint8Array(r.analyser.frequencyBinCount);
  const loop = () => {
    if (!state.rec) return;
    const bars = document.querySelectorAll('#meter i');
    if (bars.length) {
      r.analyser.getByteFrequencyData(data);
      const step = Math.floor(data.length / 2 / bars.length) || 1;
      bars.forEach((b, i) => {
        let v = 0;
        for (let j = 0; j < step; j++) v = Math.max(v, data[i * step + j] || 0);
        b.style.height = `${4 + (v / 255) * 24}px`;
      });
    }
    r.raf = requestAnimationFrame(loop);
  };
  loop();
}

// ---------- transcription + summary ----------
async function decodeToPcm(id) {
  let bytes;
  try {
    const data = await api.readAudio(id);
    bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  } catch (e) {
    throw new Error(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const audio = await ctx.decodeAudioData(bytes);
    const n = audio.length;
    const out = new Float32Array(n);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const ch = audio.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] += ch[i] / audio.numberOfChannels;
    }
    return out;
  } finally {
    ctx.close();
  }
}

async function runProcess(id, { transcribe }) {
  try {
    let pcm = null;
    if (transcribe) {
      state.progress[id] = { stage: 'preparing' };
      updateMeetingFromCache(id, { status: 'transcribing', error: null });
      pcm = await decodeToPcm(id);
    }
    await api.process(id, pcm);
  } catch (e) {
    console.error(e);
    // Keep the error on the page (with a Try again button) instead of a toast that vanishes.
    const m = await api.setError(id, e.message || 'Something went wrong.');
    if (m && state.current === id) { state.meeting = m; renderMeetingPage(); }
  } finally {
    delete state.progress[id];
  }
}

function updateMeetingFromCache(id, patch) {
  if (state.current === id && state.meeting) {
    state.meeting = { ...state.meeting, ...patch };
    renderMeetingPage();
  }
}

// ---------- page: meeting ----------
async function open(id) {
  closeMenu();
  state.current = id;
  if (id === null) {
    state.meeting = null;
    renderNav();
    if (state.rec) return open(state.rec.id);
    renderNewPage();
    return;
  }
  state.meeting = await api.get(id);
  renderNav();
  renderMeetingPage(true);
  $('.scroll').scrollTop = 0;
}

function renderMeetingPage(full = false) {
  const m = state.meeting;
  if (!m) return;
  const page = $('#page');
  const live = state.rec && state.rec.id === m.id;
  $('#crumb').textContent = m.title || 'Untitled meeting';

  if (full || !$('#mTitle')) {
    page.innerHTML = `
      <div class="page-icon">${live ? ICON.mic : ICON.wave}</div>
      <h1 class="title" id="mTitle" contenteditable="true" spellcheck="false" data-placeholder="Untitled meeting"></h1>
      <div class="props" id="props"></div>
      <div id="audioWrap"></div>
      <div id="body"></div>`;
    const title = $('#mTitle');
    title.textContent = m.title || '';
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
    title.addEventListener('blur', async () => {
      const v = title.textContent.trim();
      if (v && v !== state.meeting.title) {
        state.meeting = await api.rename(m.id, v);
        $('#crumb').textContent = state.meeting.title;
        refreshList();
      } else if (!v) title.textContent = state.meeting.title;
    });
    renderTopActions();
  } else if (document.activeElement !== $('#mTitle')) {
    $('#mTitle').textContent = m.title || '';
  }

  // properties
  const end = m.endedAt ? ` – ${fmtTime(m.endedAt)}` : '';
  $('#props').innerHTML = `
    <div class="prop-k">${ICON.cal}Date</div><div class="prop-v">${esc(fmtDate(m.startedAt))}</div>
    <div class="prop-k">${ICON.clock}Time</div><div class="prop-v">${esc(fmtTime(m.startedAt) + end)}</div>
    <div class="prop-k">${ICON.timer}Duration</div><div class="prop-v ${live ? 'dim' : ''}">${live ? 'In progress' : esc(fmtDuration(m.durationSec))}</div>
    <div class="prop-k">${ICON.status}Status</div><div class="prop-v">${statusTag(m)}</div>`;

  // audio player (built once per meeting so playback isn't interrupted)
  const wrap = $('#audioWrap');
  if (live) wrap.innerHTML = '';
  else if (!wrap.querySelector('audio')) {
    const a = document.createElement('audio');
    a.controls = true;
    a.preload = 'metadata';
    a.src = `media://audio/${encodeURIComponent(m.id)}`;
    // Recorded WebM has no duration header; this makes the seek bar work.
    a.addEventListener('loadedmetadata', function fix() {
      if (a.duration === Infinity) {
        a.currentTime = 1e101;
        a.addEventListener('timeupdate', function back() {
          a.removeEventListener('timeupdate', back);
          a.currentTime = 0;
        });
      }
      a.removeEventListener('loadedmetadata', fix);
    });
    wrap.append(a);
  }

  // body
  const body = $('#body');
  if (live) {
    body.innerHTML = `
      <div class="recbar">
        <div class="time" id="recTime">${clock((Date.now() - state.rec.started) / 1000)}</div>
        <div class="meter on" id="meter">${'<i></i>'.repeat(28)}</div>
        <button class="rec-btn stop" id="recBtn"><span class="dot"></span>Stop</button>
      </div>
      <p class="muted">Recording. You can switch to other apps; keep this window open.</p>`;
    $('#recBtn').addEventListener('click', stopRecording);
    return;
  }

  let html = '';
  if (m.error) {
    html += `<div class="callout error-callout">${ICON.alert}<div class="body"><div>${esc(m.error)}</div>
      <div><button class="btn" data-act="retry">Try again</button></div></div></div>`;
  }

  if (m.status === 'transcribing' || m.status === 'summarizing') {
    const p = state.progress[m.id];
    const pct = p && typeof p.pct === 'number' && (p.stage === 'transcribing' || p.stage === 'downloading') ? p.pct : null;
    const label = m.status === 'summarizing' ? 'Claude is writing your notes...'
      : p?.stage === 'downloading' ? 'Downloading the speech model (one time only)...'
        : p?.stage === 'preparing' ? 'Preparing audio...'
          : p?.stage === 'loading' ? 'Loading the speech model...' : 'Transcribing on your computer...';
    html += `<div class="working">
      <div class="label"><span class="spinner"></span>${label}</div>
      <div class="bar ${pct === null ? 'indet' : ''}"><i data-w="${pct ?? 0}"></i></div>
      <div class="skeleton"><i data-w="40"></i><i data-w="92"></i><i data-w="86"></i><i data-w="64"></i></div>
    </div>`;
  } else if (m.summary) {
    html += `<div class="content">${renderMarkdown(m.summary)}</div>`;
  } else if (m.status === 'transcribed' && !state.settings.hasApiKey) {
    html += `<div class="callout info-callout">${ICON.key}<div class="body">
      <div><strong>Add your Claude API key to get a summary.</strong> The transcript is ready below.</div>
      <div><button class="btn" data-act="settings">Open Settings</button></div></div></div>`;
  } else if (m.status === 'transcribed') {
    html += `<div><button class="btn primary" data-act="summarize">${ICON.redo}Summarize</button></div>`;
  } else if (m.status === 'recorded' && !m.error) {
    html += `<div class="callout">${ICON.wave}<div class="body">
      <div>This recording hasn't been summarized yet.</div>
      <div><button class="btn primary" data-act="transcribe">Transcribe and summarize</button></div></div></div>`;
  }

  if (m.transcript) {
    const lines = m.transcript.split('\n').map((l) => {
      const mt = l.match(/^\[([\d:]+)\]\s*(.*)$/);
      return mt ? `<span class="ts">${esc(mt[1])}</span>${esc(mt[2])}` : esc(l);
    }).join('\n');
    const wasOpen = $('#transcript')?.open;
    html += `<details class="toggle" id="transcript"${wasOpen ? ' open' : ''}><summary>${ICON.chev}Transcript
      <button class="btn small-btn" data-act="copyTranscript" title="Copy the full transcript">${ICON.copy}Copy transcript</button></summary>
      <div class="transcript">${lines}</div></details>`;
  }
  body.innerHTML = html;
  // Widths are set from script because the page's security policy blocks inline style="" attributes.
  body.querySelectorAll('[data-w]').forEach((el) => { el.style.width = `${el.dataset.w}%`; });

  body.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', (e) => {
    const act = b.dataset.act;
    if (act === 'copyTranscript') {
      e.preventDefault(); // don't open or close the transcript toggle
      copyTranscript();
      return;
    }
    if (act === 'settings') openSettings();
    if (act === 'summarize') runProcess(m.id, { transcribe: false });
    if (act === 'transcribe') runProcess(m.id, { transcribe: true });
    if (act === 'retry') runProcess(m.id, { transcribe: !m.transcript });
  }));
  body.querySelectorAll('li.todo .box').forEach((box) => box.addEventListener('click', () => {
    box.parentElement.classList.toggle('done');
  }));
}

// ---------- top-right menu ----------
function renderTopActions() {
  const ta = $('#topActions');
  ta.innerHTML = '';
  const m = state.meeting;
  if (!m) return;
  const copy = h(`<button class="icon-btn" title="Copy notes">${ICON.copy}</button>`);
  copy.addEventListener('click', () => copyNotes());
  const more = h(`<button class="icon-btn" title="More">${ICON.more}</button>`);
  more.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
  ta.append(copy, more);
}

function copyNotes() {
  const m = state.meeting;
  if (!m) return;
  const end = m.endedAt ? ` – ${fmtTime(m.endedAt)}` : '';
  const text = `# ${m.title}\n${fmtFullDate(m.startedAt)}, ${fmtTime(m.startedAt)}${end} (${fmtDuration(m.durationSec)})\n\n${m.summary || m.transcript || ''}`;
  api.copy(text);
  toast('Notes copied');
}

function copyTranscript() {
  const m = state.meeting;
  if (!m?.transcript) return;
  api.copy(`${m.title}\n${fmtFullDate(m.startedAt)}, ${fmtTime(m.startedAt)}\n\n${m.transcript}`);
  toast('Transcript copied');
}

function closeMenu() { const x = $('.menu'); if (x) x.remove(); }
function toggleMenu() {
  if ($('.menu')) return closeMenu();
  const m = state.meeting;
  const busy = m.status === 'transcribing' || m.status === 'summarizing' || (state.rec && state.rec.id === m.id);
  const menu = h(`<div class="menu">
    <button data-a="copy">${ICON.copy}Copy notes</button>
    ${m.transcript ? `<button data-a="copyT">${ICON.copy}Copy transcript</button>` : ''}
    ${!busy && m.transcript && state.settings.hasApiKey ? `<button data-a="resum">${ICON.redo}Re-summarize</button>` : ''}
    ${!busy ? `<button data-a="retrans">${ICON.wave}Re-transcribe</button>` : ''}
    <button data-a="show">${ICON.folder}Show in folder</button>
    <div class="sep"></div>
    <button data-a="del" class="danger"${busy ? ' disabled' : ''}>${ICON.trash}Delete</button>
  </div>`);
  menu.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    closeMenu();
    const a = b.dataset.a;
    if (a === 'copy') copyNotes();
    if (a === 'copyT') copyTranscript();
    if (a === 'resum') runProcess(m.id, { transcribe: false });
    if (a === 'retrans') runProcess(m.id, { transcribe: true });
    if (a === 'show') api.show(m.id);
    if (a === 'del' && await api.remove(m.id)) {
      await refreshList();
      open(state.meetings[0]?.id ?? null);
    }
  });
  $('#topActions').append(menu);
}
document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeMenu(); });

// ---------- settings ----------
function openSettings() {
  const s = state.settings;
  $('#settings').hidden = false;
  $('#apiKey').value = '';
  setKeyState(s.hasApiKey ? 'A key is saved.' : 'No key saved yet.');
  $('#testKey').hidden = !s.hasApiKey;
  $('#claudeModel').value = s.claudeModel;
  $('#whisperModel').value = s.whisperModel;
  $('#autoSummarize').checked = !!s.autoSummarize;
}
function setKeyState(text, kind = '') {
  const el = $('#keyState');
  el.textContent = text;
  el.className = `muted small ${kind}`;
}

async function testKey() {
  setKeyState('Checking with Claude...');
  $('#testKey').hidden = true;
  const r = await api.checkKey();
  setKeyState(r.message, r.ok ? 'ok' : 'bad');
  $('#testKey').hidden = !state.settings.hasApiKey;
  return r.ok;
}

function closeSettings() { $('#settings').hidden = true; }

function wireSettings() {
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#settings').addEventListener('click', (e) => { if (e.target.id === 'settings' || e.target.closest('[data-close]')) closeSettings(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSettings(); closeMenu(); } });
  $('#saveKey').addEventListener('click', async () => {
    const v = $('#apiKey').value.trim();
    if (v && !v.startsWith('sk-ant-')) { setKeyState("That doesn't look like a Claude key (they start with sk-ant-).", 'bad'); return; }
    if (!v && !state.settings.hasApiKey) { setKeyState('Paste a key first.', 'bad'); return; }
    state.settings = await api.setSettings({ apiKey: v });
    $('#apiKey').value = '';
    if (state.settings.hasApiKey) await testKey();
    else { setKeyState('Key removed.'); $('#testKey').hidden = true; }
    if (state.meeting) renderMeetingPage();
  });
  $('#testKey').addEventListener('click', testKey);
  $('#apiKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#saveKey').click(); });
  $('#keyLink').addEventListener('click', (e) => { e.preventDefault(); api.openUrl('https://platform.claude.com/settings/keys'); });
  for (const id of ['claudeModel', 'whisperModel']) {
    $(`#${id}`).addEventListener('change', async (e) => {
      state.settings = await api.setSettings({ [id]: e.target.value });
      if (id === 'claudeModel' && state.settings.hasApiKey) testKey(); // make sure the key can use the new model
    });
  }
  $('#autoSummarize').addEventListener('change', async (e) => { state.settings = await api.setSettings({ autoSummarize: e.target.checked }); });
}

// ---------- boot ----------
async function boot() {
  state.platform = await api.platform();
  if (state.platform === 'darwin') document.body.classList.add('mac');
  state.settings = await api.getSettings();
  wireSettings();
  $('#newBtn').addEventListener('click', () => open(null));
  $('#folderBtn').addEventListener('click', () => api.openFolder());
  $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderNav(); });

  api.onMeeting((m) => {
    const i = state.meetings.findIndex((x) => x.id === m.id);
    const { transcript, ...lite } = m;
    if (i >= 0) state.meetings[i] = lite; else state.meetings.unshift(lite);
    renderNav();
    if (state.current === m.id && !(state.rec && state.rec.id === m.id)) {
      state.meeting = m;
      renderMeetingPage();
    }
  });
  api.onProgress((p) => {
    state.progress[p.id] = p;
    if (state.current === p.id && state.meeting) {
      const st = p.stage === 'summarizing' ? 'summarizing' : 'transcribing';
      if (state.meeting.status !== st) state.meeting.status = st;
      renderMeetingPage();
    }
  });

  await refreshList();
  open(null);
}
boot();
