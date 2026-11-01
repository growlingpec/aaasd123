'use strict';
// Облачный компьютер в режиме CLOUD_RUNNER=local (без Docker): терминал и файлы через API, тарифы, границы папки,
// место на диске и инструменты computer_* в чате. Docker-режим проверяет scripts/cloud-check.sh.
const test = require('node:test'), assert = require('node:assert/strict'), http = require('http'), net = require('net'), fs = require('fs'), path = require('path');
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
    users: [{ id: 'u1', login: 'anna', email: 'anna@example.com', plan: 'pro', until: Date.now() + 1e10 }, { id: 'u2', login: 'free', email: 'free@example.com' }, { id: 'u3', login: 'trial', email: 'trial@example.com', plan: 'pro', until: Date.now() + 1e10, trial: true }],
    sessions: { tok1: 'u1', tok2: 'u2', tok3: 'u3' },
  });
  fs.writeFileSync(dir + '/data/models.json', JSON.stringify([{ id: 'm1', name: 'Mock', modelId: 'mock', baseUrl: `http://127.0.0.1:${mock.address().port}`, apiKey: 'not-a-real-secret' }]));
  fs.writeFileSync(dir + '/data/settings.json', JSON.stringify({ browser: false, selfcheck: false, code: false }));
  // превью сайтов — на «другом» адресе того же сервера: localhost вместо 127.0.0.1 (своя cookie, другой origin)
  const s = await startServer(dir, (port) => ({ CLOUD_RUNNER: 'local', MODEL_REQUEST_TIMEOUT_MS: '5000', CLOUD_PREVIEW_URL: 'http://localhost:' + port }));
  const pv = s.base.replace('127.0.0.1', 'localhost');
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

  await t.test('сайты: превью на отдельном адресе, только у владельца, с WebSocket', async () => {
    const app = http.createServer((req, res) => {
      if (req.url === '/go') { res.writeHead(302, { Location: `http://localhost:${app.address().port}/target` }); return res.end(); }
      let body = ''; req.on('data', (d) => (body += d));
      req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ method: req.method, url: req.url, host: req.headers.host, cookie: req.headers.cookie || '', fwd: req.headers['x-forwarded-host'], body })); });
    }).on('upgrade', (req, sock) => { sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'); sock.on('data', (d) => sock.write('echo:' + d)); });
    await new Promise((r) => app.listen(0, '0.0.0.0', r));
    const lo = http.createServer((q, r) => r.end('lo')); await new Promise((r) => lo.listen(0, '127.0.0.1', r));
    t.after(() => { app.close(); lo.close(); });
    const port = app.address().port, get = (u, h = {}) => fetch(u, { redirect: 'manual', headers: h });

    const ports = (await s.req('GET', '/api/cloud/ports', { token: 'tok1' })).json;
    assert.equal(ports.preview, true);
    assert.deepEqual(ports.ports.find((p) => p.port === port), { port });
    assert.deepEqual(ports.ports.find((p) => p.port === lo.address().port), { port: lo.address().port });
    assert.equal((await s.req('GET', '/api/cloud/open?port=' + port)).status, 401);
    assert.equal((await s.req('GET', '/api/cloud/open?port=' + port, { token: 'tok2' })).status, 403);
    assert.equal((await s.req('GET', '/api/cloud/open?port=80', { token: 'tok1' })).status, 400);

    const open = await s.req('GET', '/api/cloud/open?port=' + port, { token: 'tok1' });
    assert.equal(open.status, 302);
    const link = open.headers.get('location'); assert.match(link, new RegExp('^' + pv + '/__premier/open\\?t=[a-f0-9]{48}$'));
    assert.equal((await get(pv + '/')).status, 401); // без входа — ничего
    const login = await get(link); assert.equal(login.status, 302); assert.equal(login.headers.get('location'), '/');
    const ck = login.headers.get('set-cookie'); assert.match(ck, /^premier_pc=[a-f0-9]+\.[a-f0-9]+; Path=\/; HttpOnly; SameSite=Lax/);
    assert.equal((await get(link)).status, 403); // ссылка одноразовая
    const cookie = ck.split(';')[0] + '; theme=dark';

    let r = await get(pv + '/chat?x=1', { Cookie: cookie }); // любые пути — к сайту, а не к Premier
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { method: 'GET', url: '/chat?x=1', host: 'localhost:' + port, cookie: 'theme=dark', fwd: new URL(pv).host, body: '' });
    r = await fetch(pv + '/api/form', { method: 'POST', headers: { Cookie: cookie }, body: 'a=1' });
    assert.equal((await r.json()).body, 'a=1');
    r = await get(pv + '/go', { Cookie: cookie }); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/target');
    assert.equal((await get(pv + '/', { Cookie: cookie.replace(/\.[a-f0-9]+/, '.00') })).status, 401);
    assert.equal((await get(pv + '/', { Cookie: 'premier_session=tok1' })).status, 401); // cookie Premier там не действует

    // API Premier не принимает запросы со страниц превью
    r = await fetch(s.base + '/api/memory', { method: 'POST', headers: { Cookie: 'premier_session=tok1', Origin: pv, 'Content-Type': 'application/json' }, body: '{"text":"x"}' });
    assert.equal(r.status, 403);
    r = await fetch(s.base + '/api/memory', { method: 'POST', headers: { Cookie: 'premier_session=tok1', Origin: s.base, 'Content-Type': 'application/json' }, body: '{"on":false}' });
    assert.equal(r.status, 200);

    const echo = await new Promise((ok, fail) => {
      const sock = net.connect(+new URL(pv).port, '127.0.0.1', () => sock.write(`GET /ws HTTP/1.1\r\nHost: ${new URL(pv).host}\r\nCookie: ${cookie}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`));
      let got = ''; sock.on('data', (d) => { got += d; if (got.includes('\r\n\r\n') && !got.includes('echo:')) sock.write('ping'); if (got.includes('echo:ping')) { sock.destroy(); ok(got); } });
      sock.on('error', fail); setTimeout(() => fail(new Error('нет ответа: ' + got)), 5000);
    });
    assert.match(echo, /^HTTP\/1\.1 101 /);

    const dead = await s.req('GET', '/api/cloud/open?port=1', { token: 'tok1' });
    assert.equal(dead.status, 400);
    const free = await new Promise((ok) => { const x = net.createServer().listen(0, () => { const p = x.address().port; x.close(() => ok(p)); }); });
    const l2 = (await s.req('GET', '/api/cloud/open?port=' + free, { token: 'tok1' })).headers.get('location');
    const c2 = (await get(l2)).headers.get('set-cookie').split(';')[0];
    r = await get(pv + '/', { Cookie: c2 }); assert.equal(r.status, 502); assert.match(await r.text(), /На порту \d+ ничего не отвечает/);
  });

  await t.test('терминал: интерактивный bash через WebSocket', async () => {
    const ws = (headers) => new WebSocket(s.base.replace('http', 'ws') + '/api/cloud/tty?cols=90&rows=20', { headers });
    const refused = (sock) => new Promise((ok) => { sock.onopen = () => ok(false); sock.onerror = () => ok(true); });
    assert.equal(await refused(ws({ Cookie: 'premier_session=tok1', Origin: 'http://evil.example' })), true);
    assert.equal(await refused(ws({ Cookie: 'premier_session=tok2' })), true); // тариф без облака
    assert.equal(await refused(ws({ Cookie: 'premier_session=tok1', Origin: pv })), true); // и не со страницы превью
    const c = ws({ Cookie: 'premier_session=tok1', Origin: s.base });
    c.binaryType = 'arraybuffer';
    let out = ''; const dec = new TextDecoder();
    c.onmessage = (e) => { out += typeof e.data === 'string' ? e.data : dec.decode(e.data, { stream: true }); };
    const until = (re) => new Promise((ok, fail) => { const t0 = Date.now(), iv = setInterval(() => { if (re.test(out)) { clearInterval(iv); ok(); } else if (Date.now() - t0 > 8000) { clearInterval(iv); fail(new Error('нет ' + re + ' в выводе:\n' + out.slice(-500))); } }, 30); });
    await new Promise((ok, fail) => { c.onopen = ok; c.onerror = fail; });
    const type = (d) => c.send(JSON.stringify({ d }));
    type('echo "$((6*7))-ok"; tty; stty size; pwd\r');
    await until(/42-ok\r?\n\/dev\/pts\/\d+\r?\n20 90\r?\n/);
    assert.match(out, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    c.send(JSON.stringify({ r: [120, 40] })); type('stty size\r'); await until(/40 120/);
    type('python3 -q\r'); await until(/>>> $/); type('2**10\r'); await until(/1024\r?\n>>> $/); type('exit()\r');
    const closed = new Promise((ok) => (c.onclose = ok)); type('exit\r'); await closed;
  });

  await t.test('корзина: удаление, восстановление, конфликт имён, ссылки, срок хранения', async () => {
    await s.req('POST', '/api/cloud/trash/delete', { token: 'tok1', body: { all: true } }); // там уже файл из теста «файлы»
    await run('mkdir -p proj2/sub && echo a > proj2/a.txt && echo b > proj2/sub/b.txt && echo r > rep.txt && ln -sfn /etc etclink');
    const del = (p, token = 'tok1') => s.req('POST', '/api/cloud/delete', { token, body: { path: p } });
    const trash = async () => (await s.req('GET', '/api/cloud/trash', { token: 'tok1' })).json;
    let r = await del('~/proj2'); assert.equal(r.status, 200, r.text); assert.match(r.json.out, /^Готово: ~\/proj2 в корзине/);
    assert.equal(fs.existsSync(path.join(home, 'proj2')), false);
    let tr = await trash(); assert.equal(tr.days, 7);
    assert.deepEqual(tr.items.map((x) => [x.name, x.from, x.dir, x.size > 0]), [['proj2', '~/proj2', true, true]]);
    assert.equal((await del('~/rep.txt')).status, 200);
    fs.writeFileSync(path.join(home, 'rep.txt'), 'new');
    const rep = (await trash()).items.find((x) => x.name === 'rep.txt');
    r = await s.req('POST', '/api/cloud/trash/restore', { token: 'tok1', body: { id: rep.id } });
    assert.equal(r.json.path, '~/rep (восстановлено).txt');
    assert.equal(fs.readFileSync(path.join(home, 'rep (восстановлено).txt'), 'utf8'), 'r\n'); assert.equal(fs.readFileSync(path.join(home, 'rep.txt'), 'utf8'), 'new');
    r = await s.req('POST', '/api/cloud/trash/restore', { token: 'tok1', body: { id: (await trash()).items[0].id } });
    assert.equal(r.json.path, '~/proj2'); assert.equal(fs.readFileSync(path.join(home, 'proj2/sub/b.txt'), 'utf8'), 'b\n');
    // ссылка наружу: удалить сквозь неё нельзя, сама ссылка уходит в корзину, а цель остаётся
    r = await del('~/etclink/hostname'); assert.equal(r.status, 400); assert.match(r.json.error, /не найден/);
    assert.equal((await del('~/etclink')).status, 200); assert.ok(fs.existsSync('/etc/hostname'));
    r = await del('~'); assert.equal(r.status, 400); assert.match(r.json.error, /домашнюю папку/);
    assert.equal((await del('../u2/x')).status, 400);
    // срок: запись старше 7 дней исчезает при следующем удалении
    const old = (await trash()).items.find((x) => x.name === 'etclink'), mp = path.join(dir, 'data', 'cloud-trash', 'u1', old.id, 'meta.json');
    fs.writeFileSync(mp, JSON.stringify({ ...JSON.parse(fs.readFileSync(mp, 'utf8')), at: Date.now() - 8 * 864e5 }));
    await run('echo x > tmp1.txt'); await del('~/tmp1.txt');
    assert.deepEqual((await trash()).items.map((x) => x.name), ['tmp1.txt']);
    // удаление инструментом модели — тоже в корзину
    process.env.CLOUD_RUNNER = 'local'; // до require: режим читается при загрузке модуля
    const cloudMod = require(path.join(dir, 'cloud.js'));
    assert.match(await cloudMod.call('u1', 1024, 'computer_delete', { path: 'rep (восстановлено).txt' }), /^Готово: ~\/rep \(восстановлено\)\.txt в корзине/);
    assert.equal((await s.req('POST', '/api/cloud/trash/delete', { token: 'tok1', body: { all: true } })).status, 200);
    assert.deepEqual((await trash()).items, []);
    assert.equal((await s.req('GET', '/api/cloud/trash', { token: 'tok2' })).status, 200); // после тарифа корзину видно
    assert.equal((await s.req('POST', '/api/cloud/trash/restore', { token: 'tok2', body: { id: 'x' } })).status, 403);
  });

  await t.test('публикация папки: постоянная ссылка, пути от корня, скрытые файлы, SPA, обновление и снятие', async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    fs.mkdirSync(path.join(home, 'site2/img'), { recursive: true }); fs.mkdirSync(path.join(home, 'site2/about'), { recursive: true }); fs.mkdirSync(path.join(home, 'site2/node_modules'), { recursive: true });
    fs.writeFileSync(path.join(home, 'site2/index.html'), '<!doctype html><title>Кофейня</title><link rel="stylesheet" href="/style.css"><a href="/about/">о нас</a><a href="//cdn.example/x.js">cdn</a><h1>v1</h1>');
    fs.writeFileSync(path.join(home, 'site2/style.css'), 'body{background:url(/img/bg.png)}');
    fs.writeFileSync(path.join(home, 'site2/img/bg.png'), png);
    fs.writeFileSync(path.join(home, 'site2/about/index.html'), '<h1>О нас</h1>');
    fs.writeFileSync(path.join(home, 'site2/.env'), 'TOKEN=secret'); fs.writeFileSync(path.join(home, 'site2/node_modules/x.js'), 'x');
    fs.symlinkSync('/etc/hostname', path.join(home, 'site2/leak.txt'));
    const pub = (p, token = 'tok1') => s.req('POST', '/api/cloud/sites', { token, body: { path: p } });
    let r = await pub('~/site2'); assert.equal(r.status, 200, r.text);
    const { id } = r.json; assert.match(id, /^[a-f0-9]{10}$/);
    assert.deepEqual({ ...r.json, bytes: undefined }, { id, path: '/s/' + id, title: 'Кофейня', src: '~/site2', files: 4, bytes: undefined, updated: false, branding: false });
    r = await s.req('GET', '/s/' + id); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), `/s/${id}/`);
    r = await s.req('GET', `/s/${id}/`); assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /^sandbox allow-scripts/); assert.doesNotMatch(r.headers.get('content-security-policy'), /frame-ancestors/);
    assert.ok(r.text.includes(`href="/s/${id}/style.css"`) && r.text.includes(`href="/s/${id}/about/"`) && r.text.includes('href="//cdn.example/x.js"'));
    r = await s.req('GET', `/s/${id}/style.css`); assert.equal(r.text, `body{background:url(/s/${id}/img/bg.png)}`); assert.match(r.headers.get('content-type'), /^text\/css/);
    const img = await fetch(`${s.base}/s/${id}/img/bg.png`); assert.equal(img.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await img.arrayBuffer()), png);
    r = await s.req('GET', `/s/${id}/about`); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), `/s/${id}/about/`);
    assert.equal((await s.req('GET', `/s/${id}/about/`)).text, '<h1>О нас</h1>');
    for (const bad of ['.env', 'node_modules/x.js', 'leak.txt', '%2e%2e/' + id + '.json', 'img/../../' + id + '.json']) assert.equal((await s.req('GET', `/s/${id}/${bad}`)).status, 404, bad);
    assert.match((await s.req('GET', `/s/${id}/menu/today`)).text, /<h1>v1<\/h1>/); // маршрут SPA → index.html
    assert.equal((await s.req('PUT', `/s/${id}/`)).status, 405);
    // повторная публикация — та же ссылка, новое содержимое
    fs.writeFileSync(path.join(home, 'site2/index.html'), '<title>Кофейня</title><h1>v2</h1>');
    r = await pub('~/site2'); assert.equal(r.json.id, id); assert.equal(r.json.updated, true);
    assert.match((await s.req('GET', `/s/${id}/`)).text, /v2/);
    assert.deepEqual((await s.req('GET', '/api/cloud/sites', { token: 'tok1' })).json.sites.map((x) => [x.id, x.title, x.src]), [[id, 'Кофейня', '~/site2']]);
    // ошибки
    assert.match((await pub('~/proj2')).json.error, /нет index\.html/);
    assert.match((await pub('/etc')).json.error, /только папку внутри ~/);
    assert.equal((await pub('~/../u2')).status, 400);
    assert.match((await pub('~/site2/index.html')).json.error, /нужна папка/);
    assert.equal((await pub('~/site2', 'tok2')).status, 403); // без облачного компьютера
    // пробный период — с плашкой: обёртка Premier, страницы только внутри неё
    fs.mkdirSync(path.join(dir, 'data/cloud/u3/web'), { recursive: true }); fs.writeFileSync(path.join(dir, 'data/cloud/u3/web/index.html'), '<h1>trial</h1>'); fs.writeFileSync(path.join(dir, 'data/cloud/u3/web/app.js'), 'x');
    r = await pub('~/web', 'tok3'); assert.equal(r.json.branding, true); const tid = r.json.id;
    r = await s.req('GET', '/s/' + tid); assert.equal(r.status, 200); assert.ok(r.text.includes(`src="/s/${tid}/"`) && r.text.includes('premier-promo'));
    r = await s.req('GET', `/s/${tid}/`); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/s/' + tid);
    r = await s.req('GET', `/s/${tid}/`, { headers: { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(r.text, '<h1>trial</h1>'); assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self'$/);
    assert.equal((await s.req('GET', `/s/${tid}/app.js`)).status, 200);
    // снять может только владелец
    assert.equal((await s.req('DELETE', '/api/cloud/sites/' + tid, { token: 'tok1' })).status, 404);
    assert.equal((await s.req('DELETE', '/api/cloud/sites/' + tid, { token: 'tok3' })).status, 200);
    assert.equal((await s.req('GET', `/s/${tid}/`)).status, 404);
    // сайт из чата (один HTML): вложенные пути — обычный 404, без зависания
    const single = (await s.req('POST', '/api/publish', { token: 'tok1', body: { html: '<h1>one</h1>' } })).json;
    assert.equal((await s.req('GET', single.path + '/x.css')).status, 404);
  });

  await t.test('чат: модель публикует папку после подтверждения пользователя', async () => {
    handler = (body, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (!body.messages.some((m) => m.role === 'tool')) return res.end('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_pub', function: { name: 'computer_publish', arguments: JSON.stringify({ path: '~/site2' }) } }] }, finish_reason: 'tool_calls' }] }) + '\n\n');
      res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Опубликовал.' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n');
    };
    requests = [];
    const resp = await fetch(s.base + '/api/chat', { method: 'POST', headers: { Cookie: 'premier_session=tok1', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'm1', messages: [{ role: 'user', content: 'опубликуй сайт' }], cloud: true }) });
    const reader = resp.body.getReader(), dec = new TextDecoder(), ev = []; let buf = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
        const e = JSON.parse(line); ev.push(e);
        if (e.ag?.ask) assert.equal((await s.req('POST', '/api/chat/agent', { token: 'tok1', body: { cid: e.ag.cid, ok: true } })).status, 200);
      }
    }
    assert.ok(requests[0].tools.some((x) => x.function.name === 'computer_publish')); assert.match(requests[0].messages[0].content, /computer_publish/);
    const ag = ev.find((e) => e.ag); assert.deepEqual([ag.ag.name, ag.ag.ask, ag.ag.write], ['computer_publish', true, true]);
    const ok = ev.find((e) => e.agres?.state === 'ok'); assert.match(ok.agres.url, /^\/s\/[a-f0-9]{10}$/);
    assert.match(requests[1].messages.find((m) => m.role === 'tool').content, new RegExp(`^Готово: сайт обновлён — ${s.base.replace(/[.]/g, '\\.')}/s/[a-f0-9]{10} \\(4 файл\\.`));
  });

  await t.test('место закончилось: запись и команды останавливаются, удаление работает', async () => {
    process.env.CLOUD_RUNNER = 'local';
    const cloud = require(path.join(dir, 'cloud.js')); // тот же код в процессе теста, квота 1 МБ
    fs.writeFileSync(path.join(home, 'big.bin'), Buffer.alloc(2 * 1048576, 1));
    const w = await cloud.call('u1', 1, 'computer_write', { path: 'x.txt', content: 'x' });
    assert.match(w, /^Ошибка: место в облачном компьютере закончилось \(2 МБ из 1 МБ\)/);
    assert.match(await cloud.call('u1', 1, 'computer_run', { command: 'echo hi' }), /^Ошибка: место/);
    // корзина лежит вне квоты — удаление освобождает место
    assert.match(await cloud.call('u1', 1, 'computer_delete', { path: 'big.bin' }), /^Готово: ~\/big\.bin в корзине/);
    assert.match(await cloud.call('u1', 1, 'computer_run', { command: 'echo hi' }), /^Код завершения 0 · .*\nhi$/);
    const bg = await cloud.call('u1', 1, 'computer_run', { command: 'echo start; sleep 30', background: true });
    assert.match(bg, /^Запущено в фоне \(pid \d+\) в ~\. Журнал: ~\/\.premier\/logs\/\S+\.log\nВывод за первые секунды:\nstart$/);
    process.kill(-+/pid (\d+)/.exec(bg)[1], 'SIGKILL');
  });
});
