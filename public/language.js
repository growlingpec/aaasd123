'use strict';
(() => {
  const current = document.documentElement.lang === 'en' ? 'en' : 'ru';
  const api = window.PremierLanguage = { current, beforeSwitch: null };
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = 'premier_lang=' + current + '; Path=/; Max-Age=31536000; SameSite=Lax' + secure;
  try { localStorage.setItem('premier:language', current); } catch {}
  let switching = false;
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-language]').forEach(link => {
      const lang = link.dataset.language;
      link.setAttribute('aria-current', lang === current ? 'true' : 'false');
      link.lang = lang; link.hreflang = lang;
      const url = new URL(location.href); url.searchParams.set('lang', lang); link.href = url.pathname + url.search + url.hash;
      link.addEventListener('click', async e => {
        e.preventDefault(); if (lang === current || switching) return;
        // Never navigate away while a secret or unsaved form is open.
        if (document.querySelector('dialog[open],#modal.on')) {
          const message = current === 'en' ? 'Close the dialog before switching languages. Save any key or edits first.' : 'Перед сменой языка закройте окно. Сначала сохраните ключ или изменения.';
          if (typeof window.toast === 'function') window.toast(message); else alert(message);
          return;
        }
        switching = true;
        try {
          if (api.beforeSwitch && await api.beforeSwitch() === false) return;
          document.cookie = 'premier_lang=' + lang + '; Path=/; Max-Age=31536000; SameSite=Lax' + secure;
          try { localStorage.setItem('premier:language', lang); } catch {}
          location.assign(link.href);
        } finally { switching = false; }
      });
    });
  });
})();
