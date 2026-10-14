const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const h = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('api', {
  platform: () => ipcRenderer.invoke('platform'),
  askMic: () => ipcRenderer.invoke('ask-mic'),

  list: () => ipcRenderer.invoke('meetings:list'),
  get: (id) => ipcRenderer.invoke('meetings:get', id),
  rename: (id, title) => ipcRenderer.invoke('meetings:rename', id, title),
  remove: (id) => ipcRenderer.invoke('meetings:delete', id),
  show: (id) => ipcRenderer.invoke('meetings:show', id),
  process: (id, pcm) => ipcRenderer.invoke('meetings:process', id, pcm),
  readAudio: (id, kind) => ipcRenderer.invoke('meetings:audio', id, kind),
  setError: (id, message) => ipcRenderer.invoke('meetings:error', id, message),

  recStart: (sources) => ipcRenderer.invoke('rec:start', sources),
  recChunk: (kind, bytes) => ipcRenderer.invoke('rec:chunk', kind, bytes),
  recStop: () => ipcRenderer.invoke('rec:stop'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  checkKey: () => ipcRenderer.invoke('settings:checkKey'),

  copy: (text) => ipcRenderer.invoke('copy', text),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),

  updateState: () => ipcRenderer.invoke('update:state'),
  updateNow: () => ipcRenderer.invoke('update:act'),
  onUpdate: on('update'),

  onMeeting: on('meeting-updated'),
  onProgress: on('progress')
});
