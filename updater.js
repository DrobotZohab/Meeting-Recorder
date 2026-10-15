// Keeps the app up to date from GitHub Releases.
// Windows: downloads in the background, installs on restart (or next time the app closes).
// Mac: unsigned apps can't self-install, so it offers the new download instead.
const { app, shell } = require('electron');

const REPO = 'DrobotZohab/meeting-recorder';
const RELEASES = `https://github.com/${REPO}/releases/latest`;
const CHECK_EVERY = 6 * 60 * 60 * 1000;

let notify = () => {};
let state = { status: 'idle', version: null, error: null };
let winUpdater = null;

function set(patch) {
  state = { ...state, ...patch };
  notify(state);
}

const newer = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

async function checkMac() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Liqa-app' }
    });
    if (!res.ok) return;
    const rel = await res.json();
    const hasMacBuild = (rel.assets || []).some((a) => /mac.*\.dmg$/i.test(a.name));
    if (hasMacBuild && newer(rel.tag_name, app.getVersion())) {
      set({ status: 'available', version: rel.tag_name.replace(/^v/, '') });
    }
  } catch { /* offline: try again later */ }
}

function setupWindows() {
  const { autoUpdater } = require('electron-updater');
  winUpdater = autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // closing the app also installs it
  autoUpdater.on('update-available', (i) => set({ status: 'downloading', version: i.version }));
  autoUpdater.on('update-downloaded', (i) => set({ status: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => console.error('update', e));
}

function check() {
  if (!app.isPackaged) return; // nothing to update when running from source
  if (process.platform === 'win32') winUpdater?.checkForUpdates().catch((e) => console.error('update', e));
  else if (process.platform === 'darwin') checkMac();
}

function start(onChange) {
  notify = onChange;
  if (!app.isPackaged) return;
  if (process.platform === 'win32') setupWindows();
  setTimeout(check, 5000);
  setInterval(check, CHECK_EVERY);
}

// Button in the app: restart into the new version (Windows) or open the download (Mac).
function act() {
  if (state.status === 'ready' && winUpdater) {
    setImmediate(() => winUpdater.quitAndInstall(true, true));
    return 'restarting';
  }
  shell.openExternal(RELEASES);
  return 'opened';
}

module.exports = { start, act, getState: () => state, newer };
