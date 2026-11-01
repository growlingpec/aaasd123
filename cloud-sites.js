'use strict';
// Публикация папки из облачного компьютера: снимок статических файлов в data/sites/<id>/ — постоянная ссылка /s/<id>,
// которая работает, даже когда компьютер спит. Раздаёт publication.js (тот же sandbox и плашка Premier, что у сайтов
// из чата). Повторная публикация той же папки обновляет сайт по прежней ссылке.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 25 * 1048576, MAX_FILES = 2000, MAX_SITES = 20;
const SKIP = new Set(['node_modules', '__pycache__']);
const mbs = (n) => (n / 1048576).toFixed(1).replace(/\.0$/, '') + ' МБ';

const TOOL = { type: 'function', function: { name: 'computer_publish', description: 'Опубликовать папку с готовым сайтом из облачного компьютера по постоянной ссылке, которую можно отправить кому угодно (работает и когда компьютер спит). Нужен index.html в папке; скрытые файлы и node_modules не публикуются. Повторная публикация той же папки обновляет сайт по той же ссылке. Пользователь подтверждает.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Папка сайта, например ~/landing или ~/app/dist' } }, required: ['path'] } } };
const NOTE = '\n- Постоянная ссылка для всех: computer_publish с папкой сайта (статические файлы: index.html, CSS, JS, картинки). Серверный код (Python, Node) так не работает — только то, что открывается в браузере. Для Vite/React сначала собери с относительными путями: npx vite build --base=./ и публикуй папку dist. Ссылку из результата передай пользователю.';

function createCloudSites({ dir, cloud, store }) {
  const index = (uid) => store.kv.get('cloudsites:' + uid, []);
  const saveIndex = (uid, list) => store.kv.set('cloudsites:' + uid, list);
  const metaOf = (id) => { try { return JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8')); } catch { return null; } };

  // статические файлы папки: без ссылок (symlink), скрытых файлов и node_modules
  function collect(root) {
    const files = []; let bytes = 0;
    const walk = (d, rel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
        const r = rel ? rel + '/' + e.name : e.name, full = path.join(d, e.name);
        if (e.isDirectory()) walk(full, r);
        else if (e.isFile()) {
          const size = fs.lstatSync(full).size; bytes += size; files.push({ r, full, size });
          if (files.length > MAX_FILES) throw new Error(`в папке больше ${MAX_FILES} файлов — опубликуйте только папку сайта (для Vite/React — dist после сборки)`);
          if (bytes > MAX_BYTES) throw new Error(`папка больше ${mbs(MAX_BYTES)} — опубликуйте только папку сайта (для Vite/React — dist после сборки)`);
        }
      }
    };
    walk(root, '');
    return { files, bytes };
  }
  // ссылки от корня (/style.css) ведут на корень Premier — переводим их в папку сайта
  const rewrite = (id, rel, buf) => {
    const ext = path.extname(rel).toLowerCase(), base = `/s/${id}/`;
    if (ext === '.html' || ext === '.htm') return Buffer.from(buf.toString('utf8').replace(/(\s(?:src|href|action|poster)\s*=\s*["'])\/(?![/\\])/gi, `$1${base}`));
    if (ext === '.css') return Buffer.from(buf.toString('utf8').replace(/url\(\s*(["']?)\/(?![/\\])/gi, `url($1${base}`));
    return buf;
  };

  function publish(uid, src) {
    const abs = cloud.hostPath(uid, src);
    if (abs == null) throw new Error('опубликовать можно только папку внутри ~');
    const st = fs.statSync(abs, { throwIfNoEntry: false });
    if (!st || !cloud.inside(uid, abs) || fs.lstatSync(abs).isSymbolicLink()) throw new Error('папка не найдена: ' + src);
    if (!st.isDirectory()) throw new Error('нужна папка, а не файл: ' + cloud.tilde(uid, abs));
    const { files, bytes } = collect(abs);
    const html = files.filter((f) => !f.r.includes('/') && /\.html?$/i.test(f.r));
    const entry = html.find((f) => f.r.toLowerCase() === 'index.html') || (html.length === 1 ? html[0] : null);
    if (!entry) throw new Error('в папке нет index.html — опубликовать можно папку с готовым сайтом (для Vite/React — dist после сборки)');
    const from = cloud.tilde(uid, abs), list = index(uid), old = list.find((x) => x.src === from);
    if (!old && list.length >= MAX_SITES) throw new Error(`опубликовано уже ${MAX_SITES} сайтов — снимите ненужные (вкладка «Сайты»)`);
    const id = old?.id || crypto.randomBytes(5).toString('hex'), prev = old && metaOf(id);
    const tmp = path.join(dir, `${id}.tmp-${crypto.randomBytes(3).toString('hex')}`);
    fs.mkdirSync(tmp, { recursive: true });
    try {
      for (const f of files) {
        const to = path.join(tmp, f.r); fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.writeFileSync(to, rewrite(id, f.r, fs.readFileSync(f.full)));
      }
      const title = (/<title[^>]*>([^<]{1,200})<\/title>/i.exec(fs.readFileSync(entry.full, 'utf8')) || [])[1]?.trim() || path.basename(abs);
      const meta = { key: prev?.key || crypto.randomBytes(16).toString('hex'), uid, title, created: prev?.created || new Date().toISOString(), updated: new Date().toISOString(), dir: true, src: from, entry: entry.r, files: files.length, bytes };
      const live = path.join(dir, id), trashDir = live + '.old-' + crypto.randomBytes(3).toString('hex');
      if (fs.existsSync(live)) fs.renameSync(live, trashDir);
      fs.renameSync(tmp, live);
      fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(meta));
      fs.rmSync(trashDir, { recursive: true, force: true });
      if (!old) { list.unshift({ id, src: from }); saveIndex(uid, list); }
      return { id, path: '/s/' + id, title, src: from, files: files.length, bytes, updated: !!old };
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  function list(uid) {
    return index(uid).map((x) => { const m = metaOf(x.id); return m && m.uid === uid ? { id: x.id, path: '/s/' + x.id, title: m.title, src: m.src, files: m.files, bytes: m.bytes, updated: m.updated } : null; }).filter(Boolean);
  }
  function unpublish(uid, id) {
    const m = metaOf(id); if (!m || m.uid !== uid || !m.dir) return false;
    fs.rmSync(path.join(dir, id), { recursive: true, force: true }); fs.rmSync(path.join(dir, id + '.json'), { force: true });
    saveIndex(uid, index(uid).filter((x) => x.id !== id)); return true;
  }
  const removeUser = (uid) => { for (const x of index(uid)) unpublish(uid, x.id); store.kv.set('cloudsites:' + uid, []); };
  return { publish, list, unpublish, removeUser, TOOL, NOTE, mbs };
}

module.exports = { createCloudSites, MAX_BYTES };
