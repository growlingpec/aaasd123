'use strict';
// Файловые операции «Облачного компьютера» (см. cloud.js). Запускается как `node -e <этот файл>` внутри контейнера
// пользователя, а в режиме CLOUD_RUNNER=local — на сервере с PC_CONFINE=1 (тогда пути за пределами PC_HOME запрещены).
// Вход — JSON { op, args } в stdin, выход — JSON { ok, out } или { ok: false, error } в stdout.
const fs = require('fs'), path = require('path');

const HOME = path.resolve(process.env.PC_HOME || require('os').homedir());
const CONFINE = process.env.PC_CONFINE === '1';
const SKIP = new Set(['node_modules', '.git', '__pycache__', '.cache', '.npm', '.venv', 'venv']);
const READ_MAX = 3e6, GET_MAX = 25e6, OUT_MAX = 200000;

const kb = (n) => n < 1024 ? n + ' Б' : n < 1048576 ? (n / 1024).toFixed(1) + ' КБ' : (n / 1048576).toFixed(1) + ' МБ';
const show = (p) => p === HOME ? '~' : p.startsWith(HOME + path.sep) ? '~/' + path.relative(HOME, p).split(path.sep).join('/') : p;
const fail = (m) => { throw new Error(m); };

function resolve(p) {
  p = String(p ?? '').trim();
  const abs = !p || p === '~' ? HOME : p.startsWith('~/') ? path.join(HOME, p.slice(2)) : path.resolve(HOME, p);
  if (CONFINE) { // ссылки (symlink) могут вести наружу — сверяем настоящий путь ближайшей существующей папки
    let real = abs, rest = '';
    while (!fs.existsSync(real) && real !== path.dirname(real)) { rest = path.join(path.basename(real), rest); real = path.dirname(real); }
    const full = path.join(fs.realpathSync(real), rest), home = fs.realpathSync(HOME);
    if (full !== home && !full.startsWith(home + path.sep)) fail('путь вне облачного компьютера: ' + p);
  }
  return abs;
}
const stat = (p) => { try { return fs.statSync(p); } catch { return null; } };
const need = (p, what) => { const s = stat(p); if (!s) fail((what || 'файл') + ' не найден: ' + show(p)); return s; };

function entries(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).map((d) => {
    const s = stat(path.join(dir, d.name));
    return { name: d.name, dir: !!s?.isDirectory(), size: s && s.isFile() ? s.size : 0, mtime: s ? Math.round(s.mtimeMs) : 0 };
  }).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
}

