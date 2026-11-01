// Premier — клиент: start (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- запуск ---------- */
paintMe(); render(); loadModels(); loadBill(); renderPick();
pull(true);
setTimeout(startPendingResume, 600); // pick up an answer that was still generating when the tab closed
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(false); });

// Language switches reload UI assets, not the stored conversations. Preserve the composer.
if (window.PremierLanguage) {
  const draftKey = 'premier:language-draft:' + ME.id;
  try { const draft = sessionStorage.getItem(draftKey); if (draft !== null) { $('q').value = draft; sessionStorage.removeItem(draftKey); grow(); renderSend(); } } catch {}
  window.PremierLanguage.beforeSwitch = async () => {
    if (anyBusy()) { toast('Stop generation before switching languages'); return false; }
    if (PEND.length) { toast('Send or remove attachments before switching languages'); return false; }
    try { sessionStorage.setItem(draftKey, $('q').value); } catch { if ($('q').value) { toast('Could not save the draft — copy it before switching languages'); return false; } }
    persistLocal(); await push(); return true;
  };
}
