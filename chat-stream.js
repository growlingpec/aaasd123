'use strict';

// SSE с корректным flush: последний JSON не теряется, даже если нет финального \n.
async function* events(response) {
  if (!response.body) throw new Error('API модели вернул пустой поток');
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = (line) => {
    line = line.trim();
    if (!line.startsWith('data:')) return null;
    const value = line.slice(5).trim();
    if (!value || value === '[DONE]') return null;
    let event;
    try { event = JSON.parse(value); } catch { throw new Error('API модели вернул некорректный JSON в потоке'); }
    if (event.error) throw new Error('API модели сообщил ошибку генерации');
    return event;
  };
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 4e6) throw new Error('Слишком большой фрагмент потока модели');
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) { const event = parse(line); if (event) yield event; }
  }
  buffer += decoder.decode();
  if (buffer.trim()) { const event = parse(buffer); if (event) yield event; }
}

function timeoutMs() {
  const value = Number(process.env.MODEL_REQUEST_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 1000 ? Math.min(1600000, Math.floor(value)) : 180000;
}
module.exports = { events, timeoutMs };