#!/usr/bin/env node
// Premier Agent — помощник, который даёт модели из чата Premier доступ к этому компьютеру.
// Запуск: node premier-agent.js [КОД]   (нужен Node.js 18+, https://nodejs.org)
// Каждое действие (команду, запись файла, удаление) вы сначала подтверждаете в чате.
// Остановить доступ: закройте это окно (Ctrl+C) или нажмите «Отключить» в чате.
'use strict';
const os = require('os'), fs = require('fs'), path = require('path'), cp = require('child_process'), readline = require('readline');

const SERVER = (process.env.PREMIER_SERVER || '__PREMIER_SERVER__').replace(/\/+$/, '');
const CONF = process.env.PREMIER_AGENT_CONF || path.join(os.homedir(), '.premier-agent.json');
const WIN = process.platform === 'win32', MAC = process.platform === 'darwin';
const OUT_MAX = 100000, RUN_TIMEOUT = 10 * 60e3;

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', b: '\x1b[36m', d: '\x1b[2m', x: '\x1b[0m' };
const log = (c, ...a) => console.log(C[c] + a.join(' ') + C.x);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function desktopDir() {
  try {
    if (WIN) { // рабочий стол может быть перенесён (OneDrive) — берём путь из реестра
      const o = cp.execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders" /v Desktop', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = o.match(/Desktop\s+REG_\w+\s+(.+)/);
      if (m) { const d = m[1].trim().replace(/%([^%]+)%/g, (_, v) => process.env[v] || ''); if (fs.existsSync(d)) return d; }
    } else if (!MAC) {
      const d = cp.execSync('xdg-user-dir DESKTOP', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (d && fs.existsSync(d)) return d;
    }
  } catch {}
  for (const d of [path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'OneDrive', 'Desktop'), path.join(os.homedir(), 'Рабочий стол')]) if (fs.existsSync(d)) return d;
  return path.join(os.homedir(), 'Desktop');
}
const DESKTOP = desktopDir();
const INFO = { os: `${WIN ? 'Windows' : MAC ? 'macOS' : 'Linux'} ${os.release()} ${os.arch()}`, host: os.hostname(), home: os.homedir(), desktop: DESKTOP, node: process.version };

// путь: ~, %VAR%, $VAR; относительный — от домашней папки
function P(p, base) {
  let s = String(p || '').trim(); if (!s) throw new Error('не указан путь');
  s = s.replace(/^~(?=$|[\\/])/, os.homedir()).replace(/%([A-Za-z_][\w]*)%/g, (_, v) => process.env[v] ?? '').replace(/\$\{?([A-Za-z_]\w*)\}?/g, (m, v) => process.env[v] ?? m);
  return path.resolve(base || os.homedir(), s);
}
// защита от разрушительных действий — их не выполняем даже после подтверждения
const ROOTS = new Set([path.parse(os.homedir()).root, os.homedir(), DESKTOP, path.join(os.homedir(), 'Documents'), path.join(os.homedir(), 'Downloads')].map((x) => path.resolve(x).toLowerCase()));
const SYS = WIN ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'] : ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/sbin', '/sys', '/usr', '/var', '/System', '/Library', '/Applications'];
function guardPath(p, what) {
  const r = path.resolve(p).toLowerCase();
  if (ROOTS.has(r)) throw new Error(`${what} «${p}» заблокировано: это корневая или важная папка`);
  if (SYS.some((s) => r === s.toLowerCase() || r.startsWith(s.toLowerCase() + path.sep))) throw new Error(`${what} в системной папке «${p}» заблокировано`);
  if (r === CONF.toLowerCase()) throw new Error('файл настроек помощника трогать нельзя');
}
const BAD = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+(-[a-z]*\s+)*(\/|~|\$HOME|\/\*|~\/\*)(\s|$)/i, /\bmkfs(\.\w+)?\b/i, /\bdd\b[^|]*\bof=\/dev\//i, /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /\bformat\s+[a-z]:/i, /\bdiskpart\b/i, /\b(rd|rmdir)\s+\/s\b[^&|]*\b[a-z]:\\?(\s|$|")/i, /\bdel\s+(\/[a-z]\s+)*[a-z]:\\\*?(\s|$)/i,
  /Remove-Item\b[^|;]*-Recurse[^|;]*\b[a-z]:\\?(\s|$|'|")/i, /\bbcdedit\b/i, /\bcipher\s+\/w/i, /\bvssadmin\s+delete\b/i, /\bchmod\s+-R\s+[0-7]+\s+\/(\s|$)/,
];
const guardCmd = (c) => { for (const re of BAD) if (re.test(c)) throw new Error('команда заблокирована помощником как опасная (может стереть диск или систему)'); };

const kb = (n) => n < 1024 ? n + ' Б' : n < 1048576 ? (n / 1024).toFixed(1) + ' КБ' : (n / 1048576).toFixed(1) + ' МБ';
const SKIP = /^(node_modules|\.git|__pycache__|\.venv|venv|\.cache|\.next|dist|build)$/;
const clip = (s) => s.length > OUT_MAX ? s.slice(0, OUT_MAX / 2) + `\n…[пропущено ${s.length - OUT_MAX} символов]…\n` + s.slice(-OUT_MAX / 2) : s;

function list(p, depth) {
  const st = fs.statSync(p); if (!st.isDirectory()) return `${p} — файл (${kb(st.size)})`;
  const lines = []; const D = Math.min(3, Math.max(1, depth | 0 || 1));
  (function walk(d, lvl) {
    let items; try { items = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { lines.push('  '.repeat(lvl) + '(нет доступа)'); return; }
    items.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    for (const it of items) {
      if (lines.length >= 400) return;
      let size = ''; if (!it.isDirectory()) { try { size = ' (' + kb(fs.statSync(path.join(d, it.name)).size) + ')'; } catch {} }
      lines.push('  '.repeat(lvl) + it.name + (it.isDirectory() ? '/' : size));
      if (it.isDirectory() && lvl + 1 < D && !SKIP.test(it.name)) walk(path.join(d, it.name), lvl + 1);
    }
  })(p, 0);
  return `Содержимое ${p}:\n` + (lines.join('\n') || '(папка пуста)') + (lines.length >= 400 ? '\n… (показаны первые 400)' : '');
}
function readText(p) {
  const st = fs.statSync(p); if (st.isDirectory()) throw new Error(p + ' — это папка (используй computer_list)');
  if (st.size > 3e6) throw new Error(`файл больше 3 МБ (${kb(st.size)})`);
  const t = fs.readFileSync(p, 'utf8'); if (t.slice(0, 8000).includes('\u0000')) throw new Error(`это не текстовый файл (${kb(st.size)})`); return t;
}
function run(cmd, cwd, bg) {
  guardCmd(cmd);
  const dir = cwd ? P(cwd) : os.homedir(); if (!fs.existsSync(dir)) throw new Error('папка не найдена: ' + dir);
  // на Windows переключаем консоль в UTF-8, чтобы русский текст в выводе не превращался в кракозябры
  const full = WIN ? 'chcp 65001>nul & ' + cmd : cmd;
  return new Promise((resolve) => {
    const t0 = Date.now(); let out = '', killed = false;
    const ch = cp.spawn(full, { cwd: dir, shell: true, windowsHide: !bg, detached: !!bg && !WIN, env: { ...process.env, PYTHONIOENCODING: 'utf-8', FORCE_COLOR: '0' } });
    const add = (d) => { out += d.toString('utf8'); if (out.length > OUT_MAX * 2) out = clip(out); };
    ch.stdout.on('data', add); ch.stderr.on('data', add);
    if (bg) { // фоновый запуск: ждём 4 секунды, отдаём первый вывод и оставляем процесс работать
      const t = setTimeout(() => { ch.stdout.removeAllListeners('data'); ch.stderr.removeAllListeners('data'); ch.stdout.resume(); ch.stderr.resume(); ch.unref(); resolve(`Запущено в фоне (pid ${ch.pid}) в ${dir}.\nВывод за первые секунды:\n${clip(out.trim()) || '(пусто)'}`); }, 4000);
      ch.on('exit', (code) => { clearTimeout(t); resolve(`Процесс завершился сразу (код ${code}) в ${dir}.\n${clip(out.trim()) || '(вывода нет)'}`); });
      ch.on('error', (e) => { clearTimeout(t); resolve('Ошибка запуска: ' + e.message); });
      return;
    }
    const t = setTimeout(() => { killed = true; try { WIN ? cp.execSync('taskkill /pid ' + ch.pid + ' /T /F', { stdio: 'ignore' }) : ch.kill('SIGKILL'); } catch {} }, RUN_TIMEOUT);
    ch.on('error', (e) => { clearTimeout(t); resolve('Ошибка запуска: ' + e.message); });
    ch.on('close', (code) => { clearTimeout(t); resolve(`${killed ? 'Остановлено: команда шла дольше 10 минут (долгие процессы запускай с background: true).' : `Код завершения ${code}`} · ${((Date.now() - t0) / 1000).toFixed(1)} с · папка ${dir}\n${clip(out.trim()) || '(вывода нет)'}`); });
  });
}

async function exec(name, a) {
  switch (name) {
    case 'computer_run': return run(String(a.command || ''), a.cwd, !!a.background);
    case 'computer_list': return list(P(a.path || '~'), a.depth);
    case 'computer_read': {
      const p = P(a.path), t = readText(p), L = t.split('\n'), s = Math.max(1, a.start_line | 0 || 1), e = Math.min(L.length, a.end_line | 0 || L.length);
      let body = L.slice(s - 1, e).join('\n'); if (body.length > 120000) body = body.slice(0, 120000) + '\n…[обрезано — читай частями через start_line/end_line]';
      return `Файл ${p} (${L.length} строк)${s > 1 || e < L.length ? `, строки ${s}–${e}` : ''}:\n${body}`;
    }
    case 'computer_write': {
      const p = P(a.path); guardPath(p, 'Запись'); const had = fs.existsSync(p);
      if (had && fs.statSync(p).isDirectory()) throw new Error(p + ' — это папка');
      fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, String(a.content ?? ''));
      return `Готово: ${p} ${had ? 'перезаписан' : 'создан'} (${kb(Buffer.byteLength(String(a.content ?? '')))}).`;
    }
    case 'computer_edit': {
      const p = P(a.path); guardPath(p, 'Правка'); let t = readText(p), old = String(a.old ?? ''), nw = String(a.new ?? '');
      if (!old) throw new Error('пустой фрагмент old');
      if (t.includes('\r\n') && !old.includes('\r')) { old = old.replace(/\n/g, '\r\n'); nw = nw.replace(/\n/g, '\r\n'); }
      const n = t.split(old).length - 1;
      if (!n) throw new Error('фрагмент old не найден — перечитай файл и скопируй фрагмент точно');
      if (n > 1) throw new Error(`фрагмент old встречается ${n} раз(а) — добавь соседние строки`);
      fs.writeFileSync(p, t.replace(old, () => nw)); return `Готово: ${p} изменён.`;
    }
    case 'computer_mkdir': { const p = P(a.path); if (fs.existsSync(p)) return `Папка уже есть: ${p}`; fs.mkdirSync(p, { recursive: true }); return `Готово: создана папка ${p}`; }
    case 'computer_move': {
      const f = P(a.from), t = P(a.to); guardPath(f, 'Перемещение'); guardPath(t, 'Перемещение');
      if (!fs.existsSync(f)) throw new Error('не найдено: ' + f); if (fs.existsSync(t)) throw new Error('уже существует: ' + t);
      fs.mkdirSync(path.dirname(t), { recursive: true });
      try { fs.renameSync(f, t); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.cpSync(f, t, { recursive: true }); fs.rmSync(f, { recursive: true, force: true }); }
      return `Готово: ${f} → ${t}`;
    }
    case 'computer_delete': {
      const p = P(a.path); guardPath(p, 'Удаление'); if (!fs.existsSync(p)) throw new Error('не найдено: ' + p);
      const dir = fs.statSync(p).isDirectory(); fs.rmSync(p, { recursive: true, force: true }); return `Готово: ${dir ? 'удалена папка' : 'удалён файл'} ${p}`;
    }
    case 'computer_open': {
      const t = String(a.target || '').trim(); if (!t) throw new Error('не указано, что открыть');
      const target = /^[a-z][\w+.-]*:\/\//i.test(t) ? t : P(t);
      if (!/^https?:\/\//i.test(target) && !fs.existsSync(target)) throw new Error('не найдено: ' + target);
      const c = WIN ? cp.spawn('cmd', ['/c', 'start', '""', target], { detached: true, stdio: 'ignore', windowsHide: true }) : cp.spawn(MAC ? 'open' : 'xdg-open', [target], { detached: true, stdio: 'ignore' });
      c.on('error', () => {}); c.unref(); return `Открыто: ${target}`;
    }
  }
  throw new Error('неизвестное действие ' + name);
}
const LBL = { computer_run: 'Команда', computer_list: 'Просмотр', computer_read: 'Чтение', computer_write: 'Запись', computer_edit: 'Правка', computer_mkdir: 'Новая папка', computer_move: 'Перемещение', computer_delete: 'Удаление', computer_open: 'Открыть' };

// ---- связь с сервером ----
async function api(p, body, token) {
  const r = await fetch(SERVER + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(60000) });
  if (r.status === 204) return null; const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'HTTP ' + r.status), { status: r.status }); return j;
}
const ask = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(a.trim()); }); });
const loadConf = () => { try { return JSON.parse(fs.readFileSync(CONF, 'utf8')); } catch { return {}; } };
const saveConf = (c) => { try { fs.writeFileSync(CONF, JSON.stringify(c), { mode: 0o600 }); } catch {} };

