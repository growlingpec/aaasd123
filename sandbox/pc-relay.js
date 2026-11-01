'use strict';
// Ретранслятор соединений для превью сайтов: один процесс на контейнер (`docker exec -i … node -e <этот файл>`),
// через stdin/stdout которого идут все TCP-соединения к серверам внутри контейнера. Так сайт открывается при любом
// Docker (rootless, без сети) и даже если сервер слушает только localhost.
// Кадр: тип (1 байт) + номер соединения (4) + длина (4) + данные.
// Типы: 1 открыть (порт, 2 байта), 2 данные, 3 конец передачи, 4 пауза, 5 продолжить, 6 ошибка, 8 закрыть.
const net = require('net');
const socks = new Map();
let buf = Buffer.alloc(0), blocked = false;
const out = process.stdout;
function send(type, id, body = Buffer.alloc(0)) {
  const h = Buffer.alloc(9); h[0] = type; h.writeUInt32BE(id, 1); h.writeUInt32BE(body.length, 5);
  if (!out.write(Buffer.concat([h, body])) && !blocked) { // хост не успевает читать — притормозить все соединения
    blocked = true; for (const c of socks.values()) c.s.pause();
    out.once('drain', () => { blocked = false; for (const c of socks.values()) if (!c.held) c.s.resume(); });
  }
}
// данные, пришедшие до подключения, копятся в очереди; при отказе 127.0.0.1 пробуем ::1 (localhost в Node) новым сокетом
function open(id, port, hosts = ['127.0.0.1', '::1'], c = { q: [], ended: false }) {
  const s = net.connect(port, hosts[0]); c.s = s; socks.set(id, c);
  s.on('connect', () => { for (const d of c.q) s.write(d); c.q = null; if (c.ended) s.end(); if (c.held || blocked) s.pause(); });
  s.on('error', (e) => {
    if (socks.get(id) !== c || c.s !== s) return;
    if (c.q && hosts.length > 1 && e.code === 'ECONNREFUSED') return open(id, port, hosts.slice(1), c);
    socks.delete(id); send(6, id, Buffer.from(String(e.code || e.message)));
  });
  s.on('data', (d) => send(2, id, d));
  s.on('end', () => send(3, id));
  s.on('close', (hadError) => { if (socks.get(id) === c && c.s === s && !hadError) { socks.delete(id); send(8, id); } });
}
process.stdin.on('data', (d) => {
  buf = buf.length ? Buffer.concat([buf, d]) : d;
  while (buf.length >= 9) {
    const type = buf[0], id = buf.readUInt32BE(1), n = buf.readUInt32BE(5);
    if (buf.length < 9 + n) break;
    const body = buf.subarray(9, 9 + n); buf = buf.subarray(9 + n);
    const c = socks.get(id);
    if (type === 1) open(id, body.readUInt16BE(0));
    else if (!c) continue;
    else if (type === 2) { if (c.q) c.q.push(Buffer.from(body)); else c.s.write(body); }
    else if (type === 3) { if (c.q) c.ended = true; else c.s.end(); }
    else if (type === 4) { c.held = true; c.s.pause(); }
    else if (type === 5) { c.held = false; if (!blocked) c.s.resume(); }
    else if (type === 8) { socks.delete(id); c.s.destroy(); }
  }
});
process.stdin.on('end', () => process.exit(0));
