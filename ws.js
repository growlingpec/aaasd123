'use strict';
// Минимальный WebSocket-сервер (RFC 6455) без зависимостей — для терминала облачного компьютера.
// accept() отвечает на upgrade и возвращает объект: send(строка|Buffer), close(), события message/close/drain.
const crypto = require('crypto');
const { EventEmitter } = require('events');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // RFC 6455, раздел 1.3

function frame(op, data) {
  const n = data.length;
  let head;
  if (n < 126) head = Buffer.from([0x80 | op, n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, data]);
}

function accept(req, socket, head, { maxPayload = 1 << 20 } = {}) {
  const key = req.headers['sec-websocket-key'];
  if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key) { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return null; }
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
    crypto.createHash('sha1').update(key + GUID).digest('base64') + '\r\n\r\n');
  socket.setNoDelay(true);
  const ws = new EventEmitter();
  let buf = Buffer.alloc(0), parts = null, size = 0, closed = false;
  const end = () => { if (closed) return; closed = true; ws.emit('close'); };
  ws.send = (data) => {
    if (closed || socket.destroyed) return false;
    const bin = Buffer.isBuffer(data);
    return socket.write(frame(bin ? 2 : 1, bin ? data : Buffer.from(String(data))));
  };
  ws.close = (code = 1000) => {
    if (closed) return;
    const b = Buffer.alloc(2); b.writeUInt16BE(code);
    try { socket.end(frame(8, b)); } catch {}
    end();
  };
  const parse = () => {
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80, op = buf[0] & 15, masked = buf[1] & 0x80;
      let n = buf[1] & 127, off = 2;
      if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); off = 4; }
      else if (n === 127) { if (buf.length < 10) return; n = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (!masked) return ws.close(1002); // клиент обязан маскировать кадры
      if (n > maxPayload || size + n > maxPayload) return ws.close(1009);
      if (buf.length < off + 4 + n) return;
      const mask = buf.subarray(off, off + 4), data = Buffer.from(buf.subarray(off + 4, off + 4 + n));
      for (let i = 0; i < n; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + n);
      if (op === 8) return ws.close();
      if (op === 9) { socket.write(frame(10, data)); continue; }
      if (op === 10) continue;
      if (op === 0) { if (!parts) return ws.close(1002); parts.push(data); }
      else if (op === 1 || op === 2) { if (parts) return ws.close(1002); parts = [data]; parts.op = op; }
      else return ws.close(1002);
      size += n;
      if (fin) {
        const msg = Buffer.concat(parts), bin = parts.op === 2; parts = null; size = 0;
        ws.emit('message', bin ? msg : msg.toString('utf8'), bin);
      }
    }
  };
  socket.on('data', (d) => { buf = buf.length ? Buffer.concat([buf, d]) : d; parse(); });
  socket.on('drain', () => ws.emit('drain'));
  socket.on('close', end);
  socket.on('error', () => socket.destroy());
  if (head?.length) { buf = Buffer.from(head); setImmediate(parse); }
  return ws;
}

module.exports = { accept };
