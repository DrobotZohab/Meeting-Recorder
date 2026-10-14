# Meetings

A Notion-style meeting recorder for Windows and Mac. Records your mic and everyone else in the call, transcribes on your computer for free, and has Claude write the notes.

## Download

Go to **Releases** on the right side of this repo and grab:
- **Windows:** `Meetings-x.x.x-win-x64.exe`
- **Mac (Apple Silicon):** `Meetings-x.x.x-mac-arm64.dmg`

### Mac first launch
The app isn't signed with a paid Apple certificate, so macOS blocks it the first time:
1. Open it once, click **Done** on the warning.
2. Go to **System Settings > Privacy & Security**, scroll down, click **Open Anyway**.
3. When you record, allow **Microphone** and **Screen Recording** (Screen Recording is how macOS lets apps hear other people in the call). Restart the app after allowing.

Needs macOS 13 or newer. Intel Macs: run from source (below).

### Windows first launch
SmartScreen may say "Windows protected your PC". Click **More info > Run anyway**.

## Use it
1. **Settings:** paste your Claude API key (from platform.claude.com).
2. **New meeting:** tell people you're recording, tick the box, hit **Start recording**.
3. **Stop:** it transcribes on your computer, then Claude writes the summary, decisions and action items.

The transcript labels each line **Me** (your microphone) or **Audio** (sound from your computer, like the other people on the call). Wear headphones for the cleanest labels; on speakers your mic also hears the call.

If the other people aren't being recorded, click **Test audio** next to "Other people" on the New meeting page. It tells you what's blocking it.

Everything is saved in `Documents/Meeting Recordings`, one folder per meeting.

## Cost
- Transcription: free, runs locally (the speech model downloads once, about 80 MB).
- Summary: Claude Haiku 5.5 by default, usually well under a cent per meeting.

## Updates
The app checks for updates on its own.
- **Windows:** downloads in the background. Click **Restart to update** in the sidebar, or it installs next time you close the app.
- **Mac:** shows **Update available** in the sidebar, which opens the new download.

## Make a new release
Bump `version` in `package.json` and push to `main`. GitHub Actions builds both installers and publishes the release automatically (about 3 minutes). You can also start it by hand from the Actions tab.

## Run from source
```
npm install
npm install-scripts approve electron   # only needed on npm 11+
node node_modules/electron/install.js  # only if the approve step was needed
npm start
```
