'use strict';
// Облачный компьютер в режиме CLOUD_RUNNER=local (без Docker): терминал и файлы через API, тарифы, границы папки,
// место на диске и инструменты computer_* в чате. Docker-режим проверяет scripts/cloud-check.sh.
const test = require('node:test'), assert = require('node:assert/strict'), http = require('http'), fs = require('fs'), path = require('path');
const { copyApp, seed, startServer, rm } = require('./helpers');

test('облачный компьютер: API, тарифы, границы папки и инструменты модели', async (t) => {
  let handler, requests = [];
  const mock = http.createServer((req, res) => {
    let data = ''; req.on('data', (b) => { data += b; });
    req.on('end', () => {
      const body = JSON.parse(data || '{}');
      if (!body.stream || !handler) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })); }
      requests.push(body); handler(body, res);
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const dir = copyApp();
  seed(dir, {
    users: [{ id: 'u1', login: 'anna', email: 'anna@example.com', plan: 'pro', until: Date.now() + 1e10 }, { id: 'u2', login: 'free', email: 'free@example.com' }],
    sessions: { tok1: 'u1', tok2: 'u2' },
  });
  fs.writeFileSync(dir + '/data/models.json', JSON.stringify([{ id: 'm1', name: 'Mock', modelId: 'mock', baseUrl: `http://127.0.0.1:${mock.address().port}`, apiKey: 'not-a-real-secret' }]));
  fs.writeFileSync(dir + '/data/settings.json', JSON.stringify({ browser: false, selfcheck: false, code: false }));
  const s = await startServer(dir, { CLOUD_RUNNER: 'local', MODEL_REQUEST_TIMEOUT_MS: '5000' });
  t.after(async () => { await s.stop(); await new Promise((r) => mock.close(r)); rm(dir); });
  const home = path.join(dir, 'data', 'cloud', 'u1');
  const run = (command, cwd) => s.req('POST', '/api/cloud/run', { token: 'tok1', body: { command, cwd } });
  const enc = encodeURIComponent;

  await t.test('доступ: только вошедшим и только на тарифе с местом', async () => {
    assert.equal((await s.req('GET', '/api/cloud/status')).status, 401);
    const free = await s.req('GET', '/api/cloud/status', { token: 'tok2' });
    assert.equal(free.json.ok, true); assert.equal(free.json.quotaMB, 0);
    assert.equal((await s.req('POST', '/api/cloud/run', { token: 'tok2', body: { command: 'echo hi' } })).status, 403);
    const pro = await s.req('GET', '/api/cloud/status', { token: 'tok1' });
    assert.equal(pro.json.quotaMB, 1024);
    const plans = await s.req('GET', '/api/plans');
    assert.equal(plans.json.cloud, true);
    assert.deepEqual(plans.json.plans.map((p) => p.pc), [0, 1024, 5120]);
  });

  await t.test('терминал: вывод, код завершения, запоминание cd', async () => {
    let r = await run('mkdir -p proj && cd proj && echo привет > a.txt && echo готово');
    assert.equal(r.json.code, 0); assert.equal(r.json.out, 'готово'); assert.equal(r.json.cwd, '~/proj');
    assert.equal(fs.readFileSync(path.join(home, 'proj/a.txt'), 'utf8'), 'привет\n');
    r = await run('cat a.txt; exit 3', '~/proj');
    assert.equal(r.json.code, 3); assert.match(r.json.out, /привет/);
    r = await run('ls', '~/nope');
    assert.equal(r.json.code, 127); assert.match(r.json.out, /папка не найдена/);
  });

  await t.test('файлы: список, загрузка и скачивание двоичных данных, удаление', async () => {
    const ls = await s.req('GET', '/api/cloud/files?path=' + enc('~/proj'), { token: 'tok1' });
    assert.equal(ls.json.path, '~/proj'); assert.deepEqual(ls.json.entries.map((e) => [e.name, e.dir, e.size]), [['a.txt', false, 13]]);
    const bin = Buffer.from([0, 1, 2, 255, 254, 10, 13, 0xd0, 0x9f]);
    const up = await fetch(`${s.base}/api/cloud/upload?dir=${enc('~/proj')}&name=${enc('данные.bin')}`, { method: 'POST', headers: { Cookie: 'premier_session=tok1' }, body: bin });
    assert.equal(up.status, 200, await up.clone().text());
    const dl = await fetch(`${s.base}/api/cloud/file?path=${enc('~/proj/данные.bin')}`, { headers: { Cookie: 'premier_session=tok1' } });
    assert.equal(dl.status, 200); assert.match(dl.headers.get('content-disposition'), /^attachment/);
    assert.deepEqual(Buffer.from(await dl.arrayBuffer()), bin);
    assert.equal((await s.req('POST', '/api/cloud/delete', { token: 'tok1', body: { path: '~/proj/данные.bin' } })).status, 200);
    assert.equal(fs.existsSync(path.join(home, 'proj/данные.bin')), false);
  });

  await t.test('нельзя выйти за пределы своей папки и удалить её целиком', async () => {
    fs.mkdirSync(path.join(dir, 'data', 'cloud', 'u2'), { recursive: true }); fs.writeFileSync(path.join(dir, 'data', 'cloud', 'u2', 'secret.txt'), 'x');
    let r = await s.req('GET', '/api/cloud/file?path=' + enc('../u2/secret.txt'), { token: 'tok1' });
    assert.equal(r.status, 400); assert.match(r.json.error, /вне облачного компьютера/);
    fs.symlinkSync(path.join(dir, 'data'), path.join(home, 'link'));
    r = await s.req('GET', '/api/cloud/files?path=' + enc('~/link'), { token: 'tok1' });
    assert.equal(r.status, 400); assert.match(r.json.error, /вне облачного компьютера/);
    r = await s.req('POST', '/api/cloud/delete', { token: 'tok1', body: { path: '~' } });
    assert.equal(r.status, 400); assert.match(r.json.error, /домашнюю папку/);
    fs.unlinkSync(path.join(home, 'link'));
  });

  await t.test('тариф закончился: файлы можно смотреть, скачивать и удалять, но не запускать и не загружать', async () => {
    const st = await s.req('GET', '/api/cloud/status', { token: 'tok2' });
    assert.equal(st.json.quotaMB, 0); assert.equal(st.json.files, true);
    assert.deepEqual((await s.req('GET', '/api/cloud/files?path=~', { token: 'tok2' })).json.entries.map((e) => e.name), ['secret.txt']);
    const dl = await fetch(`${s.base}/api/cloud/file?path=${enc('~/secret.txt')}`, { headers: { Cookie: 'premier_session=tok2' } });
    assert.equal(dl.status, 200); assert.equal(await dl.text(), 'x');
    assert.equal((await s.req('POST', '/api/cloud/run', { token: 'tok2', body: { command: 'ls' } })).status, 403);
    const up = await fetch(`${s.base}/api/cloud/upload?dir=~&name=a.txt`, { method: 'POST', headers: { Cookie: 'premier_session=tok2' }, body: 'a' });
    assert.equal(up.status, 403);
    assert.equal((await s.req('POST', '/api/cloud/delete', { token: 'tok2', body: { path: '~/secret.txt' } })).status, 200);
  });

  await t.test('чат: модель пишет файл и запускает команду инструментами computer_*', async () => {
    handler = (body, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const tc = (name, args) => res.end('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + requests.length, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] }) + '\n\n');
      if (requests.length === 1) return tc('computer_write', { path: '~/app/hello.py', content: 'print(6 * 7)\n' });
      if (requests.length === 2) return tc('computer_run', { command: 'python3 hello.py', cwd: '~/app' });
      res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Готово: ~/app/hello.py печатает 42.' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n');
    };
    requests = [];
    const r = await s.req('POST', '/api/chat', { token: 'tok1', body: { model: 'm1', messages: [{ role: 'user', content: 'напиши скрипт и запусти' }], cloud: true } });
    assert.equal(r.status, 200, r.text);
    const ev = r.text.trim().split('\n').map((l) => JSON.parse(l));
    const names = requests[0].tools.map((x) => x.function.name);
    assert.ok(names.includes('computer_run') && names.includes('computer_write') && !names.includes('computer_open'));
    assert.match(requests[0].messages[0].content, /ОБЛАЧНЫЙ КОМПЬЮТЕР/);
    assert.equal(fs.readFileSync(path.join(home, 'app/hello.py'), 'utf8'), 'print(6 * 7)\n');
    const ops = ev.filter((e) => e.ag).map((e) => [e.ag.name, e.ag.ask]);
    assert.deepEqual(ops, [['computer_write', false], ['computer_run', false]]);
    const runRes = ev.filter((e) => e.agres?.state === 'ok').map((e) => e.agres.out);
    assert.match(runRes[1], /^Код завершения 0 · [\d.]+ с · папка ~\/app\n42$/);
    const toolMsg = requests[2].messages.filter((m) => m.role === 'tool').map((m) => m.content);
    assert.match(toolMsg[0], /^Готово: ~\/app\/hello\.py создан/);
  });

  await t.test('без cloud: true и на бесплатном тарифе инструментов нет', async () => {
    handler = (body, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n'); };
    for (const [token, cloud] of [['tok1', false], ['tok2', true]]) {
      requests = [];
      const r = await s.req('POST', '/api/chat', { token, body: { model: 'm1', messages: [{ role: 'user', content: 'привет' }], cloud } });
      assert.equal(r.status, 200, r.text);
      assert.ok(!(requests[0].tools || []).some((x) => x.function.name.startsWith('computer_')), token);
    }
  });

  await t.test('место закончилось: запись и команды останавливаются, удаление работает', async () => {
    process.env.CLOUD_RUNNER = 'local';
    const cloud = require(path.join(dir, 'cloud.js')); // тот же код в процессе теста, квота 1 МБ
    fs.writeFileSync(path.join(home, 'big.bin'), Buffer.alloc(2 * 1048576, 1));
    const w = await cloud.call('u1', 1, 'computer_write', { path: 'x.txt', content: 'x' });
    assert.match(w, /^Ошибка: место в облачном компьютере закончилось \(2 МБ из 1 МБ\)/);
    assert.match(await cloud.call('u1', 1, 'computer_run', { command: 'echo hi' }), /^Ошибка: место/);
    assert.match(await cloud.call('u1', 1, 'computer_delete', { path: 'big.bin' }), /^Готово: удалён файл ~\/big\.bin/);
    assert.match(await cloud.call('u1', 1, 'computer_run', { command: 'echo hi' }), /^Код завершения 0 · .*\nhi$/);
    const bg = await cloud.call('u1', 1, 'computer_run', { command: 'echo start; sleep 30', background: true });
    assert.match(bg, /^Запущено в фоне \(pid \d+\) в ~\. Журнал: ~\/\.premier\/logs\/\S+\.log\nВывод за первые секунды:\nstart$/);
    process.kill(-+/pid (\d+)/.exec(bg)[1], 'SIGKILL');
  });
});
