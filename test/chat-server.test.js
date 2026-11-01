'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), http = require('http'), fs = require('fs');
const { copyApp, seed, startServer, rm } = require('./helpers');
const HTML = '```html\n<!doctype html><html><head><title>Игра</title></head><body><canvas id="game"></canvas><script>document.body.onkeydown=()=>{};</script></body></html>\n```';
const user = (content) => ({ role: 'user', content });
const emit = (res, content, finish = 'stop', newline = true) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end('data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] }) + (newline ? '\n\ndata: [DONE]\n' : ''));
};
const call = (res, name, args) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_test', function: { name, arguments: args } }] }, finish_reason: 'tool_calls' }] }) + '\n\n');
};

test('чат: реальные HTTP-запросы к локальному API модели', async (t) => {
  let handler, requests = [], imageCalls = 0;
  const mock = http.createServer((req, res) => {
    let data = ''; req.on('data', (b) => { data += b; });
    req.on('end', () => {
      const body = JSON.parse(data); requests.push(body);
      if (req.url === '/images/generations') {
        imageCalls++;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ data: [{ b64_json: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64') }] }));
      }
      if (!body.stream) {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ prompt: 'Green field', aspect: 'landscape', reply: 'Картинка готова' }) } }] }));
      }
      handler(body, res);
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${mock.address().port}`;
  const dir = copyApp();
  seed(dir, { users: [{ id: 'u1', login: 'anna', email: 'anna@example.com', plan: 'max', until: Date.now() + 1e10 }] });
  fs.writeFileSync(dir + '/data/models.json', JSON.stringify([{ id: 'm1', name: 'Mock', modelId: 'mock', baseUrl: base, apiKey: 'not-a-real-secret', vision: false }]));
  fs.writeFileSync(dir + '/data/settings.json', JSON.stringify({ browser: false, selfcheck: false, code: false, provider: 'duckduckgo', image: { on: true, mode: 'images', baseUrl: base, modelId: 'image-mock', apiKey: 'not-a-real-image-secret' } }));
  const s = await startServer(dir, { MODEL_REQUEST_TIMEOUT_MS: '1000' });
  t.after(async () => { await s.stop(); await new Promise((r) => mock.close(r)); rm(dir); });
  const chat = async (messages, web = false) => {
    requests = [];
    const r = await s.req('POST', '/api/chat', { token: 'tok1', body: { model: 'm1', messages, web } });
    assert.equal(r.status, 200, r.text);
    return r.text.trim().split('\n').map((line) => JSON.parse(line));
  };
  const textOf = (events) => {
    let text = '';
    for (const event of events) { if (event.reset) text = ''; if (event.t) text += event.t; }
    return text;
  };
  const diagOf = (events) => events.find((e) => e.diag)?.diag;
  await t.test('запрос со скриншота: HTML вместо изображения, без лишнего повтора', async () => {
    handler = (body, res) => emit(res, HTML);
    const ev = await chat([user('создай 3д поле от первого лица')]);
    assert.equal(textOf(ev), HTML);
    assert.equal(imageCalls, 0);
    assert.equal(requests.length, 1);
    assert.ok(requests[0].tools.every((tool) => !['generate_image', 'generate_video', 'view_page', 'run_python'].includes(tool.function.name)));
    assert.equal(diagOf(ev).intent, 'artifact');
    assert.equal(diagOf(ev).repairs, 0);
  });
  await t.test('обещание вместо HTML: один повтор, старый текст заменяется, одно списание', async () => {
    const before = (await s.req('GET', '/api/billing', { token: 'tok1' })).json.used.m;
    handler = (body, res) => emit(res, requests.length === 1 ? 'Сделаю интерактивную сцену!' : HTML);
    const ev = await chat([user('создай 3д поле от первого лица')]);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].tools, undefined);
    assert.equal(textOf(ev), HTML);
    assert.equal(ev.filter((e) => e.reset).length, 1);
    assert.equal(ev.findLast((e) => e.bill).bill.used.m, before + 1);
    assert.equal(diagOf(ev).repairs, 1);
  });
  await t.test('незакрытый HTML: повтор не портит Markdown fence', async () => {
    handler = (body, res) => emit(res, requests.length === 1 ? '```html\n<html><body>unfinished' : HTML, requests.length === 1 ? 'length' : 'stop');
    const ev = await chat([user('сделай игру')]);
    assert.equal(textOf(ev), HTML);
    assert.ok(!ev.some((e) => e.s === 'fail' && !/Работоспособность не подтверждена/.test(e.q)));
    assert.equal(ev.find(e => e.validation)?.validation.status, 'unverified');
  });
  await t.test('повтор тоже без кода: не зацикливаемся и сообщаем о неготовом результате', async () => {
    handler = (body, res) => emit(res, 'Сейчас сделаю!');
    const ev = await chat([user('сделай сайт')]);
    assert.equal(requests.length, 2);
    assert.equal(diagOf(ev).outcome, 'missing_artifact');
    assert.ok(ev.some((e) => e.s === 'fail' && /HTML не получен/.test(e.q)));
    assert.ok(ev.some((e) => e.e && /HTML не получен/.test(e.e)));
  });
  await t.test('«ну че там» и «я просил игру а не картинку» сохраняют режим игры', async () => {
    handler = (body, res) => emit(res, HTML);
    for (const follow of ['ну че там', 'я просил игру а не картинку']) {
      const ev = await chat([user('создай 3д поле от первого лица'), { role: 'assistant', content: 'Сделаю сцену!' }, user(follow)]);
      assert.equal(diagOf(ev).intent, 'artifact');
      assert.equal(imageCalls, 0);
    }
  });
  await t.test('модель вызывает запрещённый генератор: сервер не выполняет его', async () => {
    const before = (await s.req('GET', '/api/billing', { token: 'tok1' })).json.used.m;
    handler = (body, res) => requests.length === 1 ? call(res, 'generate_image', '{"prompt":"field"}') : emit(res, HTML);
    const ev = await chat([user('сделай игру')]);
    assert.equal(imageCalls, 0);
    assert.ok(ev.some((e) => e.s === 'fail' && /недоступен/.test(e.q)));
    assert.match(requests[1].messages.find((m) => m.role === 'tool').content, /недоступен/);
    assert.equal(textOf(ev), HTML);
    assert.equal(ev.findLast((e) => e.bill).bill.used.m, before + 1);
  });
  await t.test('пустой URL инструмента: понятная ошибка вместо Invalid URL', async () => {
    handler = (body, res) => requests.length === 1 ? call(res, 'fetch_page', '{}') : emit(res, HTML);
    const ev = await chat([user('сделай игру')], true);
    assert.ok(ev.some((e) => e.s === 'fail' && /полный URL/.test(e.q)));
    assert.ok(!ev.some((e) => e.q === 'Invalid URL'));
    assert.equal(textOf(ev), HTML);
  });
  await t.test('обычный вопрос: ответ без принудительного HTML и повторов', async () => {
    handler = (body, res) => emit(res, 'Четыре.');
    const ev = await chat([user('сколько будет два плюс два')]);
    assert.equal(textOf(ev), 'Четыре.');
    assert.equal(requests.length, 1);
    assert.equal(diagOf(ev).intent, 'general');
  });
  await t.test('явная просьба о картинке после игры: генератор доступен', async () => {
    const ev = await chat([user('создай игру'), { role: 'assistant', content: HTML }, user('нарисуй картинку поля')]);
    assert.equal(imageCalls, 1);
    assert.ok(ev.some((e) => e.img));
    assert.equal(diagOf(ev).intent, 'image');
  });
  await t.test('уточнение/отказ не вызывают повторный платный запрос к модели', async () => {
    handler = (body, res) => emit(res, 'Уточните, какую именно игру вы хотите?');
    const ev = await chat([user('создай игру')]);
    assert.equal(requests.length, 1);
    assert.equal(diagOf(ev).repairs, 0);
    assert.equal(diagOf(ev).outcome, 'needs_clarification');
  });
  await t.test('последний фрагмент без новой строки не теряется', async () => {
    handler = (body, res) => emit(res, HTML, 'stop', false);
    const ev = await chat([user('сделай игру')]);
    assert.equal(textOf(ev), HTML);
    assert.equal(requests.length, 1);
  });
  await t.test('401/429 не маскируются повтором без tools', async () => {
    for (const code of [401, 429]) {
      handler = (body, res) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Unauthorized or rate limited' } })); };
      const ev = await chat([user('сделай игру')]);
      assert.equal(requests.length, 1);
      assert.ok(ev.some((e) => e.e));
      assert.equal(diagOf(ev).outcome, 'upstream_error');
    }
  });
  await t.test('таймаут включает чтение потока и не запускает повтор', async () => {
    handler = (body, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n');
    };
    const started = Date.now(), ev = await chat([user('сделай игру')]);
    assert.ok(Date.now() - started < 5000);
    assert.equal(requests.length, 1);
    assert.ok(ev.some((e) => /не завершила запрос/.test(e.e || '')));
    assert.equal(diagOf(ev).outcome, 'timeout');
  });
  await t.test('диагностика без текста/секретов доступна только через админку', async () => {
    assert.equal((await s.req('GET', '/api/admin/monitor')).status, 401);
    const login = await s.req('POST', '/api/admin/login', { body: { password: 'Test-Admin-Pass-2026' } });
    const r = await s.req('GET', '/api/admin/monitor', { headers: { Authorization: 'Bearer ' + login.json.token } });
    assert.ok(r.json.chats.length > 0);
    assert.equal(r.json.chats[0].outcome, 'timeout');
    assert.ok(!JSON.stringify(r.json.chats).includes('not-a-real-secret'));
    assert.ok(!JSON.stringify(r.json.chats).includes('создай'));
  });
});