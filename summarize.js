// Sends a transcript to the Claude API and returns { title, summary }.

const SYSTEM = `You turn meeting transcripts into clear notes.

The transcript comes from automatic speech recognition. It has timestamps but no speaker names, and it may contain recognition errors. Fix obvious mis-hearings silently. Never invent facts, names, owners, or dates.

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

async function summarize({ apiKey, model, transcript, startedAt, durationSec, fetchImpl = fetch }) {
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
        content: `Meeting started: ${when}\nLength: ${fmtDuration(durationSec)}\n\n<transcript>\n${transcript}\n</transcript>`
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

module.exports = { summarize, parse, SYSTEM };
