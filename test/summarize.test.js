// Offline test: checks the Claude request shape and how the reply is parsed.
const assert = require('assert');
const { summarize, parse } = require('../summarize');

(async () => {
  let sent = null;
  const fakeFetch = async (url, opts) => {
    sent = { url, opts, body: JSON.parse(opts.body) };
    return {
      ok: true, status: 200,
      json: async () => ({ content: [
        { type: 'thinking', thinking: '...' },
        { type: 'text', text: 'TITLE: Robotics Sponsor Plan\n\n## TL;DR\nTeam agreed to email sponsors.\n\n## Action items\n- [ ] Email Acme (Zohab, Friday)' }
      ] })
    };
  };
  const out = await summarize({
    apiKey: 'sk-ant-test', model: 'claude-haiku-5-5', transcript: '[00:01] hello',
    startedAt: '2026-10-13T18:30:00Z', durationSec: 1800, fetchImpl: fakeFetch
  });
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.opts.headers['x-api-key'], 'sk-ant-test');
  assert.equal(sent.opts.headers['anthropic-version'], '2023-06-01');
  assert.equal(sent.body.model, 'claude-haiku-5-5');
  assert.ok(sent.body.messages[0].content.includes('[00:01] hello'));
  assert.equal(out.title, 'Robotics Sponsor Plan');
  assert.ok(out.summary.startsWith('## TL;DR'));
  assert.ok(!out.summary.includes('TITLE:'));

  assert.deepEqual(parse('## TL;DR\nNo title here'), { title: null, summary: '## TL;DR\nNo title here' });

  const bad = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) });
  await assert.rejects(summarize({ apiKey: 'x', model: 'm', transcript: 't', fetchImpl: bad }), /rejected/);
  console.log('summarize tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