const ops = {
  list({ path: p, depth }) {
    const root = resolve(p); if (!need(root, 'папка').isDirectory()) fail('это не папка: ' + show(root));
    const max = Math.min(3, Math.max(1, Number(depth) || 1)), lines = []; let n = 0;
    const walk = (dir, d, pad) => {
      for (const e of entries(dir)) {
        if (n >= 400) return; n++;
        lines.push(pad + e.name + (e.dir ? '/' : '  ' + kb(e.size)));
        if (e.dir && d < max && !SKIP.has(e.name)) walk(path.join(dir, e.name), d + 1, pad + '  ');
      }
    };
    walk(root, 1, '');
    return `${show(root)}:\n${lines.join('\n') || '(пусто)'}${n >= 400 ? '\n…(показаны первые 400)' : ''}`;
  },
  read({ path: p, start_line, end_line }) {
    const f = resolve(p), s = need(f); if (s.isDirectory()) fail('это папка, а не файл: ' + show(f));
    if (s.size > READ_MAX) fail(`файл слишком большой (${kb(s.size)}) — прочитай часть командой head/sed`);
    const buf = fs.readFileSync(f); if (buf.subarray(0, 8000).includes(0)) fail('это не текстовый файл: ' + show(f));
    const all = buf.toString('utf8').split('\n'), a = Math.max(1, Number(start_line) || 1), b = Math.min(all.length, Number(end_line) || all.length);
    let txt = all.slice(a - 1, b).join('\n'); if (txt.length > OUT_MAX) txt = txt.slice(0, OUT_MAX) + '\n…[обрезано]';
    return (a > 1 || b < all.length ? `${show(f)} (строки ${a}–${b} из ${all.length}):\n` : '') + txt;
  },
  write({ path: p, content }) {
    const f = resolve(p), had = stat(f); if (had?.isDirectory()) fail('это папка: ' + show(f));
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, String(content ?? ''));
    return `Готово: ${show(f)} ${had ? 'перезаписан' : 'создан'} (${kb(Buffer.byteLength(String(content ?? '')))}).`;
  },
  edit({ path: p, old, new: neu }) {
    const f = resolve(p); need(f); const src = fs.readFileSync(f, 'utf8'), o = String(old ?? '');
    if (!o) fail('пустой фрагмент old');
    const n = src.split(o).length - 1;
    if (!n) fail('фрагмент old не найден в ' + show(f) + ' — прочитай файл и повтори');
    if (n > 1) fail(`фрагмент old встречается ${n} раз — добавь соседние строки, чтобы он был уникальным`);
    fs.writeFileSync(f, src.replace(o, () => String(neu ?? ''))); return `Готово: ${show(f)} изменён.`;
  },
  mkdir({ path: p }) { const d = resolve(p); fs.mkdirSync(d, { recursive: true }); return `Готово: создана папка ${show(d)}`; },
  move({ from, to }) {
    const f = resolve(from), t = resolve(to); need(f); if (f === HOME) fail('нельзя перемещать домашнюю папку');
    const dst = stat(t)?.isDirectory() ? path.join(t, path.basename(f)) : t;
    fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.renameSync(f, dst); return `Готово: ${show(f)} → ${show(dst)}`;
  },
  delete({ path: p }) {
    const f = resolve(p); if (f === HOME || f === path.parse(f).root) fail('нельзя удалить домашнюю папку целиком');
    const s = fs.lstatSync(f, { throwIfNoEntry: false }); if (!s) fail('не найден: ' + show(f));
    fs.rmSync(f, { recursive: true, force: true }); return `Готово: ${s.isDirectory() ? 'удалена папка' : 'удалён файл'} ${show(f)}`;
  },
  // открытые порты (для превью сайтов)
  ports() {
    const seen = new Set();
    for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
      let rows = []; try { rows = fs.readFileSync(f, 'utf8').trim().split('\n').slice(1); } catch {}
      for (const row of rows) {
        const [, local, , st] = row.trim().split(/\s+/); if (st !== '0A') continue; // 0A — LISTEN
        seen.add(parseInt(local.split(':')[1], 16));
      }
    }
    return [...seen].filter((p) => p >= 1024).sort((a, b) => a - b).map((port) => ({ port }));
  },
  // для файлового менеджера в чате
  ls({ path: p }) { const d = resolve(p); if (!need(d, 'папка').isDirectory()) fail('это не папка: ' + show(d)); return { path: show(d), entries: entries(d).slice(0, 1000) }; },
  get({ path: p }) {
    const f = resolve(p), s = need(f); if (!s.isFile()) fail('это не файл: ' + show(f));
    if (s.size > GET_MAX) fail(`файл больше ${kb(GET_MAX)} — заархивируйте часть или скачайте по частям`);
    return { name: path.basename(f), size: s.size, b64: fs.readFileSync(f).toString('base64') };
  },
  put({ path: p, b64 }) {
    const f = resolve(p); if (stat(f)?.isDirectory()) fail('с таким именем уже есть папка: ' + show(f));
    fs.mkdirSync(path.dirname(f), { recursive: true }); const buf = Buffer.from(String(b64 || ''), 'base64'); fs.writeFileSync(f, buf);
    return `Готово: ${show(f)} (${kb(buf.length)})`;
  },
};

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  let res;
  try {
    const { op, args } = JSON.parse(input || '{}');
    if (!Object.hasOwn(ops, op)) fail('неизвестная операция: ' + op);
    fs.mkdirSync(HOME, { recursive: true });
    res = { ok: true, out: ops[op](args || {}) };
  } catch (e) { res = { ok: false, error: String(e.message || e).replace(/^E[A-Z]+: /, '') }; }
  process.stdout.write(JSON.stringify(res));
});
