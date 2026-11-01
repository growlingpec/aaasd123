'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), http = require('http'), fs = require('fs');
const { copyApp, seed, startServer, rm } = require('./helpers');
const state = require('../public/js/00-artifact-state');
const code = '<!doctype html><html><head><title>Поле</title></head><body><script>\n' +
  'const terrainSeed = 123;\nconst cameraSpeed = 5;\nconst grassDensity = 100;\n' +
  'document.body.onkeydown = function WASD(event) { console.log(event.key); };\n' +
  '</script><main>Существующая игра со своим небом, интерфейсом и ландшафтом</main></body></html>\n';
const SOURCE = '```html\n' + code + '```';
const PATCH = JSON.stringify({ edits: [{ path: 'index.html', old: 'const grassDensity = 100;', new: 'const grassDensity = 500;' }] });
const user = (content) => ({ role: 'user', content });
const emit = (res, content) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end('data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n');
};
const readText = (events) => events.reduce((s, e) => e.reset ? '' : s + (e.t || ''), '');
const diag = (events) => events.find((e) => e.diag)?.diag;

test('редактирование: закреплённая версия и реальный протокол HTTP', async (t) => {
  let requests = [], handler;
  const mock = http.createServer((req, res) => {
    let text = ''; req.on('data', (b) => { text += b; });
    req.on('end', () => { const body = JSON.parse(text); requests.push(body); handler(body, res); });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const dir = copyApp();
  seed(dir, { users: [{ id: 'u1', login: 'anna', plan: 'max', until: Date.now() + 1e10 }] });
  fs.writeFileSync(dir + '/data/models.json', JSON.stringify([{ id: 'm1', name: 'Edit Mock', modelId: 'mock', baseUrl: `http://127.0.0.1:${mock.address().port}`, apiKey: 'test', vision: true }]));
  fs.writeFileSync(dir + '/data/settings.json', JSON.stringify({ browser: true, selfcheck: true, code: false, provider: 'off' }));
  // Браузерная проверка в этом серверном тесте не должна запускать ещё одну генерацию.
  // Настоящий Chromium отдельно проверяется smoke-тестами.
  fs.writeFileSync(dir + '/browser.js', 'module.exports={available:()=>true,checkHtml:async()=>({issues:["тестовая ошибка ресурса"],shots:[]}),close:async()=>{}};');
  const s = await startServer(dir, { MODEL_REQUEST_TIMEOUT_MS: '1000' });
  t.after(async () => { await s.stop(); await new Promise((r) => mock.close(r)); rm(dir); });
  const call = async (messages, currentArtifact = { source: SOURCE }) => {
    requests = [];
    const r = await s.req('POST', '/api/chat', { token: 'tok1', body: { model: 'm1', messages, ...(currentArtifact === null ? {} : { currentArtifact }) } });
    return { ...r, events: r.status === 200 ? r.text.trim().split('\n').map((line) => JSON.parse(line)) : [] };
  };
  const balance = async () => (await s.req('GET', '/api/billing', { token: 'tok1' })).json.used;
  await t.test('пять формулировок про траву дают точечную правку без пересоздания', async () => {
    handler = (body, res) => emit(res, PATCH);
    for (const request of ['доработай траву', 'доработать траву', 'улучши траву', 'измени траву', 'сделай траву гуще']) {
      const before = await balance(), r = await call([user(request)]);
      assert.equal(r.status, 200, r.text);
      assert.equal(diag(r.events).artifactMode, 'edit');
      assert.equal(diag(r.events).editCount, 1);
      assert.equal(requests.length, 1);
      const result = state.latest(readText(r.events));
      assert.equal(result.files[0].code, code.replace('grassDensity = 100', 'grassDensity = 500'));
      assert.ok(!r.events.some((e) => e.t?.includes('"edits"')), 'JSON правок не должен показываться пользователю вместо игры');
      assert.ok(requests[0].messages[0].content.includes('РЕЖИМ ТОЧЕЧНОЙ ПРАВКИ'));
      assert.ok(requests[0].messages.at(-2).content.includes(SOURCE));
      assert.equal(r.events.findLast((e) => e.bill).bill.used.s, before.s, 'Правка не расходует лимит создания новых сайтов');
      assert.ok(r.events.some((e) => e.s === 'fail' && /браузер нашёл/.test(e.q)), 'Проблемы браузера должны сообщаться');
    }
  });
  await t.test('сорок сообщений не вытесняют отдельно закреплённый код', async () => {
    handler = (body, res) => emit(res, PATCH);
    const conversation = Array.from({ length: 45 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'Разговор ' + i }));
    const r = await call([...conversation, user('улучши траву')]);
    assert.equal(diag(r.events).artifactMode, 'edit');
    assert.ok(requests[0].messages.at(-2).content.includes('terrainSeed = 123'));
  });
  await t.test('старый клиент: поиск HTML до обрезки истории', async () => {
    handler = (body, res) => emit(res, PATCH);
    const conversation = [{ role: 'assistant', content: SOURCE }, ...Array.from({ length: 45 }, (_, i) => user('Разговор ' + i)), user('доработай траву')];
    const r = await call(conversation, null);
    assert.equal(diag(r.events).artifactMode, 'edit');
    assert.ok(requests[0].messages.at(-2).content.includes(SOURCE));
  });
  await t.test('явно выбранная старая версия важнее последнего кода в истории', async () => {
    handler = (body, res) => emit(res, PATCH);
    const latest = SOURCE.replace('terrainSeed = 123', 'terrainSeed = 999');
    const r = await call([{ role: 'assistant', content: SOURCE }, { role: 'assistant', content: latest }, user('доработай траву')]);
    assert.ok(requests[0].messages.at(-2).content.includes('terrainSeed = 123'));
    assert.ok(!requests[0].messages.some((m) => typeof m.content === 'string' && m.content.includes('terrainSeed = 999')));
    assert.ok(readText(r.events).includes('terrainSeed = 123'));
  });
  await t.test('явное «с нуля» включает создание и не требует JSON правок', async () => {
    handler = (body, res) => emit(res, SOURCE.replace('terrainSeed = 123', 'terrainSeed = 777'));
    const r = await call([user('сделай новую игру с нуля')]);
    assert.equal(diag(r.events).artifactMode, 'create');
    assert.equal(diag(r.events).editCount, undefined);
    assert.ok(!requests[0].messages[0].content.includes('РЕЖИМ ТОЧЕЧНОЙ ПРАВКИ'));
    assert.ok(!requests[0].messages.some((m) => typeof m.content === 'string' && m.content.startsWith('[Текущая закреплённая версия')));
    assert.ok(readText(r.events).includes('terrainSeed = 777'));
  });
  await t.test('HTML вместо правок: один повтор, не новая игра', async () => {
    handler = (body, res) => emit(res, requests.length === 1 ? SOURCE.replace('123', '999') : PATCH);
    const before = await balance(), r = await call([user('доработай траву')]);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].tools, undefined);
    assert.equal(diag(r.events).repairs, 1);
    assert.equal(r.events.findLast((e) => e.bill).bill.used.m, before.m + 1);
    assert.ok(!readText(r.events).includes('terrainSeed = 999'));
  });
  await t.test('два невалидных ответа отклоняются: нет HTML и исходная версия не изменена', async () => {
    handler = (body, res) => emit(res, SOURCE.replace('123', '999'));
    const r = await call([user('улучши траву')]);
    assert.equal(requests.length, 2);
    assert.equal(diag(r.events).outcome, 'edit_rejected');
    assert.ok(r.events.some((e) => /исходная версия сохранена/.test(e.e || '')));
    assert.equal(readText(r.events), '');
  });
  await t.test('уточнение не применяется как код и не вызывает автоматический повтор', async () => {
    handler = (body, res) => emit(res, 'Уточните, нужна густая или высокая трава?');
    const r = await call([user('улучши траву')]);
    assert.equal(requests.length, 1);
    assert.equal(diag(r.events).outcome, 'needs_clarification');
    assert.match(readText(r.events), /Уточните/);
  });
  await t.test('невалидная/слишком большая версия не обрезается и не отправляется модели', async () => {
    for (const supplied of [{ source: '```html\n<html>' }, { source: 'x'.repeat(state.MAX_SOURCE + 1) }]) {
      const r = await call([user('доработай траву')], supplied);
      assert.equal(r.status, 400);
      assert.equal(requests.length, 0);
      assert.equal(r.json.code, 'artifact_context');
    }
  });
  await t.test('правка без исходного кода не создаёт игру наугад и не списывает сообщение', async () => {
    const before = await balance();
    const r = await call([user('создай игру'), { role: 'assistant', content: 'Сделаю!' }, user('доработай траву')], null);
    assert.equal(r.status, 409);
    assert.equal(requests.length, 0);
    assert.equal((await balance()).m, before.m);
  });
  await t.test('обычный вопрос не редактирует закреплённую игру', async () => {
    handler = (body, res) => emit(res, 'Нужно уменьшить число полигонов.');
    const r = await call([user('почему игра тормозит?')]);
    assert.equal(diag(r.events).artifactMode, null);
    assert.ok(!requests[0].messages.some((m) => typeof m.content === 'string' && m.content.startsWith('[Текущая закреплённая версия')));
    assert.match(readText(r.events), /полигонов/);
  });
  await t.test('исчерпанный лимит новых сайтов не запрещает правку и её единственный повтор', async () => {
    const login = await s.req('POST', '/api/admin/login', { body: { password: 'Test-Admin-Pass-2026' } });
    const headers = { Authorization: 'Bearer ' + login.json.token };
    const configured = await s.req('POST', '/api/admin/plans', { headers, body: { plans: [{ id: 'max', sites: 0 }] } });
    assert.equal(configured.status, 200);
    handler = (body, res) => emit(res, requests.length === 1 ? 'Сделаю!' : PATCH);
    const before = await balance(), r = await call([user('доработай траву')]);
    assert.equal(r.status, 200);
    assert.equal(requests.length, 2);
    assert.equal(diag(r.events).outcome, 'complete');
    assert.equal(diag(r.events).editCount, 1);
    assert.equal(r.events.findLast((e) => e.bill).bill.used.s, before.s);
  });
});