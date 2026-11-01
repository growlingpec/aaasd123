// Premier — клиент: archives (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- архивы: ZIP и TAR.GZ прямо в браузере ---------- */
function packRoot(files, src) {
  const firsts = new Set(files.map((f) => f.path.includes('/') ? f.path.split('/')[0] : ''));
  if (files.length && firsts.size === 1 && !firsts.has('')) return { root: [...firsts][0], prefix: '' };
  const en = entryOf(files), t = en ? artTitle(en.code) : '';
  const slug = (t && t !== 'Сайт' ? t : 'project').toLowerCase().replace(/[«»"'.,!?:;()]/g, '').trim().replace(/\s+/g, '-').replace(/[^\wа-яё-]/gi, '').slice(0, 40) || 'project';
  return { root: slug, prefix: slug + '/' };
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (d) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
async function squeeze(data, fmt) {
  try { return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream(fmt))).arrayBuffer()); } catch { return null; }
}
async function makeZip(entries) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const e of entries) {
    const name = enc.encode(e.name), data = e.data instanceof Uint8Array ? e.data : enc.encode(e.code), crc = crc32(data);
    const def = await squeeze(data, 'deflate-raw'), useDef = def && def.length < data.length, body = useDef ? def : data;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, useDef ? 8 : 0, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, useDef ? 8 : 0, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    parts.push(h, name, body); central.push(c, name); off += 30 + name.length + body.length;
  }
  const csize = central.reduce((n, x) => n + x.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
async function makeTgz(entries) {
  const enc = new TextEncoder(), chunks = [];
  for (const e of entries) {
    const data = e.data instanceof Uint8Array ? e.data : enc.encode(e.code), h = new Uint8Array(512); let name = enc.encode(e.name), prefix = new Uint8Array(0);
    if (name.length > 100) { const i = e.name.lastIndexOf('/', e.name.length - 1); prefix = enc.encode(e.name.slice(0, i)); name = enc.encode(e.name.slice(i + 1)); }
    const put = (str, at, len) => h.set(typeof str === 'string' ? enc.encode(str).slice(0, len) : str.slice(0, len), at);
    put(name, 0, 100); put('0000644\0', 100, 8); put('0000000\0', 108, 8); put('0000000\0', 116, 8);
    put(data.length.toString(8).padStart(11, '0') + '\0', 124, 12); put(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12);
    put('        ', 148, 8); put('0', 156, 1); put('ustar\0', 257, 6); put('00', 263, 2); put(prefix, 345, 155);
    put(h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8);
    chunks.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  chunks.push(new Uint8Array(1024));
  const gz = await squeeze(new Blob(chunks), 'gzip');
  return gz ? new Blob([gz], { type: 'application/gzip' }) : new Blob(chunks, { type: 'application/x-tar' });
}
function saveBlob(blob, name) { const u = URL.createObjectURL(blob), l = document.createElement('a'); l.href = u; l.download = name; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000); }
async function downloadPack(mid, fmt) {
  const src = findMsg(mid)?.t || ''; let files = getFiles(src);
  if (!files.length) files = PremierArtifact.latest(src)?.files || []; if (!files.length) return;
  const { root, prefix } = packRoot(files, src);
  try { const entries = await PremierAssets.entries(files.map(f => ({ name: prefix + f.path, code: f.code })), root); const blob = fmt === 'tgz' ? await makeTgz(entries) : await makeZip(entries); saveBlob(blob, root + (fmt === 'tgz' ? (blob.type === 'application/gzip' ? '.tar.gz' : '.tar') : '.zip')); }
  catch (e) { toast('Не удалось собрать архив: ' + e.message); }
}
const inline = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
// таблицы Markdown: | a | b | + строка-разделитель |---|:---:|
const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
const isRow = (l) => /^\s*\|.*\|\s*$/.test(l || '');
const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || '');
function table(rows) {
  const al = cells(rows[1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''));
  const td = (tag, c, i) => `<${tag}${al[i] ? ` style="text-align:${al[i]}"` : ''}>${inline(c)}</${tag}>`;
  return `<div class="tbl"><table><thead><tr>${cells(rows[0]).map((c, i) => td('th', c, i)).join('')}</tr></thead><tbody>${rows.slice(2).map((r) => `<tr>${cells(r).map((c, i) => td('td', c, i)).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function block(t) {
  let h = '', list = null; const close = () => { if (list) { h += `</${list}>`; list = null; } };
  const lines = t.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; let m;
    if (isRow(line) && isSep(lines[i + 1])) { close(); const rows = [line, lines[i + 1]]; i += 2; while (i < lines.length && isRow(lines[i])) rows.push(lines[i++]); i--; h += table(rows); continue; }
    if (!line.trim() || /^\s*([-*]|\d+[.)])\s*$/.test(line)) { close(); continue; }
    if ((m = line.match(/^#{1,4}\s+(.*)/))) { close(); h += `<h3>${inline(m[1])}</h3>`; }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { close(); h += '<ul>'; list = 'ul'; } h += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); h += '<ol>'; list = 'ol'; } h += `<li>${inline(m[1])}</li>`; }
    else { close(); h += `<p>${inline(line)}</p>`; }
  }
  close(); return h;
}
