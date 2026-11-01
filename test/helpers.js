// Общее для тестов: копия приложения во временной папке (у db.js и других данные лежат рядом с кодом — в data/),
// запуск сервера на свободном порту и простой HTTP-клиент. Внешних библиотек не нужно: node --test.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), { spawn } = require('child_process'), net = require('net');
const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', 'data', 'test', 'tts', '.git']);

function copyApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-test-'));
  for (const n of fs.readdirSync(ROOT)) if (!SKIP.has(n)) fs.cpSync(path.join(ROOT, n), path.join(dir, n), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'));
  return dir;
}
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
// пользователи и сессии в старом формате JSON — заодно проверяется перенос в SQLite
function seed(dir, { users = [{ id: 'u1', login: 'anna', email: 'anna@example.com', created: '2026-01-01T00:00:00Z' }], sessions = { tok1: 'u1' }, chats = {} } = {}) {
  const d = path.join(dir, 'data');
  fs.writeFileSync(path.join(d, 'users.json'), JSON.stringify(users));
  fs.writeFileSync(path.join(d, 'sessions.json'), JSON.stringify(Object.fromEntries(Object.entries(sessions).map(([t, uid]) => [sha(t), { uid, exp: Date.now() + 1e10 }]))));
  if (Object.keys(chats).length) { fs.mkdirSync(path.join(d, 'chats')); for (const [uid, st] of Object.entries(chats)) fs.writeFileSync(path.join(d, 'chats', uid + '.json'), JSON.stringify(st)); }
}
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

// env — объект или функция от порта (когда переменной нужен адрес сервера)
async function startServer(dir, env = {}) {
  const port = await freePort();
  if (typeof env === 'function') env = env(port);
  const p = spawn(process.execPath, ['server.js'], { cwd: dir, env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', ADMIN_PASSWORD: 'Test-Admin-Pass-2026', CODE_RUNNER: 'off', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(base + '/healthz'); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); if (p.exitCode != null) throw new Error('сервер не запустился:\n' + log); }
  const req = async (method, url, { body, token, headers = {} } = {}) => {
    const r = await fetch(base + url, { method, redirect: 'manual', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Cookie: 'premier_session=' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, headers: r.headers };
  };
  return { base, req, log: () => log, stop: () => new Promise((ok) => { if (p.exitCode != null) return ok(); p.on('exit', ok); p.kill('SIGTERM'); }) };
}
const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true });
module.exports = { copyApp, seed, startServer, rm, sha, ROOT };
