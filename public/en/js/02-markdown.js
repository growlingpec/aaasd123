// Premier — клиент: markdown (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- markdown + artifacts ---------- */
const FENCE = /```([\w-]*)([^\n]*)\n([\s\S]*?)(```|$)/g;
const isHtml = (lang, code) => /^html?$/i.test(lang) || (!lang && /^\s*<(!doctype|html)/i.test(code));
const artTitle = (code) => (code.match(/<title>([^<]*)<\/title>/i)?.[1] || '').trim() || 'Website';
/* файлы: ```html:my-site/index.html  (а также path=…, file=…, ```index.html) */
function normPath(p) {
  const out = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) { if (!seg || seg === '.') continue; if (seg === '..') out.pop(); else out.push(seg.replace(/[<>:"|?*\x00-\x1f]/g, '_')); }
  return out.join('/').slice(0, 200);
}
function fpath(lang, info) {
  info = info.trim(); let m;
  if (lang && /^[.\/]/.test(info)) return normPath(lang + info.split(/\s/)[0]);
  if ((m = info.match(/^:\s*(\S+)/))) return normPath(m[1]);
  if ((m = info.match(/\b(?:path|file|filename|name|title)\s*=\s*["']?([^"'\s]+)/i))) return normPath(m[1]);
  if ((m = info.match(/^([\w.\-\/]+\.\w{1,8})$/))) return normPath(m[1]);
  return null;
}
function getFiles(src) {
  const map = new Map(); let m; FENCE.lastIndex = 0;
  while ((m = FENCE.exec(src))) { const p = fpath(m[1], m[2]); if (p) { map.delete(p); map.set(p, { path: p, code: m[3], closed: !!m[4], lang: m[1] }); } }
  return [...map.values()];
}
const entryOf = (files) => files.filter((f) => /\.html?$/i.test(f.path)).sort((a, b) => (/(^|\/)index\.html?$/i.test(b.path) - /(^|\/)index\.html?$/i.test(a.path)) || a.path.length - b.path.length)[0];
function inlineSite(files, entry) {
  const dir = entry.path.replace(/[^/]*$/, '');
  const get = (ref) => /^(https?:|data:|blob:|\/\/|#|mailto:)/i.test(ref) ? null : files.find((f) => f.path === normPath(dir + ref.split(/[?#]/)[0]));
  let h = entry.code;
  h = h.replace(/<link\b[^>]*>/gi, (tag) => { if (!/stylesheet/i.test(tag)) return tag; const f = get(tag.match(/href\s*=\s*["']([^"']+)/i)?.[1] || ''); return f ? `<style>\n${f.code.replace(/<\/style/gi, '<\\/style')}\n</style>` : tag; });
  h = h.replace(/<script\b([^>]*?)\ssrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a, src, b) => { const f = get(src); return f ? `<script${a}${b}>\n${f.code.replace(/<\/script/gi, '<\\/script')}\n</script>` : tag; });
  h = h.replace(/(src|href)\s*=\s*["']([^"']+\.svg)["']/gi, (all, attr, ref) => { const f = get(ref); return f ? `${attr}="data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.code)}"` : all; });
  return h;
}
function getArts(src) {
  const arts = []; let m; FENCE.lastIndex = 0;
  while ((m = FENCE.exec(src))) if (!fpath(m[1], m[2]) && isHtml(m[1], m[3])) arts.push({ code: m[3], closed: !!m[4], title: artTitle(m[3]) });
  const files = getFiles(src), en = entryOf(files);
  if (en) arts.push({ code: inlineSite(files, en), closed: files.every((f) => f.closed), title: artTitle(en.code), pack: true });
  return arts;
}
const fmtB = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const plural = (n, a, b, c) => n === 1 ? a : b;
function packCard(mid, src, k) {
  const files = getFiles(src), done = files.every((f) => f.closed), en = entryOf(files), name = packRoot(files, src).root;
  const size = files.reduce((n, f) => n + new Blob([f.code]).size, 0);
  return `<div class="pack${done ? '' : ' building'}"><div class="pack-h"><span class="art-ic"><svg><use href="#i-zip"/></svg></span><span class="art-t"><b>${esc(files.length === 1 ? files[0].path.split('/').pop() : name + '.zip')}</b><small>${done ? `${files.length} ${plural(files.length, 'file', 'files', 'files')} · ${fmtB(size)}` : `Collecting files… ${files.length}`}</small></span></div>
    <div class="pack-b">${files.length === 1 ? `<button class="btn pri" data-fdl="${mid}" data-fp="${esc(files[0].path)}"${done ? '' : ' disabled'}>Download file</button>` : ''}<button class="btn${files.length === 1 ? '' : ' pri'}" data-zip="${mid}" data-fmt="zip"${done ? '' : ' disabled'}>Download ZIP</button><button class="btn" data-zip="${mid}" data-fmt="tgz"${done ? '' : ' disabled'}>TAR.GZ</button>${en ? `<button class="btn" data-art="${mid}:${k}">Preview</button>` : ''}</div></div>`;
}
function md(src, mid) {
  const out = []; let last = 0, m, k = 0, packAt = -1; FENCE.lastIndex = 0;
  while ((m = FENCE.exec(src))) {
    out.push(block(src.slice(last, m.index)));
    const lang = m[1], code = m[3], closed = !!m[4], fp = fpath(lang, m[2]);
    if (fp && mid) {
      if (packAt < 0) { packAt = out.length; out.push(''); }
      const n = code.replace(/\n$/, '').split('\n').length;
      out.push(`<details class="fileb"><summary><svg><use href="#i-file"/></svg><span class="fp">${esc(fp)}</span><small>${closed ? n + ' ' + plural(n, 'line', 'lines', 'lines') : 'writing…'}</small></summary><div class="pre"><div class="bar"><span>${esc(fp)}</span><span><button data-fdl="${mid}" data-fp="${esc(fp)}">Download</button><button data-copycode>Copy</button></span></div><pre><code>${esc(code.replace(/\n$/, ''))}</code></pre></div></details>`);
    } else if (mid && isHtml(lang, code)) {
      const on = A.open && A.mid === mid && A.k === k;
      out.push(`<button class="art${closed ? '' : ' building'}${on ? ' cur' : ''}" data-art="${mid}:${k}"><span class="art-ic"><svg><use href="#i-globe"/></svg></span><span class="art-t"><b>${esc(artTitle(code))}</b><small>${closed ? 'Website · HTML' : 'Building the website…'}</small></span><span class="art-go">${on ? 'Opened' : 'Open'}</span></button>`);
      k++;
    } else out.push(`<div class="pre"><div class="bar"><span>${esc(lang || 'code')}</span><button data-copycode>Copy</button></div><pre><code>${esc(code.replace(/\n$/, ''))}</code></pre></div>`);
    last = FENCE.lastIndex;
  }
  out.push(block(src.slice(last).replace(/`{1,3}[\w-]*$/, '')));
  if (packAt >= 0) out[packAt] = packCard(mid, src, k);
  return out.join('');
}
