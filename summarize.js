// Sends a transcript to the Claude API and returns { title, summary }.

const SYSTEM = `You turn meeting transcripts into clear notes.

The transcript comes from automatic speech recognition and may contain recognition errors. Fix obvious mis-hearings silently. Never invent facts, names, owners, or dates.

If lines are labeled, "You:" is the person who recorded the meeting (write "you" when referring to them, e.g. owner "you") and "Others:" is everyone else on the call, possibly several people. Use names when someone says them; otherwise refer to "Others" as "the other side" or "someone". If lines are not labeled, there is no speaker information.

Reply in exactly this format:

TITLE: <a short, specific meeting title, max 8 words>

## TL;DR
<2-3 sentences: what the meeting was about and what came out of it>

## Key points
- <main topics and what was said about each>

## Decisions
- <what was agreed. Write "None." if nothing was decided>

## Action items
- [ ] <task> (<owner if a name was said, otherwise "unassigned">, <due date if said>)
Write "None." if there are no action items.

## Open questions
- <things raised but not resolved. Write "None." if none>

Rules: no small talk, no filler, be concise. If the transcript is too short or unclear to summarize, say so in the TL;DR.`;

function fmtDuration(sec) {
  const m = Math.round((sec || 0) / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function parse(text) {
  const t = String(text || '').trim();
  const match = t.match(/^\s*TITLE:\s*(.+)\s*$/im);
  const title = match ? match[1].replace(/^["*#\s]+|["*\s]+$/g, '').slice(0, 120) : null;
  const summary = match ? t.replace(match[0], '').trim() : t;
  return { title, summary };
}

async function summarize({ apiKey, model, transcript, startedAt, durationSec, labeled = false, fetchImpl = fetch }) {
  const when = startedAt ? new Date(startedAt).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' }) : 'unknown';
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Meeting started: ${when}\nLength: ${fmtDuration(durationSec)}\nSpeaker labels: ${labeled ? 'yes (You / Others)' : 'no'}\n\n<transcript>\n${transcript}\n</transcript>`
      }]
    })
  });

  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error */ }
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new Error('Claude API key was rejected. Check it in Settings.');
    if (res.status === 429) throw new Error('Claude API rate limit hit. Try again in a minute.');
    throw new Error(`Claude API error: ${msg}`);
  }
  const text = (body?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (!text.trim()) throw new Error('Claude returned an empty summary.');
  return parse(text);
}

// Checks a key without spending tokens: looks up the summary model with it.
async function checkKey({ apiKey, model, fetchImpl = fetch }) {
  if (!apiKey) return { ok: false, message: 'No key saved yet.' };
  let res;
  try {
    res = await fetchImpl(`https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    });
  } catch {
    return { ok: false, message: "Couldn't reach Claude. Check your internet connection." };
  }
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  if (res.ok) return { ok: true, message: `Key works. Summaries will use ${body?.display_name || model}.` };
  if (res.status === 401) return { ok: false, message: 'Claude rejected this key. Copy it again from platform.claude.com.' };
  if (res.status === 403) return { ok: false, message: "This key doesn't have permission to use Claude models." };
  if (res.status === 404) return { ok: false, message: `The key works, but the model "${model}" isn't available to it. Pick another summary model.` };
  if (res.status === 429) return { ok: true, message: 'Key works (Claude is rate limiting right now, try again shortly).' };
  return { ok: false, message: `Couldn't check the key: ${body?.error?.message || `HTTP ${res.status}`}` };
}

module.exports = { summarize, checkKey, parse, SYSTEM };
