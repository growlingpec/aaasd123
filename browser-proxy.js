'use strict';

// Сетевой шлюз Chromium. Проверяем все DNS-ответы и подключаемся к выбранному
// числовому IP: браузер не может повторно разрешить имя после нашей проверки.
// Прокси слушает только loopback; случайные credentials ограничивают доступ.
const http = require('http');
const net = require('net');
const dns = require('dns').promises;
const crypto = require('crypto');
const { isPrivate } = require('./web');

const PORTS = new Set([80, 443]);
const HOP_HEADERS = new Set([
  'connection', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate',
  'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade',
]);

function targetUrl(raw, tunnel = false) {
  if (tunnel && !/^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+):\d+$/i.test(raw))
    throw new Error('Неверный адрес туннеля');
  const u = new URL(tunnel ? `https://${raw}/` : raw);
  if (!(tunnel ? u.protocol === 'https:' : u.protocol === 'http:'))
    throw new Error('Запрещённый протокол');
  if (u.username || u.password) throw new Error('Credentials в URL запрещены');
  if (!PORTS.has(Number(u.port || (u.protocol === 'https:' ? 443 : 80))))
    throw new Error('Разрешены только порты 80 и 443');
  return u;
}

async function resolveTarget(u, lookup = dns.lookup) {
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)\.?$/i.test(host))
    throw new Error('Внутренний адрес');
  const records = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some((r) => isPrivate(r.address)))
    throw new Error('Внутренний адрес');
  return {
    host: records[0].address,
    family: net.isIP(records[0].address),
    port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)),
  };
}

function cleanHeaders(headers) {
  const blocked = new Set(HOP_HEADERS);
  for (const name of String(headers.connection || '').split(','))
    blocked.add(name.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([k]) => !blocked.has(k.toLowerCase())));
}

async function createBrowserProxy({ lookup = dns.lookup, connect = net.createConnection } = {}) {
  const username = crypto.randomBytes(16).toString('hex');
  const password = crypto.randomBytes(32).toString('hex');
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const sockets = new Set();
  let closed = false;

  function authorized(req) {
    const supplied = Buffer.from(String(req.headers['proxy-authorization'] || ''));
    const expected = Buffer.from(auth);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  }
  function track(socket) {
    if (closed) { socket.destroy(); return socket; }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    return socket;
  }
  function connectPinned(target) {
    if (closed) throw new Error('Прокси закрыт');
    const socket = track(connect(target));
    socket.setTimeout(30000, () => socket.destroy());
    return socket;
  }
  const forwardAgent = new http.Agent({ keepAlive: false });
  forwardAgent.createConnection = (options) => connectPinned({
    host: options.host, port: options.port, family: options.family,
  });
  const deny = (res, status) => {
    res.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Connection': 'close',
      ...(status === 407 ? { 'Proxy-Authenticate': 'Basic realm="Premier browser"' } : {}),
    });
    res.end(status === 407 ? 'Proxy authentication required' : 'Browser network request blocked');
  };

  const server = http.createServer(async (req, res) => {
    if (!authorized(req)) return deny(res, 407);
    let u, target;
    try {
      u = targetUrl(req.url);
      target = await resolveTarget(u, lookup);
    } catch { return deny(res, 403); }
    if (closed || req.destroyed || res.destroyed) return;
    const headers = cleanHeaders(req.headers);
    headers.host = u.host; // Host берём из проверенного URL, не от клиента.
    const upstream = http.request({
      hostname: target.host, family: target.family, port: target.port,
      method: req.method, path: u.pathname + u.search, headers,
      agent: forwardAgent,
    }, (reply) => {
      res.writeHead(reply.statusCode, cleanHeaders(reply.headers));
      reply.on('error', () => res.destroy());
      reply.pipe(res);
    });
    upstream.setTimeout(30000, () => upstream.destroy(new Error('Upstream timeout')));
    upstream.on('error', () => {
      if (!res.headersSent && !res.destroyed) deny(res, 502);
      else res.destroy();
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });

  server.on('connect', async (req, client, head) => {
    client.pause(); // Не пропускаем данные до проверки и установления соединения.
    const reject = (status) => {
      if (!client.destroyed) client.end(
        `HTTP/1.1 ${status} Blocked\r\nConnection: close\r\n` +
        (status === 407 ? 'Proxy-Authenticate: Basic realm="Premier browser"\r\n' : '') +
        '\r\n'
      );
    };
    if (!authorized(req)) return reject(407);
    let target;
    try { target = await resolveTarget(targetUrl(req.url, true), lookup); }
    catch { return reject(403); }
    if (closed || client.destroyed) return;
    let upstream;
    try { upstream = connectPinned(target); } catch { return reject(502); }
    client.on('close', () => upstream.destroy());
    upstream.on('error', () => {
      if (!client.destroyed) client.destroy();
    });
    upstream.once('connect', () => {
      if (client.destroyed) { upstream.destroy(); return; }
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
      client.resume();
    });
    upstream.on('close', () => client.destroy());
  });
  // ws:// не поддерживается; wss:// проходит через проверенный CONNECT.
  server.on('upgrade', (req, socket) => socket.end('HTTP/1.1 403 Blocked\r\nConnection: close\r\n\r\n'));
  server.on('connection', (socket) => {
    track(socket);
    socket.on('error', () => {}); // Некорректный/оборванный клиент не роняет процесс.
    socket.setTimeout(30000, () => socket.destroy());
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 30000;
  server.on('clientError', (err, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  let closing = null;
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    username, password,
    close() {
      if (closing) return closing;
      closed = true;
      closing = new Promise((resolve) => {
        forwardAgent.destroy();
        server.close(resolve);
        for (const socket of sockets) socket.destroy();
      });
      return closing;
    },
  };
}

module.exports = { createBrowserProxy, resolveTarget, targetUrl, cleanHeaders };