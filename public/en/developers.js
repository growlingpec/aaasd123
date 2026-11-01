'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => `<svg aria-hidden="true"><use href="#ic-${name}"/></svg>`;
  let data = null, language = 'curl', code = '', toastTimer, revokeId = null, mutationBusy = false;
  const date = n => new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(n));
  const fullDate = n => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(n));
  function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 3500); }
  async function copy(value) {
    try { await navigator.clipboard.writeText(value); toast('Copied'); return true; }
    catch { toast('Select and copy the value manually: the clipboard is unavailable.'); return false; }
  }
  async function request(path, options = {}) {
    const r = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 401) { location.replace('/login'); throw new Error('Sign in to your account'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : 'The request failed. Please try again.');
    return j;
  }
  function openCreate() {
    if (!data || mutationBusy) return;
    if (data.keys.length >= 5) { toast('Maximum 5 keys per account. To create a new one, revoke one first.'); return; }
    $('apiKeyForm').reset(); $('createError').textContent = '';
    resetModelPick();
    $('createDialog').showModal();
  }
  function paintModels() {
    $('modelCount').textContent = data.models.length;
    $('navModels').textContent = data.models.length;
    $('apiModelList').innerHTML = data.models.length ? data.models.map(m => {
      const w = Math.max(0.1, Number(m.weight) || 1), units = w === 1 ? 'message' : 'messages';
      return `<article class="model-card"><div class="model-card-head"><span class="model-glyph" aria-hidden="true">${esc(m.name?.slice(0, 1).toUpperCase() || 'M')}</span><div><h3>${esc(m.name)}</h3>${m.vision ? '<span class="vision-tag">Vision</span>' : ''}</div></div><div class="model-id-label">MODEL ID</div><div class="model-id"><code>${esc(m.id)}</code><button class="icon-button" data-api-model="${esc(m.id)}" aria-label="Copy Model ID: ${esc(m.name)}" title="Copy Model ID">${icon('copy')}</button></div><div class="model-cost"><b>${esc(w)} ${units}</b> per request</div></article>`;
    }).join('') : `<div class="empty-state panel"><span class="empty-icon">${icon('model')}</span><h3>No models available yet</h3><p>Models will appear here once connected and available on your plan.</p><a class="button" href="/chat">Back to chat</a></div>`;
    document.querySelectorAll('[data-api-model]').forEach(b => b.addEventListener('click', () => copy(b.dataset.apiModel)));
    $('codeModel').replaceChildren(...data.models.map(m => new Option(m.name, m.id)));
    $('codeModel').disabled = !data.models.length;
    if (!data.models.length) $('codeModel').append(new Option('No models available', ''));
    paintKeyModelPicker();
    renderCode();
  }
  function paintKeyModelPicker() {
    const box = $('apiKeyModels'); if (!box || box.dataset.built) return; box.dataset.built = '1';
    box.innerHTML = data.models.map(m => `<label class="model-check"><input type="checkbox" value="${esc(m.id)}"><span>${esc(m.name)}</span><span class="mid">${esc(m.id)}</span></label>`).join('');
  }
  function resetModelPick() {
    const all = $('apiKeyAllModels'); if (!all) return; all.checked = true;
    const box = $('apiKeyModels'); box.classList.remove('open'); box.querySelectorAll('input').forEach(i => i.checked = false);
  }
  function paintKeys() {
    $('keyCount').textContent = `${data.keys.length} / 5`;
    $('apiKeysList').innerHTML = data.keys.length ? `<div class="keys-head" aria-hidden="true"><span>Name</span><span>Key</span><span>Expiration</span><span class="last-used">Last used</span><span></span></div>` + data.keys.map(k => {
      const expired = k.expires && k.expires <= Date.now();
      const mk = k.models ? `<span class="key-models" title="${esc(k.models.join(', '))}">${k.models.length === 1 ? '1 model' : k.models.length + ' models'}</span>` : '<span class="key-models all">All models</span>';
      return `<article class="key-row" aria-label="Key ${esc(k.name)}"><div class="key-name">${icon('key')}<div>${esc(k.name)}${mk}${expired ? '<span class="expired-label">Expired</span>' : ''}</div></div><code class="key-prefix">${esc(k.prefix)}</code><div class="key-date" title="${k.expires ? esc(fullDate(k.expires)) : 'No expiration'}">${k.expires ? esc(date(k.expires)) : 'No expiration'}</div><div class="key-date last-used" title="${k.last_used ? esc(fullDate(k.last_used)) : 'Not used yet'}">${k.last_used ? esc(date(k.last_used)) : 'Not used yet'}</div><button class="revoke-button" data-api-revoke="${esc(k.id)}" aria-label="Revoke key ${esc(k.name)}">Revoke</button></article>`;
    }).join('') : `<div class="empty-state"><span class="empty-icon">${icon('key')}</span><h3>Your first key. Your first request.</h3><p>Create a key for your bot, application or service. It only takes a few seconds.</p><button class="button" data-create-key>${icon('plus')}Create your first key</button></div>`;
    $('apiKeysList').querySelectorAll('[data-create-key]').forEach(b => b.addEventListener('click', openCreate));
    document.querySelectorAll('[data-api-revoke]').forEach(b => b.addEventListener('click', () => {
      if (mutationBusy) return;
      const k = data.keys.find(k => k.id === b.dataset.apiRevoke); if (!k) return;
      revokeId = k.id; $('revokeName').textContent = `«${k.name}»`; $('revokeError').textContent = ''; $('revokeDialog').showModal();
    }));
  }
  function highlight(source) {
    // Tokenize first, then escape every token: never render model names or URLs as HTML.
    const parts = source.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:import|from|const|await|new|print)\b)/g);
    return parts.map((s, i) => i % 2 ? `<span class="${/^["']/.test(s) ? 'syntax-string' : 'syntax-keyword'}">${esc(s)}</span>` : esc(s)).join('');
  }
  function renderCode() {
    if (!data) return;
    const id = $('codeModel').value || 'MODEL_ID', base = data.base_url, model = JSON.stringify(id), url = JSON.stringify(base);
    if (language === 'curl') {
      // POSIX-safe quoting for configurable URLs and JSON payloads.
      const sh = s => "'" + s.replace(/'/g, "'\\''") + "'";
      code = [
        'curl ' + sh(base + '/chat/completions'),
        '  -H "Authorization: Bearer $PREMIER_API_KEY"',
        "  -H 'Content-Type: application/json'",
        '  -d ' + sh(JSON.stringify({ model: id, messages: [{ role: 'user', content: 'Hello!' }] }))
      ].join(' \\\n');
      $('sdkHint').textContent = 'Terminal · cURL';
    } else if (language === 'python') {
      code = `import os\nfrom openai import OpenAI\n\nclient = OpenAI(\n    api_key=os.environ["PREMIER_API_KEY"],\n    base_url=${url},\n)\n\nreply = client.chat.completions.create(\n    model=${model},\n    messages=[\n        {"role": "user", "content": "Hello!"}\n    ],\n)\nprint(reply.choices[0].message.content)`;
      $('sdkHint').textContent = 'Install: pip install openai';
    } else {
      code = `import OpenAI from "openai";\n\nconst client = new OpenAI({\n  apiKey: process.env.PREMIER_API_KEY,\n  baseURL: ${url},\n});\n\nconst reply = await client.chat.completions.create({\n  model: ${model},\n  messages: [\n    { role: "user", content: "Hello!" }\n  ],\n});\nconsole.log(reply.choices[0].message.content);`;
      $('sdkHint').textContent = 'Node.js · npm install openai';
    }
    $('apiCode').innerHTML = highlight(code);
    $('copyCode').disabled = !data.models.length;
  }
  function selectLanguage(button, focus = false) {
    language = button.dataset.lang;
    document.querySelectorAll('[data-lang]').forEach(b => { const selected = b === button; b.classList.toggle('selected', selected); b.setAttribute('aria-selected', String(selected)); b.tabIndex = selected ? 0 : -1; });
    $('codePanel').setAttribute('aria-labelledby', button.id);
    if (focus) button.focus(); renderCode();
  }
  async function load() {
    $('pageError').hidden = true;
    try {
      const [account, keys] = await Promise.all([request('/api/account'), request('/api/account/api-keys')]);
      data = keys; $('userName').textContent = account.name || account.login || 'Account'; $('userAvatar').textContent = (account.name || account.login || 'P').slice(0, 1).toUpperCase();
      $('apiBaseUrl').value = data.base_url; $('apiCopyBase').disabled = false;
      document.querySelectorAll('[data-create-key]').forEach(b => b.disabled = false);
      paintModels(); paintKeys();
      request('/api/billing').then(b => {
        $('planName').textContent = b.plan.name;
        const used = b.used.m, total = b.limits.m;
        $('planUsage').textContent = total == null ? `${used} messages today · no plan limit` : `${used} of ${total} messages today`;
        $('planBar').style.width = total == null ? '0%' : `${Math.min(100, total > 0 ? used / total * 100 : 100)}%`;
      }).catch(() => { $('planName').textContent = '—'; $('planUsage').textContent = 'Could not load limits'; });
    } catch (e) {
      $('errorText').textContent = e.message; $('pageError').hidden = false;
      $('apiModelList').innerHTML = '<p class="loading-state">Models are temporarily unavailable.</p>';
      $('apiKeysList').innerHTML = '<p class="loading-state">Could not load keys. Please try again.</p>';
      $('apiCode').textContent = 'Reload the dashboard to get a request example.';
      $('apiBaseUrl').placeholder = 'Address temporarily unavailable';
    }
  }
  document.querySelectorAll('[data-create-key]').forEach(b => b.addEventListener('click', openCreate));
  document.querySelectorAll('[data-close-dialog]').forEach(b => b.addEventListener('click', () => { const d = b.closest('dialog'); if (d.id === 'secretDialog') $('apiSecretValue').value = ''; d.close(); }));
  document.querySelectorAll('dialog').forEach(d => {
    d.addEventListener('cancel', e => { if (mutationBusy) e.preventDefault(); });
    d.addEventListener('click', e => { if (e.target === d && !mutationBusy) { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); } });
  });
  $('secretDialog').addEventListener('close', () => { $('apiSecretValue').value = ''; });
  $('secretDialog').addEventListener('cancel', () => { $('apiSecretValue').value = ''; });
  $('apiHideSecret').addEventListener('click', () => { $('apiSecretValue').value = ''; $('secretDialog').close(); });
  $('apiCopyBase').addEventListener('click', () => copy($('apiBaseUrl').value));
  $('apiCopySecret').addEventListener('click', async () => {
    const ok = await copy($('apiSecretValue').value);
    $('apiCopySecret').innerHTML = icon(ok ? 'check' : 'copy') + (ok ? 'Key copied' : 'Copy the key manually');
  });
  $('copyCode').addEventListener('click', () => copy(code));
  $('reloadPage').addEventListener('click', load);
  $('codeModel').addEventListener('change', renderCode);
  document.querySelectorAll('[data-lang]').forEach(b => {
    b.addEventListener('click', () => selectLanguage(b));
    b.addEventListener('keydown', e => {
      const buttons = [...document.querySelectorAll('[data-lang]')], current = buttons.indexOf(b);
      const index = e.key === 'ArrowRight' ? (current + 1) % buttons.length : e.key === 'ArrowLeft' ? (current + buttons.length - 1) % buttons.length : e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : -1;
      if (index >= 0) { e.preventDefault(); selectLanguage(buttons[index], true); }
    });
  });
  function setBusy(busy) {
    mutationBusy = busy;
    document.querySelectorAll('dialog [data-close-dialog], #createDialog button, #confirmRevoke').forEach(b => b.disabled = busy);
  }
  $('apiKeyAllModels').addEventListener('change', () => {
    const all = $('apiKeyAllModels'), box = $('apiKeyModels');
    if (all.checked) box.querySelectorAll('input').forEach(i => i.checked = false);
    box.classList.toggle('open', !all.checked);
  });
  $('apiKeyForm').addEventListener('submit', async e => {
    e.preventDefault(); if (mutationBusy) return;
    $('createError').textContent = ''; setBusy(true); $('apiCreateKey').textContent = 'Creating…';
    try {
      const days = $('apiKeyDays').value;
      const allOn = $('apiKeyAllModels').checked;
      const picked = allOn ? [] : [...$('apiKeyModels').querySelectorAll('input:checked')].map(i => i.value);
      if (!allOn && !picked.length) { $('createError').textContent = 'Select at least one model or tick “All models”.'; return; }
      const item = await request('/api/account/api-keys', { method: 'POST', body: JSON.stringify({ name: $('apiKeyName').value.trim(), expires_days: days ? Number(days) : null, models: picked.length ? picked : null }) });
      $('apiSecretValue').value = item.key; delete item.key;
      $('apiCopySecret').innerHTML = icon('copy') + 'Copy key';
      data.keys.unshift(item); paintKeys(); $('createDialog').close(); $('secretDialog').showModal();
    } catch (e) { $('createError').textContent = e.message; }
    finally { setBusy(false); $('apiCreateKey').textContent = 'Create key'; }
  });
  $('confirmRevoke').addEventListener('click', async () => {
    if (mutationBusy || !revokeId) return;
    setBusy(true); $('revokeError').textContent = ''; $('confirmRevoke').textContent = 'Revoking…';
    try {
      await request('/api/account/api-keys/' + revokeId, { method: 'DELETE', body: '{}' });
      data.keys = data.keys.filter(k => k.id !== revokeId); paintKeys(); $('revokeDialog').close(); revokeId = null; toast('Key revoked');
    } catch (e) { $('revokeError').textContent = e.message; }
    finally { setBusy(false); $('confirmRevoke').textContent = 'Revoke key'; }
  });
  document.querySelectorAll('.side-nav a').forEach(a => a.addEventListener('click', () => { document.querySelectorAll('.side-nav a').forEach(x => x.classList.toggle('active', x === a)); }));
  window.addEventListener('pagehide', () => { $('apiSecretValue').value = ''; document.querySelectorAll('dialog[open]').forEach(d => d.close()); });
  load();
})();