async function pair(code) {
  for (;;) {
    code = code || await ask(`${C.b}Введите код из чата Premier (кнопка «Компьютер»): ${C.x}`);
    try { const r = await api('/api/agent/connect', { code, info: INFO }); const c = loadConf(); c[SERVER] = r.token; saveConf(c); return r.token; }
    catch (e) { log('r', '✗ ' + e.message); code = ''; if (!process.stdin.isTTY) process.exit(1); }
  }
}
async function main() {
  if (SERVER.includes('__PREMIER_SERVER__')) { log('r', 'Не задан адрес сервера. Скачайте помощник из чата Premier или задайте PREMIER_SERVER=https://ваш-сайт'); process.exit(1); }
  console.log(`\n${C.b}Premier Agent${C.x} — доступ модели к этому компьютеру\n${C.d}Сервер: ${SERVER}\nСистема: ${INFO.os}, рабочий стол: ${DESKTOP}${C.x}\n`);
  if (Number(process.versions.node.split('.')[0]) < 18) { log('r', 'Нужен Node.js 18 или новее: https://nodejs.org'); process.exit(1); }
  // код из аргумента нужен только для первой привязки; если помощник уже привязан — используем сохранённый ключ
  let arg = process.argv.slice(2).find((x) => !x.startsWith('-'));
  let token = loadConf()[SERVER];
  if (!token) { token = await pair(arg); arg = ''; }
  log('g', '✓ Подключено. Окно не закрывайте — пока оно открыто, модель может работать с компьютером (каждое действие вы подтверждаете в чате).');
  log('d', '  Остановить: Ctrl+C или «Отключить» в чате.\n');
  let fails = 0;
  for (;;) {
    let job;
    try { job = await api('/api/agent/poll', { info: INFO }, token); fails = 0; }
    catch (e) {
      if (e.status === 401) { log('y', '! Помощник отключён в чате. Чтобы подключить снова, введите новый код.'); const c = loadConf(); delete c[SERVER]; saveConf(c); token = await pair(arg); arg = ''; log('g', '✓ Подключено снова.'); continue; }
      if (++fails === 1) log('y', '! Нет связи с сервером, повторяю… (' + e.message + ')'); await sleep(Math.min(30000, 2000 * fails)); continue;
    }
    if (!job) continue;
    const a = job.args || {}, what = a.command || a.path || a.target || (a.from ? a.from + ' → ' + a.to : '');
    log('b', `→ ${LBL[job.name] || job.name}: ${String(what).slice(0, 200)}`);
    let out;
    try { out = await exec(job.name, a); log('g', '  ✓ готово'); }
    catch (e) { out = 'Ошибка: ' + e.message; log('r', '  ✗ ' + e.message); }
    for (let i = 0; i < 3; i++) { try { await api('/api/agent/result', { jid: job.jid, out }, token); break; } catch { await sleep(1500); } }
  }
}
if (require.main === module) main().catch((e) => { log('r', e.message); process.exit(1); });
module.exports = { exec, guardCmd, P };
