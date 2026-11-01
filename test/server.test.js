'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { copyApp, seed, startServer, rm } = require('./helpers');

test('сервер', async (t) => {
  const dir = copyApp(); seed(dir, { users: [{ id: 'u1', login: 'anna', email: 'a@example.com', created: '2026-01-01T00:00:00Z' }, { id: 'u2', login: 'boris', email: 'b@example.com', created: '2026-01-01T00:00:00Z' }], sessions: { tok1: 'u1', tok2: 'u2' } });
  const s = await startServer(dir); t.after(async () => { await s.stop(); rm(dir); });
  const { req } = s;

  await t.test('/healthz отвечает', async () => {
    const r = await req('GET', '/healthz'); assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.equal(r.json.checks.db, true);
  });
  await t.test('главная и защитные заголовки', async () => {
    const r = await req('GET', '/'); assert.equal(r.status, 200);
    assert.match(r.text, /GPT, Claude, Grok, Kimi и Gemini — без VPN/);
    assert.match(r.text, /Топовые нейросети в одном окне:/);
    assert.match(r.text, /от ответа до готового сайта за минуту/);
    assert.match(r.text, /Попробовать бесплатно/);
    assert.ok(!r.text.includes('Ваше пространство для мыслей'));
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  });
  await t.test('чат без входа — на страницу входа', async () => {
    assert.equal((await req('GET', '/chat')).status, 302);
    assert.equal((await req('GET', '/api/sync')).status, 401);
    assert.equal((await req('GET', '/chat', { token: 'tok1' })).status, 200);
  });
  await t.test('нельзя выйти за пределы папки public', async () => {
    for (const u of ['/../server.js', '/%2e%2e/server.js', '/..%2fdb.js', '/js/../../data/premier.db', '/%2e%2e%2fdata%2fpremier.db']) {
      const r = await req('GET', u); assert.ok(r.status >= 400 || !/require\(|SQLite format/.test(r.text), u);
    }
  });
  await t.test('синхронизация: два устройства и конфликт', async () => {
    let r = await req('POST', '/api/sync', { token: 'tok1', body: { base: 0, put: [{ id: 'c1', msgs: [{ r: 'u', t: 'привет' }] }], meta: { projects: [], order: ['c1'] } } });
    assert.equal(r.status, 200); const rev = r.json.rev; assert.ok(rev > 0);
    r = await req('POST', '/api/sync', { token: 'tok1', body: { base: rev, put: [{ id: 'c1', msgs: [{ r: 'u', t: 'привет' }, { r: 'a', t: 'здравствуйте' }] }] } });
    assert.deepEqual(r.json.conflicts, []);
    r = await req('POST', '/api/sync', { token: 'tok1', body: { base: rev, put: [{ id: 'c1', msgs: [] }] } }); // второе устройство со старой версией
    assert.deepEqual(r.json.conflicts, ['c1']); assert.equal(r.json.chats.find((c) => c.id === 'c1').data.msgs.length, 2, 'вернули актуальную версию');
    r = await req('GET', '/api/sync?since=0', { token: 'tok2' }); assert.deepEqual(r.json.chats, [], 'чаты другого пользователя не видны');
  });
  await t.test('старый формат /api/state', async () => {
    let r = await req('GET', '/api/state', { token: 'tok1' }); assert.equal(r.json.state.chats.length, 1);
    assert.equal((await req('PUT', '/api/state', { token: 'tok1', body: { rev: 1, state: { chats: [] } } })).status, 409);
    r = await req('PUT', '/api/state', { token: 'tok1', body: { rev: r.json.rev, state: { projects: [], chats: [{ id: 'c2', msgs: [] }] } } }); assert.equal(r.status, 200);
    r = await req('GET', '/api/sync?since=0', { token: 'tok1' }); assert.deepEqual(r.json.chats.map((c) => c.id), ['c2']);
  });
  await t.test('некорректные данные синхронизации', async () => {
    assert.equal((await req('POST', '/api/sync', { token: 'tok1', body: { base: 0, put: 'x' } })).status, 400);
  });
  await t.test('панель: пароль и доступ', async () => {
    assert.equal((await req('GET', '/api/admin/monitor')).status, 401);
    assert.equal((await req('POST', '/api/admin/login', { body: { password: '00121' } })).status, 401);
    const r = await req('POST', '/api/admin/login', { body: { password: 'Test-Admin-Pass-2026' } }); assert.equal(r.status, 200);
    const m = await req('GET', '/api/admin/monitor', { headers: { Authorization: 'Bearer ' + r.json.token } });
    assert.equal(m.status, 200); assert.equal(typeof m.json.stats.uptime, 'number');
  });
  await t.test('подбор кода помощника ограничен', async () => {
    let last; for (let i = 0; i < 12; i++) last = await req('POST', '/api/agent/connect', { body: { code: 'WRONG' + i } });
    assert.equal(last.status, 429);
  });
  await t.test('помощник без ключа не получает задач', async () => {
    assert.equal((await req('POST', '/api/agent/poll', { body: {}, headers: { Authorization: 'Bearer nope' } })).status, 401);
  });
});
