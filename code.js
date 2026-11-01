// Premier — выполнение Python. Безопасный режим: Docker-контейнер без сети (образ premier-python, см. sandbox/).
// CODE_RUNNER=docker (по умолчанию) | local (без изоляции, только для своего компьютера!) | off
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODE = process.env.CODE_RUNNER || 'docker';
const IMAGE = process.env.CODE_IMAGE || 'premier-python';
const PY = process.env.PYTHON || 'python3';
const TIMEOUT = 60;
const ROOT = path.join(__dirname, 'data');
let avail = null, availAt = 0, running = 0;
const busyUsers = new Set();

function check() {
  if (MODE === 'off') return Promise.resolve({ ok: false, mode: MODE, error: 'Выполнение кода выключено (CODE_RUNNER=off)' });
  if (Date.now() - availAt < 60000 && avail) return Promise.resolve(avail);
  return new Promise((ok) => {
    const done = (r) => { avail = { mode: MODE, ...r }; availAt = Date.now(); ok(avail); };
    if (MODE === 'local') return execFile(PY, ['--version'], { timeout: 5000 }, (e, so, se) => done(e ? { ok: false, error: 'Не найден ' + PY } : { ok: true, version: (so || se).trim() }));
    execFile('docker', ['image', 'inspect', IMAGE, '--format', '{{.Id}}'], { timeout: 8000 }, (e, so, se) => {
      if (!e) return done({ ok: true });
      done({ ok: false, error: /not found|No such image/i.test(se) ? `Нет образа ${IMAGE}. Соберите: docker build -t ${IMAGE} sandbox` : /ENOENT/.test(e.message) ? 'Docker не установлен' : 'Docker недоступен: ' + String(se || e.message).split('\n')[0] });
    });
  });
}

const cap = (s, n) => s.length > n ? s.slice(0, n) + `\n…[обрезано, всего ${s.length} символов]` : s;
const IMG = /\.(png|jpe?g|gif|webp)$/i;

