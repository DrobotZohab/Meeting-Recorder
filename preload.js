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

  recStart: () => ipcRenderer.invoke('rec:start'),
  recChunk: (bytes) => ipcRenderer.invoke('rec:chunk', bytes),
  recStop: () => ipcRenderer.invoke('rec:stop'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  copy: (text) => ipcRenderer.invoke('copy', text),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),

  onMeeting: on('meeting-updated'),
  onProgress: on('progress')
});
