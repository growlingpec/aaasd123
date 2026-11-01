// Premier — клиент: attachments (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- attachments ---------- */
let PEND = [];
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|mjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|bat|ps1|sql|yaml|yml|toml|ini|cfg|log|env|vue|svelte|swift|dart|r|lua|tex|srt|vtt)$/i;
const MAX_TEXT = 100000, MAX_FILE = 20 * 1024 * 1024;
const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2600); }
function renderAtts() {
  const el = $('atts'); el.hidden = !PEND.length;
  el.innerHTML = PEND.map((x) => x.kind === 'img'
    ? `<div class="att img${x.loading ? ' loading' : ''}">${x.url ? `<img src="${x.url}" alt="">` : ''}<button type="button" class="rm" data-rmatt="${x.id}" aria-label="Remove"><svg style="width:12px;height:12px"><use href="#i-x"/></svg></button></div>`
    : `<div class="att${x.loading ? ' loading' : ''}"><span class="ai"><svg><use href="#i-file"/></svg></span><span style="min-width:0"><span class="nm">${esc(x.name)}</span><small>${x.loading ? 'reading…' : fmtSize(x.size)}</small></span><button type="button" class="rm" data-rmatt="${x.id}" aria-label="Remove"><svg style="width:12px;height:12px"><use href="#i-x"/></svg></button></div>`).join('');
}
function uAtts(m) {
  if (!m.files?.length && !m.images?.length) return '';
  return `<div class="uatt">${(m.images || []).map((u) => `<img src="${u}" alt="Image" data-zoom>`).join('')}${(m.files || []).map((f) => `<div class="att"><span class="ai"><svg><use href="#i-file"/></svg></span><span style="min-width:0"><span class="nm">${esc(f.name)}</span><small>${fmtSize(f.size)}</small></span></div>`).join('')}</div>`;
}
function apiContent(m) {
  let text = (m.files || []).map((f) => `[File: ${f.name}]\n${f.text}\n[End of file]`).join('\n\n');
  if (m.t) text = text ? text + '\n\n' + m.t : m.t;
  if (m.pick) text = `[The user selected an element on website “${m.pick.title}»]\nSelector: ${m.pick.sel}\nElement HTML:\n\`\`\`html\n${m.pick.html}\n\`\`\`\nChange only this element as requested below (leave everything else unchanged) and return the complete website using the same method as before.\n\n` + text;
  if (!text && m.images?.length) text = 'What is in this image?';
  if (!m.images?.length) return text;
  return [{ type: 'text', text }, ...m.images.map((url) => ({ type: 'image_url', image_url: { url } }))];
}
function addFiles(list) {
  for (const f of list) {
    if (f.size > MAX_FILE) { toast(`«${f.name}» is larger than 20 MB`); continue; }
    const item = { id: uid(), name: f.name, size: f.size, loading: true, kind: f.type.startsWith('image/') ? 'img' : 'file' };
    PEND.push(item);
    (item.kind === 'img' ? readImage(f).then((u) => (item.url = u)) : readText(f).then((t) => {
      if (t.images) { // PDF без текста: страницы идут картинками сразу после файла
        if (PEND.includes(item)) PEND.splice(PEND.indexOf(item) + 1, 0, ...t.images.map((url) => ({ id: uid(), kind: 'img', url })));
        toast(`«${f.name}»: ${t.text}`); t = t.text;
      }
      item.text = t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '\n…[truncated]' : t;
    }))
      .catch((e) => { PEND = PEND.filter((x) => x !== item); toast(`«${f.name}»: ${e.message}`); })
      .finally(() => { item.loading = false; renderAtts(); renderSend(); });
  }
  renderAtts(); renderSend();
}
function readImage(f) {
  return new Promise((ok, fail) => {
    const img = new Image(), u = URL.createObjectURL(f);
    img.onload = () => {
      const max = 1280, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u); ok(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(u); fail(new Error('could not open the image')); };
    img.src = u;
  });
}
async function readText(f) {
  const n = f.name.toLowerCase();
  if (n.endsWith('.pdf')) return readPdf(f);
  if (n.endsWith('.zip')) return readZip(f);
  if (/\.(docx|xlsx|pptx)$/.test(n)) return readOffice(f, n.slice(-4));
  if (TEXT_EXT.test(n) || f.type.startsWith('text/') || /json|xml|javascript/.test(f.type)) return f.text();
  throw new Error('this format is not supported yet');
}
// --- PDF через pdf.js (грузится с CDN при первом использовании) ---
let pdfjsP = null;
async function readPdf(f) {
  pdfjsP ||= import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs').then((m) => { m.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs'; return m; });
  let pdfjs; try { pdfjs = await pdfjsP; } catch { pdfjsP = null; throw new Error('could not load the PDF module'); }
  const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
  const out = [];
  for (let i = 1; i <= Math.min(doc.numPages, 200); i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map((x) => x.str + (x.hasEOL ? '\n' : '')).join(''));
    if (out.join('').length > MAX_TEXT) break;
  }
  const t = out.join('\n\n').trim();
  if (t) return t;
  // скан или презентация из картинок — отдаём страницы изображениями (их читают модели со зрением)
  const images = await pdfPages(doc).catch(() => []);
  if (!images.length) throw new Error('the PDF contains no text (it may be a scan)');
  return { images, text: `the PDF contains no text — pages attached as images: ${images.length} of ${doc.numPages}` };
}
const PDF_IMG_PAGES = 15; // больше — тяжело для памяти браузера и синхронизации чатов (15 МБ)
async function pdfPages(doc) {
  const urls = [];
  for (let i = 1; i <= Math.min(doc.numPages, PDF_IMG_PAGES); i++) {
    const page = await doc.getPage(i), v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 1280 / Math.max(v1.width, v1.height) });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    urls.push(c.toDataURL('image/jpeg', 0.8)); page.cleanup();
  }
  return urls;
}
// --- DOCX / XLSX / PPTX: мини-распаковщик zip без библиотек ---
async function unzip(buf) {
  const v = new DataView(buf), files = {}; let e = buf.byteLength - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('file is corrupted');
  let p = v.getUint32(e + 16, true); const cnt = v.getUint16(e + 10, true), dec = new TextDecoder();
  for (let i = 0; i < cnt; i++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nl));
    files[name] = { method, size, off }; p += 46 + nl + xl + cl;
  }
  const get = async (name) => {
    const f = files[name]; if (!f) return null;
    const ln = v.getUint16(f.off + 26, true), lx = v.getUint16(f.off + 28, true);
    const data = new Uint8Array(buf, f.off + 30 + ln + lx, f.size);
    if (f.method === 0) return dec.decode(data);
    const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(ds).text();
  }; get.names = Object.keys(files); return get;
}
async function readZip(f) {
  const get = await unzip(await f.arrayBuffer());
  const names = (get.names || []).filter((k) => !k.endsWith('/') && !/node_modules|\.git\//.test(k));
  const parts = []; let total = 0, skipped = 0;
  for (const k of names.slice(0, 500)) {
    if (total > MAX_TEXT - 2000) break;
    let t; try { t = await get(k); } catch { skipped++; continue; }
    if (t == null) continue;
    if (/[-\b]/.test(t.slice(0, 4000))) { skipped++; continue; }
    parts.push('File: ' + k + '\n```\n' + t + '\n```'); total += t.length;
  }
  if (!parts.length) throw new Error('no text files found in zip');
  return parts.join('\n\n') + (skipped ? '\n(' + skipped + ' binary files skipped)' : '');
}

const xmlText = (x) => x.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
async function readOffice(f, ext) {
  const get = await unzip(await f.arrayBuffer());
  if (ext === 'docx') {
    const x = await get('word/document.xml'); if (!x) throw new Error('this does not look like a Word document');
    return x.split(/<\/w:p>/).map((par) => xmlText(par.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n'))).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  if (ext === 'pptx') {
    const out = [];
    for (let i = 1; i <= 300; i++) { const x = await get(`ppt/slides/slide${i}.xml`); if (!x) break; out.push(`--- Slide ${i} ---\n` + x.split(/<\/a:p>/).map(xmlText).filter((s) => s.trim()).join('\n')); }
    if (!out.length) throw new Error('the presentation contains no slides'); return out.join('\n\n');
  }
  const ss = await get('xl/sharedStrings.xml');
  const strings = ss ? [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1])) : [];
  const wb = (await get('xl/workbook.xml')) || '', names = [...wb.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => xmlText(m[1]));
  const out = [];
  for (let i = 1; i <= 50; i++) {
    const x = await get(`xl/worksheets/sheet${i}.xml`); if (!x) break;
    const rows = [...x.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
      const t = (c[1].match(/t="(\w+)"/) || [])[1], val = ((c[2] || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (t === 's') return strings[+val] ?? ''; if (t === 'inlineStr') return xmlText(c[2] || ''); return val != null ? xmlText(val) : '';
    }).join('\t'));
    out.push(`--- Sheet: ${names[i - 1] || i} ---\n` + rows.join('\n'));
  }
  if (!out.length) throw new Error('the spreadsheet contains no sheets'); return out.join('\n\n');
}
$('fileIn').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
const box = $('form');
['dragenter', 'dragover'].forEach((ev) => box.addEventListener(ev, (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); box.classList.add('drag'); } }));
['dragleave', 'drop'].forEach((ev) => box.addEventListener(ev, () => box.classList.remove('drag')));
box.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } });
$('q').addEventListener('paste', (e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
