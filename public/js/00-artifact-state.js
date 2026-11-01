// Общие чистые функции для браузера и Node: выбор актуальной версии, без DOM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PremierArtifact = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_SOURCE = 2 * 1024 * 1024;
  const titleOf = (html) => (html.match(/<title>([^<]*)<\/title>/i)?.[1] || 'Сайт').trim().slice(0, 120);
  const fullHtml = (html) => /<(?:!doctype|html|body)\b/i.test(html) && /<\/html\s*>/i.test(html);
  function safePath(path) {
    return typeof path === 'string' && path.length <= 200 && path.length > 0 &&
      !/^(?:\/|\\|[a-z]:)/i.test(path) && !/[\\\x00-\x1f<>:"|?*]/.test(path) &&
      path.split('/').every((p) => p && p !== '.' && p !== '..');
  }
  function filePath(lang, info) {
    info = info.trim();
    if (lang && /^[./]/.test(info)) return lang + info.split(/\s/)[0];
    const found = info.match(/^:\s*(\S+)/) || info.match(/\b(?:path|file|filename|name|title)\s*=\s*["']?([^"'\s]+)/i) ||
      info.match(/^([\w.\-/]+\.\w{1,8})$/);
    return found ? found[1] : null;
  }
  function language(path, lang) {
    if (/^(?:html?|css|javascript|js|json|svg|xml|markdown|md|txt|text)$/i.test(lang)) return lang;
    return ({ html: 'html', htm: 'html', js: 'javascript', css: 'css', json: 'json', svg: 'svg', md: 'markdown' })[path.split('.').pop()] || 'text';
  }
  function serialize(files, pack) {
    return files.map((f) => '```' + (f.lang || 'text') + (pack ? ':' + f.path : '') + '\n' +
      f.code + (f.code.endsWith('\n') ? '' : '\n') + '```').join('\n\n');
  }
  function extract(text) {
    if (typeof text !== 'string' || text.length > MAX_SOURCE) return [];
    const singles = [], files = new Map();
    const pattern = /```([\w-]*)([^\n]*)\n([\s\S]*?)(```|$)/g;
    let match, pathsValid = true;
    while ((match = pattern.exec(text))) {
      const [, lang, info, code, end] = match, path = filePath(lang, info);
      if (path) {
        if (!safePath(path)) pathsValid = false;
        files.delete(path);
        files.set(path, { path, lang: language(path, lang), code, closed: !!end });
      } else if (/^html?$/i.test(lang) || (!lang && /^\s*<(?:!doctype|html|body)\b/i.test(code))) {
        const entry = { path: 'index.html', lang: 'html', code, closed: !!end };
        singles.push({ source: match[0], title: titleOf(code), pack: false,
          files: [entry], valid: !!end && fullHtml(code) });
      }
    }
    const list = [...files.values()];
    const entry = list.filter((f) => /\.html?$/i.test(f.path))
      .sort((a, b) => Number(/(?:^|\/)index\.html?$/i.test(b.path)) - Number(/(?:^|\/)index\.html?$/i.test(a.path)) || a.path.length - b.path.length)[0];
    if (entry) singles.push({ source: serialize(list, true), title: titleOf(entry.code), pack: true,
      files: list, valid: pathsValid && list.every((f) => f.closed) && fullHtml(entry.code) });
    return singles;
  }
  function latest(text) { return extract(text).filter((a) => a.valid).at(-1) || null; }
  function forChat(chat, excludeId) {
    const eligible = (m) => m && m.r === 'a' && m.id !== excludeId && !m.err && !m.live && !m.cancelled;
    const ref = chat.artifactRef;
    if (ref) {
      const message = chat.msgs.find((m) => m.id === ref.mid);
      const artifact = eligible(message) && (!message.validation || message.validation.status === 'passed' || ref.acceptedUnverified) && extract(message.t)[ref.k];
      if (artifact?.valid) return { ...artifact, mid: message.id, k: ref.k };
    }
    for (let i = chat.msgs.length - 1; i >= 0; i--) {
      const message = chat.msgs[i];
      if (!eligible(message) || (message.validation && message.validation.status !== 'passed')) continue;
      const artifacts = extract(message.t);
      for (let k = artifacts.length - 1; k >= 0; k--) {
        if (artifacts[k].valid) return { ...artifacts[k], mid: message.id, k };
      }
    }
    return null;
  }
  // Старый клиент: ищем код ДО обрезки истории. Новый: явная выбранная версия.
  function resolve(supplied, messages) {
    if (supplied != null) {
      if (typeof supplied !== 'object' || typeof supplied.source !== 'string' || supplied.source.length > MAX_SOURCE)
        throw new Error('Текущая версия должна содержать полный код не больше 2 МиБ символов');
      const artifact = latest(supplied.source);
      if (!artifact) throw new Error('В текущей версии нет полного HTML. Откройте завершённую версию игры.');
      return artifact;
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role !== 'assistant' || (messages[i].validation && messages[i].validation.status !== 'passed')) continue;
      const content = messages[i].content;
      const text = typeof content === 'string' ? content : Array.isArray(content)
        ? content.filter((p) => p?.type === 'text').map((p) => p.text).join('\n') : '';
      const artifact = latest(text);
      if (artifact) return artifact;
    }
    return null;
  }
  return { MAX_SOURCE, safePath, serialize, extract, latest, forChat, resolve };
});