async function run(code, uid) {
  const st = await check(); if (!st.ok) throw new Error(st.error);
  if (busyUsers.has(uid)) throw new Error('уже выполняется другой код — дождитесь окончания');
  if (running >= 2) throw new Error('сервер занят выполнением кода, попробуйте через минуту');
  busyUsers.add(uid); running++;
  const id = crypto.randomBytes(8).toString('hex'), dir = path.join(ROOT, 'run', id), out = path.join(dir, 'out');
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'main.py'), String(code), { mode: 0o644 }); fs.chmodSync(dir, 0o755);
  const t0 = Date.now();
  try {
    let res, found;
    if (MODE === 'local') { // без изоляции: папка на диске сервера
      fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
      res = await spawnRun(PY, [path.join(dir, 'main.py')], { cwd: out, env: { PATH: process.env.PATH, MPLBACKEND: 'Agg', HOME: path.join(dir, 'home'), MPLCONFIGDIR: path.join(dir, 'home'), PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' } }, id);
      found = localFiles(out);
    } else { // Docker: код только для чтения, результаты — в памяти контейнера (не больше 50 МБ), обратно — архивом через stdout
      const r = await spawnRun('docker', dockerArgs(id, dir), {}, id, true);
      const t = untar(r.raw); res = { code: Number(t.meta.rc) || (r.code ? r.code : 0), so: t.meta.stdout || '', se: (t.meta.stderr || '') + (r.code && !t.ok ? r.se : ''), killed: r.killed || (Number(t.meta.rc) === 137 && Date.now() - t0 > TIMEOUT * 1000 - 2000) }; // 137 раньше срока — нехватка памяти
      if (!t.ok && !r.killed) res.se += (res.se ? '\n' : '') + 'Не удалось получить результаты выполнения';
      found = t.files;
    }
    const saved = [], fid = crypto.randomBytes(8).toString('hex'), dest = path.join(ROOT, 'files', uid, fid); let total = 0;
    for (const f of found.slice(0, 20)) {
      if (total + f.size > 25e6) break; total += f.size;
      const name = f.rel.replace(/[\/\\]/g, '_').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120);
      fs.mkdirSync(dest, { recursive: true }); const to = path.join(dest, name);
      if (f.data) fs.writeFileSync(to, f.data); else fs.copyFileSync(f.src, to);
      saved.push({ name, size: f.size, url: `/api/files/${fid}/${encodeURIComponent(name)}`, image: IMG.test(name) });
    }
    return { exit: res.code, timeout: res.killed, ms: Date.now() - t0, stdout: cap(res.so, 12000), stderr: cap(res.se.replace(/\/work\/(src\/)?main\.py/g, 'main.py'), 6000), files: saved };
  } finally {
    busyUsers.delete(uid); running--;
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}
// внутри контейнера: запуск с лимитом времени, затем папка out и вывод программы — одним tar-архивом в stdout
const INNER = `mkdir -p /tmp/meta && cd /work/out && timeout -s KILL ${TIMEOUT} python /work/src/main.py >/tmp/meta/so 2>/tmp/meta/se; echo $? >/tmp/meta/rc; ` +
  `head -c 200000 /tmp/meta/so >/tmp/meta/stdout; head -c 200000 /tmp/meta/se >/tmp/meta/stderr; rm -f /tmp/meta/so /tmp/meta/se; cd /work && exec tar -cf - --exclude=__pycache__ out -C /tmp/meta stdout stderr rc`;
const dockerArgs = (id, dir) => ['run', '--rm', '--name', 'premier-run-' + id, '--network', 'none', '--memory', '512m', '--memory-swap', '512m', '--cpus', '1', '--pids-limit', '128',
  '--read-only', '--tmpfs', '/tmp:rw,size=64m', '--mount', 'type=tmpfs,destination=/work/out,tmpfs-size=52428800,tmpfs-mode=1777',
  '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL', '--user', '65534:65534', '--ulimit', 'nofile=256:256', '--ulimit', 'fsize=52428800',
  '-e', 'MPLBACKEND=Agg', '-e', 'HOME=/tmp', '-e', 'MPLCONFIGDIR=/tmp', '-e', 'PYTHONIOENCODING=utf-8', '-e', 'PYTHONDONTWRITEBYTECODE=1',
  '-v', dir + ':/work/src:ro', '-w', '/work/out', IMAGE, 'sh', '-c', INNER];
const RAW_MAX = 60e6;
function spawnRun(cmd, args, opts, id, raw) {
  return new Promise((ok) => {
    const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] }); const bufs = []; let n = 0, so = '', se = '', killed = false;
    const kill = () => { if (MODE !== 'local') execFile('docker', ['kill', 'premier-run-' + id], () => {}); p.kill('SIGKILL'); };
    p.stdout.on('data', (d) => { if (raw) { n += d.length; if (n > RAW_MAX) { killed = true; return kill(); } bufs.push(d); } else if (so.length < 200000) so += d; });
    p.stderr.on('data', (d) => { if (se.length < 200000) se += d; });
    const timer = setTimeout(() => { killed = true; kill(); }, (TIMEOUT + (raw ? 30 : 0)) * 1000); // запас на запуск контейнера и упаковку
    p.on('error', (e) => { clearTimeout(timer); ok({ code: -1, so, se: se + e.message, killed, raw: Buffer.concat(bufs) }); });
    p.on('close', (c) => { clearTimeout(timer); ok({ code: c, so, se, killed: killed || (!raw && c === null), raw: Buffer.concat(bufs) }); });
  });
}
function localFiles(out) {
  const files = [];
  const walk = (d, rel = '') => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { if (files.length >= 200) return; if (n.name.startsWith('.') || n.name === '__pycache__') continue; const r = rel + n.name; if (n.isDirectory()) walk(path.join(d, n.name), r + '/'); else if (n.isFile()) { const src = path.join(d, n.name); files.push({ rel: r, src, size: fs.statSync(src).size }); } } };
  try { walk(out); } catch {}
  return files;
}
// разбор tar (ustar/GNU): обычные файлы из out/ и служебные meta/*; ссылки и прочее пропускаются
function untar(buf) {
  const files = [], meta = {}; let off = 0, longName = null, ok = false;
  const str = (a, b) => buf.toString('utf8', a, b).replace(/\0[\s\S]*$/, '');
  while (off + 512 <= buf.length) {
    if (buf[off] === 0 && buf.subarray(off, off + 512).every((x) => x === 0)) { ok = true; break; }
    const size = parseInt(str(off + 124, off + 136).trim() || '0', 8) || 0, type = String.fromCharCode(buf[off + 156] || 48);
    let name = longName || ((str(off + 345, off + 500) ? str(off + 345, off + 500) + '/' : '') + str(off, off + 100)); longName = null;
    const start = off + 512, end = start + size; if (end > buf.length) break;
    if (type === 'L') longName = buf.toString('utf8', start, end).replace(/\0+$/, '');
    else if (type === '0' || type === '\0' || type === '7') {
      name = name.replace(/^\.\//, '');
      if (/^(stdout|stderr|rc)$/.test(name)) meta[name] = buf.toString('utf8', start, end);
      else if (name.startsWith('out/') && !name.split('/').some((x) => x === '..' || x.startsWith('.')) && files.length < 200) files.push({ rel: name.slice(4), size, data: Buffer.from(buf.subarray(start, end)) });
    }
    off = start + Math.ceil(size / 512) * 512;
  }
  if (!ok && off >= buf.length && buf.length) ok = true; // архив без завершающих нулей
  return { files, meta, ok: ok && 'rc' in meta };
}
// путь к файлу пользователя (или null)
function filePath(uid, fid, name) {
  if (!/^[a-f0-9]{16}$/.test(fid)) return null;
  const p = path.join(ROOT, 'files', uid, fid, path.basename(name));
  return fs.existsSync(p) ? p : null;
}
const removeUser = (uid) => fs.rm(path.join(ROOT, 'files', uid), { recursive: true, force: true }, () => {});

const TOOL = { type: 'function', function: { name: 'run_python', description: 'Выполнить код на Python 3 (numpy, pandas, matplotlib, seaborn, scipy, openpyxl, xlsxwriter, python-docx, python-pptx, reportlab, pillow). Нет интернета. Файлы, сохранённые в текущую папку, пользователь увидит и сможет скачать; картинки (png/jpg) показываются в чате. Печатай результаты через print().', parameters: { type: 'object', properties: { code: { type: 'string', description: 'Полный код программы' } }, required: ['code'] } } };
const NOTE = `\n\nУ тебя есть инструмент run_python — настоящий Python 3 на сервере (без интернета, лимит 60 секунд).
- Используй его для точных вычислений, анализа данных (CSV/Excel из сообщения — вставь данные в код), графиков и создания файлов: Excel (.xlsx), Word (.docx), PowerPoint (.pptx), PDF, CSV, картинок, ZIP.
- Сохраняй файлы в текущую папку с понятными именами (plt.savefig('grafik.png'), doc.save('otchet.docx')). Пользователь сразу видит их и может скачать — не вставляй ссылки на них сам.
- Для кириллицы в PDF (reportlab) регистрируй шрифт /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf. В matplotlib кириллица работает по умолчанию.
- Если код упал — исправь и запусти снова. После выполнения кратко объясни результат.
- Для простых вопросов код не нужен.`;

module.exports = { check, run, filePath, removeUser, TOOL, NOTE, MODE, untar, INNER, dockerArgs };
