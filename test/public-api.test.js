'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), fs = require('node:fs');
const { copyApp, seed, startServer, rm } = require('./helpers');
test('public API: keys, inference, quotas and errors', async t => {
  let handler, received = [], providerHeaders;
  const mock = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => { const b = JSON.parse(raw); received.push(b); providerHeaders = req.headers; handler(b, res); });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const dir = copyApp(); seed(dir, { users: [{ id: 'u1', login: 'anna' }, { id: 'u2', login: 'boris' }], sessions: { tok1: 'u1', tok2: 'u2' } });
  fs.writeFileSync(dir + '/data/models.json', JSON.stringify([
    { id: 'public-m1', name: 'My Model', modelId: 'private-provider-id', baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, apiKey: 'provider-secret', plans: ['free'], weight: 2, prompt: 'Admin rules' },
    { id: 'paid', name: 'Paid', modelId: 'paid-private', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'paid-secret', plans: ['pro'] }
  ]));
  const s = await startServer(dir, { MODEL_REQUEST_TIMEOUT_MS: '1000' });
  t.after(async () => { await s.stop(); mock.closeAllConnections(); await new Promise(r => mock.close(r)); rm(dir); });
  const { req } = s;
  const manage = (method, suffix = '', body, token = 'tok1', headers = {}) => req(method, '/api/account/api-keys' + suffix, { token, body, headers });
  let key, keyId;
  const infer = (body = {}, k = key) => req('POST', '/v1/chat/completions', { headers: { Authorization: 'Bearer ' + k }, body: { model: 'public-m1', messages: [{ role: 'user', content: 'Hi' }], ...body } });
  const used = async () => (await req('GET', '/api/billing', { token: 'tok1' })).json.used.m;
  const normal = (b, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: 'private', model: 'private-provider-id', choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }, provider: 'private metadata' })); };
  handler = normal;
  await t.test('requires session for key management', async () => { assert.equal((await req('GET', '/api/account/api-keys')).status, 401); });
  await t.test('CSRF protection and invalid key input', async () => {
    assert.equal((await manage('POST', '', { name: 'Bad' }, 'tok1', { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await manage('POST', '', { name: 'Bad' }, 'tok1', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    for (const body of [{}, { name: 'x', expires_days: -1 }, { name: 'x', expires_days: 1.5 }]) assert.equal((await manage('POST', '', body)).status, 400);
  });
  await t.test('creates once-only key and stores only SHA256', async () => {
    const r = await manage('POST', '', { name: '<Test>', expires_days: 30 }); assert.equal(r.status, 201, r.text); key = r.json.key; keyId = r.json.id;
    assert.match(key, /^sk-premier-[a-f0-9]{64}$/); assert.equal(r.headers.get('cache-control'), 'no-store');
    const list = await manage('GET'); assert.equal(list.json.keys.length, 1); assert.ok(!list.text.includes(key)); assert.ok(!list.text.includes('provider-secret'));
    assert.equal(list.json.base_url, s.base + '/v1'); assert.deepEqual(list.json.models.map(m => m.id), ['public-m1']);
    const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(dir + '/data/premier.db');
    const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(keyId); assert.equal(row.hash.length, 64); assert.ok(!JSON.stringify(row).includes(key)); db.close();
  });
  await t.test('bearer required: cookie does not authorize API; API key does not authorize account', async () => {
    assert.equal((await req('GET', '/v1/models', { token: 'tok1' })).status, 401);
    assert.equal((await req('GET', '/v1/models', { headers: { Authorization: 'Bearer invalid' } })).status, 401);
    assert.equal((await req('GET', '/api/account/api-keys', { headers: { Authorization: 'Bearer ' + key } })).status, 401);
  });
  await t.test('list and retrieve public Model ID only', async () => {
    const headers = { Authorization: 'Bearer ' + key };
    const r = await req('GET', '/v1/models', { headers }); assert.equal(r.status, 200); assert.equal(r.json.object, 'list');
    assert.equal(r.json.data[0].id, 'public-m1'); assert.ok(!/private-provider|provider-secret|baseUrl/.test(r.text));
    assert.equal((await req('GET', '/v1/models/public-m1', { headers })).status, 200);
    assert.equal((await req('GET', '/v1/models/paid', { headers })).status, 404);
    assert.equal((await req('GET', '/v1/unknown', { headers })).status, 404);
    assert.equal((await req('GET', '/v1/chat/completions', { headers })).status, 405);
  });
  await t.test('JSON response, provider mapping, admin prompt, cap and billing', async () => {
    const before = await used(); const r = await infer({ max_tokens: 999999 }); assert.equal(r.status, 200, r.text);
    assert.equal(r.json.model, 'public-m1'); assert.match(r.json.id, /^chatcmpl-/); assert.equal(r.json.object, 'chat.completion');
    assert.equal(r.json.choices[0].message.content, 'Hello'); assert.equal(r.json.usage.total_tokens, 5); assert.ok(!r.text.includes('private'));
    assert.equal(received.at(-1).model, 'private-provider-id'); assert.equal(received.at(-1).messages[0].content, 'Admin rules');
    assert.equal(received.at(-1).max_tokens, 16000); assert.equal(providerHeaders.authorization, 'Bearer provider-secret');
    assert.equal(await used(), before + 2);
  });
  await t.test('validation rejects unsafe/unsupported inputs without billing', async () => {
    const before = await used(), calls = received.length;
    for (const b of [{ model: 'private-provider-id' }, { messages: [] }, { messages: [{ role: 'bad', content: 'x' }] }, { stream: 'true' }, { n: 2 }, { max_tokens: -1 }, { temperature: 9 }, { base_url: 'https://evil.example' }, { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] }] }, { stream_options: { include_usage: true } }, { tools: 'bad' }]) {
      const r = await infer(b); assert.ok([400, 404].includes(r.status), JSON.stringify(b) + ' ' + r.text);
    }
    const r = await fetch(s.base + '/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: '{invalid' }); assert.equal(r.status, 400);
    assert.equal(await used(), before); assert.equal(received.length, calls);
  });
  await t.test('plan restrictions cannot be bypassed', async () => { const before = await used(); const r = await infer({ model: 'paid' }); assert.equal(r.status, 403); assert.equal(await used(), before); });
  await t.test('SSE, split UTF8, tools, usage and public model identity', async () => {
    handler = (b, res) => {
      assert.equal(b.stream, true); res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = c => 'data: ' + JSON.stringify({ model: 'private-provider-id', choices: c }) + '\r\n\r\n';
      const bytes = Buffer.from(chunk([{ index: 0, delta: { content: 'Привет' }, finish_reason: null }]));
      res.write(bytes.subarray(0, 74)); res.write(bytes.subarray(74));
      res.write(chunk([{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] }, finish_reason: 'tool_calls' }]));
      res.end('data: ' + JSON.stringify({ choices: [], usage: { total_tokens: 6 } }) + '\n\ndata: [DONE]\n\n');
    };
    const r = await infer({ stream: true, stream_options: { include_usage: true }, tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }] });
    assert.equal(r.status, 200, r.text); assert.ok(r.headers.get('content-type').startsWith('text/event-stream'));
    const ev = r.text.split('\n').filter(x => x.startsWith('data: {')).map(x => JSON.parse(x.slice(6)));
    assert.equal(ev[0].choices[0].delta.content, 'Привет'); assert.ok(ev.every(x => x.model === 'public-m1' && x.object === 'chat.completion.chunk'));
    assert.equal(ev.at(-1).usage.total_tokens, 6); assert.match(r.text, /data: \[DONE\]/); assert.ok(!r.text.includes('private-provider-id'));
  });
  await t.test('provider errors, malformed and empty responses refund and redact secrets', async () => {
    const before = await used();
    for (const fn of [
      (b, res) => { res.writeHead(401); res.end('provider-secret'); },
      (b, res) => res.end('not JSON provider-secret'),
      (b, res) => res.end(JSON.stringify({ choices: [{ message: { content: '' } }] })),
    ]) { handler = fn; const r = await infer(); assert.equal(r.status, 502, r.text); assert.ok(!r.text.includes('provider-secret')); }
    assert.equal(await used(), before);
  });
  await t.test('empty/partial SSE has structured error, no charge without generated text', async () => {
    const before = await used();
    handler = (b, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n'); };
    const r = await infer({ stream: true }); assert.match(r.text, /upstream_error/); assert.equal(await used(), before);
  });
  await t.test('timeout refunds', async () => {
    const before = await used(); handler = () => {};
    const r = await infer(); assert.equal(r.status, 504, r.text); assert.equal(await used(), before); mock.closeAllConnections();
  });
  await t.test('two concurrent calls per user across keys', async () => {
    let release = [];
    handler = (b, res) => release.push(() => normal(b, res));
    const a = infer(), b = infer();
    for (let i = 0; i < 100 && release.length < 2; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(release.length, 2);
    assert.equal((await infer()).status, 429);
    release.forEach(f => f()); assert.equal((await a).status, 200); assert.equal((await b).status, 200);
  });
  await t.test('daily shared quota enforced', async () => {
    handler = normal;
    while (await used() < 20) { const r = await infer(); assert.equal(r.status, 200, r.text); }
    const r = await infer(); assert.equal(r.status, 429); assert.equal(r.json.error.code, 'insufficient_quota'); assert.equal(await used(), 20);
  });
  await t.test('other users cannot see or revoke keys', async () => {
    assert.deepEqual((await manage('GET', '', undefined, 'tok2')).json.keys, []);
    assert.equal((await manage('DELETE', '/' + keyId, {}, 'tok2')).status, 404);
    assert.equal((await req('GET', '/v1/models', { headers: { Authorization: 'Bearer ' + key } })).status, 200);
  });
  await t.test('key cap and expiry', async () => {
    for (let i = 0; i < 9; i++) assert.equal((await manage('POST', '', { name: 'key ' + i })).status, 201);
    assert.equal((await manage('POST', '', { name: 'overflow' })).status, 409);
    const { DatabaseSync } = require('node:sqlite'), db = new DatabaseSync(dir + '/data/premier.db');
    db.prepare('UPDATE api_keys SET expires = ? WHERE id = ?').run(Date.now() - 100, keyId); db.close();
    assert.equal((await req('GET', '/v1/models', { headers: { Authorization: 'Bearer ' + key } })).status, 401);
  });
  await t.test('revoke is immediate and delete account removes all keys', async () => {
    assert.equal((await manage('DELETE', '/' + keyId, {})).status, 200);
    assert.equal((await req('GET', '/v1/models', { headers: { Authorization: 'Bearer ' + key } })).status, 401);
    const r = await manage('POST', '', { name: 'delete account test' }); assert.equal(r.status, 201); const fresh = r.json.key;
    assert.equal((await req('DELETE', '/api/account', { token: 'tok1', body: { confirm: 'удалить' } })).status, 200);
    assert.equal((await req('GET', '/v1/models', { headers: { Authorization: 'Bearer ' + fresh } })).status, 401);
    const { DatabaseSync } = require('node:sqlite'), db = new DatabaseSync(dir + '/data/premier.db');
    assert.equal(db.prepare('SELECT count(*) AS n FROM api_keys WHERE uid = ?').get('u1').n, 0); db.close();
  });
});

test('API keys persist across process restart; auth brute-force is throttled', async t => {
  const dir = copyApp(); seed(dir);
  let s = await startServer(dir);
  t.after(async () => { await s.stop(); rm(dir); });
  const r = await s.req('POST', '/api/account/api-keys', { token: 'tok1', body: { name: 'Persistent' } });
  assert.equal(r.status, 201); const key = r.json.key;
  await s.stop(); s = await startServer(dir);
  assert.equal((await s.req('GET', '/v1/models', { headers: { Authorization: 'Bearer ' + key } })).status, 200);
  let last;
  for (let i = 0; i < 31; i++) last = await s.req('GET', '/v1/models', { headers: { Authorization: 'Bearer wrong' } });
  assert.equal(last.status, 429); assert.equal(last.headers.get('retry-after'), '60');
});
