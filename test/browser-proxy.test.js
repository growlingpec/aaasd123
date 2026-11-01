'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const { createBrowserProxy, resolveTarget, targetUrl, cleanHeaders } = require('../browser-proxy');
const { isPrivate } = require('../web');

const record = (address) => ({ address, family: net.isIP(address) });
const authOf = (p) => 'Basic ' + Buffer.from(`${p.username}:${p.password}`).toString('base64');
const listen = (s) => new Promise((ok) => s.listen(0, '127.0.0.1', ok));
const stop = (s) => new Promise((ok) => s.close(ok));
function request(proxy, url, { authenticated = true, headers = {}, method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(proxy.url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: url, method, agent: false,
      headers: { ...(authenticated ? { 'Proxy-Authorization': authOf(proxy) } : {}), ...headers },
    }, (res) => {
      let text = '';
      res.on('data', (b) => { text += b; });
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.setTimeout(3000, () => req.destroy(new Error('Test request timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
function tunnel(proxy, authority, authenticated = true, payload = '') {
  return new Promise((resolve, reject) => {
    const u = new URL(proxy.url);
    const socket = net.createConnection({ host: u.hostname, port: u.port });
    let text = '';
    socket.setTimeout(3000, () => socket.destroy(new Error('Test tunnel timeout')));
    socket.on('connect', () => socket.write(
      `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n` +
      (authenticated ? `Proxy-Authorization: ${authOf(proxy)}\r\n` : '') + '\r\n' + payload
    ));
    socket.on('error', reject);
    socket.on('data', (data) => {
      text += data.toString();
      if (text.includes('\r\n\r\n') && (!text.startsWith('HTTP/1.1 200') || !payload || text.endsWith(payload))) {
        socket.destroy();
        resolve(text);
      }
    });
    socket.on('end', () => resolve(text));
  });
}

test('browser proxy: запрещённые протоколы, credentials, порты и неверные CONNECT', () => {
  for (const value of [
    'file:///etc/passwd', 'ftp://example.com/', 'https://example.com/',
    'http://user:pass@example.com/', 'http://example.com:3000/', '/relative',
  ]) assert.throws(() => targetUrl(value), undefined, value);
  for (const value of ['example.com', 'example.com:443/path', 'user@example.com:443', 'example.com:22'])
    assert.throws(() => targetUrl(value, true), undefined, value);
  assert.equal(targetUrl('example.com:443', true).hostname, 'example.com');
  assert.equal(targetUrl('[2606:4700::1111]:443', true).hostname, '[2606:4700::1111]');
});

test('browser proxy: локальные IP, обходные формы и служебные имена блокируются', async () => {
  for (const host of [
    '127.1', '0x7f000001', '2130706433', '[::1]', '[::ffff:7f00:1]',
    '169.254.169.254', '10.0.0.1', 'localhost.', 'a.localhost', 'a.local', 'a.internal',
  ]) await assert.rejects(resolveTarget(new URL(`http://${host}/`)), /Внутренний/, host);
  assert.equal(isPrivate('240.0.0.1'), true);
  assert.equal(isPrivate('255.255.255.255'), true);
});

test('browser proxy: любой внутренний IP в DNS-ответе запрещает соединение', async () => {
  for (const rows of [[], [record('93.184.216.34'), record('10.0.0.1')], [record('::1'), record('1.1.1.1')]])
    await assert.rejects(resolveTarget(new URL('https://example.com/'), async () => rows), /Внутренний/);
});

test('browser proxy: DNS не кешируется, IP фиксируется и не разрешается повторно', async () => {
  let count = 0;
  const lookup = async () => [record(++count === 1 ? '93.184.216.34' : '127.0.0.1')];
  const u = new URL('https://example.com/');
  assert.deepEqual(await resolveTarget(u, lookup), { host: '93.184.216.34', family: 4, port: 443 });
  await assert.rejects(resolveTarget(u, lookup), /Внутренний/);
  assert.equal(count, 2);
});

test('browser proxy: credentials и hop-by-hop заголовки не отправляются сайту', () => {
  assert.deepEqual(cleanHeaders({
    connection: 'X-Secret, keep-alive', 'x-secret': 'hidden', 'keep-alive': 'timeout=5',
    'proxy-authorization': 'secret', 'proxy-connection': 'keep-alive', accept: 'text/html',
  }), { accept: 'text/html' });
});

test('browser proxy: HTTP использует проверенный IP, сохраняет Host и тело запроса', async (t) => {
  let received, dialed;
  const site = http.createServer((req, res) => {
    let body = '';
    req.on('data', (b) => { body += b; });
    req.on('end', () => { received = { headers: req.headers, body, path: req.url }; res.end('ok'); });
  });
  await listen(site);
  const proxy = await createBrowserProxy({
    lookup: async () => [record('93.184.216.34')],
    connect: (options) => {
      dialed = options; // Только в тесте публичный адрес подменяется локальным сервером.
      return net.createConnection({ host: '127.0.0.1', port: site.address().port });
    },
  });
  t.after(async () => { await proxy.close(); await stop(site); });
  const result = await request(proxy, 'http://example.com/path?q=1', {
    method: 'POST', body: 'hello',
    headers: { Host: 'evil.internal', Connection: 'x-secret', 'X-Secret': 'hidden' },
  });
  assert.equal(result.status, 200);
  assert.equal(result.text, 'ok');
  assert.deepEqual(dialed, { host: '93.184.216.34', port: 80, family: 4 });
  assert.equal(received.headers.host, 'example.com');
  assert.equal(received.headers['proxy-authorization'], undefined);
  assert.equal(received.headers['x-secret'], undefined);
  assert.equal(received.body, 'hello');
  assert.equal(received.path, '/path?q=1');
});

test('browser proxy: без авторизации HTTP и CONNECT отклоняются до DNS/соединения', async (t) => {
  const proxy = await createBrowserProxy({
    lookup: async () => { throw new Error('DNS не должен вызываться'); },
    connect: () => { throw new Error('Соединение не должно открываться'); },
  });
  t.after(() => proxy.close());
  assert.equal((await request(proxy, 'http://example.com/', { authenticated: false })).status, 407);
  assert.match(await tunnel(proxy, 'example.com:443', false), /^HTTP\/1.1 407/);
});

test('browser proxy: HTTP и CONNECT блокируют внутренние адреса без соединения', async (t) => {
  let calls = 0;
  const proxy = await createBrowserProxy({
    lookup: async () => [record('127.0.0.1')],
    connect: () => { calls++; throw new Error('Запрещённое соединение'); },
  });
  t.after(() => proxy.close());
  assert.equal((await request(proxy, 'http://example.com/')).status, 403);
  assert.match(await tunnel(proxy, 'example.com:443'), /^HTTP\/1.1 403/);
  assert.match(await tunnel(proxy, 'example.com:22'), /^HTTP\/1.1 403/);
  assert.equal(calls, 0);
});

test('browser proxy: публичный→внутренний DNS блокируется при следующем запросе', async (t) => {
  let dnsCalls = 0, connections = 0;
  const site = http.createServer((req, res) => res.end('public'));
  await listen(site);
  const proxy = await createBrowserProxy({
    lookup: async () => [record(++dnsCalls === 1 ? '93.184.216.34' : '10.0.0.1')],
    connect: () => {
      connections++;
      return net.createConnection({ host: '127.0.0.1', port: site.address().port });
    },
  });
  t.after(async () => { await proxy.close(); await stop(site); });
  assert.equal((await request(proxy, 'http://example.com/')).status, 200);
  assert.equal((await request(proxy, 'http://example.com/')).status, 403);
  assert.equal(connections, 1);
});

test('browser proxy: redirect проверяется новым запросом, приватный Location не открывается', async (t) => {
  let connections = 0;
  const site = http.createServer((req, res) => {
    res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }); res.end();
  });
  await listen(site);
  const proxy = await createBrowserProxy({
    lookup: async () => [record('93.184.216.34')],
    connect: () => { connections++; return net.createConnection({ host: '127.0.0.1', port: site.address().port }); },
  });
  t.after(async () => { await proxy.close(); await stop(site); });
  const result = await request(proxy, 'http://example.com/');
  assert.equal(result.status, 302);
  assert.equal((await request(proxy, result.headers.location)).status, 403);
  assert.equal(connections, 1);
});

test('browser proxy: CONNECT передаёт данные только в проверенный IP и закрывается', async (t) => {
  let dialed;
  const site = net.createServer((socket) => socket.pipe(socket));
  await listen(site);
  const proxy = await createBrowserProxy({
    lookup: async () => [record('93.184.216.34')],
    connect: (options) => {
      dialed = options;
      return net.createConnection({ host: '127.0.0.1', port: site.address().port });
    },
  });
  t.after(async () => { await proxy.close(); await stop(site); });
  assert.match(await tunnel(proxy, 'example.com:443', true, 'tunnel payload'), /200 Connection Established[\s\S]*tunnel payload$/);
  assert.deepEqual(dialed, { host: '93.184.216.34', family: 4, port: 443 });
  await Promise.all([proxy.close(), proxy.close()]);
});

test('browser proxy: ошибка DNS возвращает 403, не падает процесс', async (t) => {
  const proxy = await createBrowserProxy({ lookup: async () => { throw new Error('ENOTFOUND'); } });
  t.after(() => proxy.close());
  assert.equal((await request(proxy, 'http://missing.example/')).status, 403);
  assert.match(await tunnel(proxy, 'missing.example:443'), /^HTTP\/1.1 403/);
});