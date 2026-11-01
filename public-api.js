'use strict';
// OpenAI-compatible inference API. Never exposes provider keys or accepts provider URLs.
const crypto = require('node:crypto');
const { publicId, findModel } = require('./model-ids');
const { events, timeoutMs } = require('./chat-stream');
const fail = (res, status, message, code, param = null) => {
  const data = { error: { message, type: status === 401 ? 'authentication_error' : status >= 500 ? 'server_error' : 'invalid_request_error', param, code } };
  if (res.headersSent) { if (!res.destroyed) res.end('data: ' + JSON.stringify(data) + '\n\ndata: [DONE]\n\n'); }
  else { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
};
const bad = (message, param) => { throw Object.assign(new Error(message), { status: 400, param }); };
const usageOf = u => ({ input_tokens: u?.prompt_tokens ?? 0, output_tokens: u?.completion_tokens ?? 0, total_tokens: u?.total_tokens ?? 0 });
function validate(b, model, cap) {
  if (!b || Array.isArray(b) || typeof b !== 'object') bad('Expected a JSON object.');
  const allowed = new Set(['model', 'messages', 'stream', 'stream_options', 'temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'stop', 'frequency_penalty', 'presence_penalty', 'seed', 'n', 'tools', 'tool_choice', 'parallel_tool_calls', 'response_format', 'user']);
  for (const k of Object.keys(b)) if (!allowed.has(k)) bad('Unsupported parameter: ' + k, k);
  if (!Array.isArray(b.messages) || !b.messages.length || b.messages.length > 500) bad('messages must contain 1–500 messages.', 'messages');
  const messages = b.messages.map((m) => {
    if (!m || !['system', 'developer', 'user', 'assistant', 'tool'].includes(m.role)) bad('Invalid message role.', 'messages');
    if (typeof m.content !== 'string' && !Array.isArray(m.content) && !(m.role === 'assistant' && m.content == null && Array.isArray(m.tool_calls) && m.tool_calls.length)) bad('Invalid message content.', 'messages');
    if (Array.isArray(m.content)) for (const part of m.content) {
      if (!part || !['text', 'image_url'].includes(part.type)) bad('Only text and image_url content parts are supported.', 'messages');
      if (part.type === 'text' && typeof part.text !== 'string') bad('Invalid text content.', 'messages');
      if (part.type === 'image_url' && (!model.vision || typeof part.image_url?.url !== 'string' || !/^(https?:\/\/|data:image\/)/.test(part.image_url.url))) bad('This model does not support this image input.', 'messages');
    }
    if (m.role === 'tool' && typeof m.tool_call_id !== 'string') bad('tool messages require tool_call_id.', 'messages');
    const x = { role: m.role, content: m.content ?? null };
    for (const k of ['name', 'tool_call_id', 'tool_calls']) if (m[k] !== undefined) x[k] = m[k];
    return x;
  });
  if (b.stream !== undefined && typeof b.stream !== 'boolean') bad('stream must be a boolean.', 'stream');
  if (b.n !== undefined && b.n !== 1) bad('Only n=1 is supported.', 'n');
  for (const [k, min, max] of [['temperature', 0, 2], ['top_p', 0, 1], ['frequency_penalty', -2, 2], ['presence_penalty', -2, 2]])
    if (b[k] !== undefined && (typeof b[k] !== 'number' || !Number.isFinite(b[k]) || b[k] < min || b[k] > max)) bad('Invalid ' + k + '.', k);
  if (b.max_tokens !== undefined && b.max_completion_tokens !== undefined) bad('Use only one token limit.');
  const tk = b.max_completion_tokens !== undefined ? 'max_completion_tokens' : 'max_tokens';
  if (b[tk] !== undefined && (!Number.isInteger(b[tk]) || b[tk] <= 0)) bad('Token limit must be a positive integer.', tk);
  if (b.stop !== undefined && !(typeof b.stop === 'string' || (Array.isArray(b.stop) && b.stop.length <= 4 && b.stop.every(s => typeof s === 'string')))) bad('Invalid stop.', 'stop');
  if (b.seed !== undefined && !Number.isSafeInteger(b.seed)) bad('seed must be an integer.', 'seed');
  if (b.tools !== undefined && (!Array.isArray(b.tools) || b.tools.length > 128 || b.tools.some(t => t?.type !== 'function' || typeof t.function?.name !== 'string'))) bad('Invalid tools.', 'tools');
  if (b.parallel_tool_calls !== undefined && typeof b.parallel_tool_calls !== 'boolean') bad('Invalid parallel_tool_calls.', 'parallel_tool_calls');
  if (b.response_format !== undefined && (!b.response_format || !['text', 'json_object', 'json_schema'].includes(b.response_format.type))) bad('Invalid response_format.', 'response_format');
  if (b.stream_options !== undefined && (!b.stream || !b.stream_options || typeof b.stream_options.include_usage !== 'boolean' || Object.keys(b.stream_options).some(k => k !== 'include_usage'))) bad('Only stream_options.include_usage is supported.', 'stream_options');
  const body = { model: model.modelId, messages, stream: b.stream === true };
  for (const k of allowed) if (!['model', 'messages', 'max_tokens', 'max_completion_tokens', 'n'].includes(k) && b[k] !== undefined) body[k] = b[k];
  const tokens = cap == null ? b[tk] : Math.min(b[tk] || cap, cap);
  if (tokens != null) body[tk] = tokens;
  // API has no site tools or memory. Apply only the admin's model-specific prompt.
  if (model.prompt?.trim()) body.messages.unshift({ role: 'system', content: model.prompt.trim() });
  return body;
}
// OpenAI Responses API (Codex CLI & co). Normalizes the richer input model to chat
// messages and answers with a `response` object or the Responses SSE event sequence.
// Unknown extra parameters (reasoning, store, metadata, text, include, …) are ignored.
function responsesToMessages(b, model) {
  const system = [], msgs = [];
  const addSystem = t => { if (typeof t === 'string' && t.trim()) system.push(t.trim()); };
  addSystem(b.instructions);
  if (Array.isArray(b.instructions)) for (const p of b.instructions) addSystem(typeof p === 'string' ? p : p?.text);
  if (typeof b.input === 'string') { if (b.input.trim()) msgs.push({ role: 'user', content: b.input }); }
  else if (Array.isArray(b.input)) {
    if (b.input.length > 500) bad('input must contain at most 500 items.', 'input');
    for (const it of b.input) {
      if (!it || typeof it !== 'object') continue;
      const type = it.type === undefined ? 'message' : it.type;
      if (type === 'function_call') {
        if (typeof it.call_id !== 'string' || !it.call_id || typeof it.name !== 'string' || !it.name) bad('Invalid function_call item.', 'input');
        msgs.push({ role: 'assistant', content: null, tool_calls: [{ id: it.call_id, type: 'function', function: { name: it.name, arguments: typeof it.arguments === 'string' ? it.arguments : JSON.stringify(it.arguments ?? {}) } }] });
      } else if (type === 'function_call_output') {
        if (typeof it.call_id !== 'string' || !it.call_id) bad('Invalid function_call_output item.', 'input');
        msgs.push({ role: 'tool', tool_call_id: it.call_id, content: typeof it.output === 'string' ? it.output : JSON.stringify(it.output ?? '') });
      } else if (type === 'message' || type === undefined) {
        const role = it.role === 'assistant' ? 'assistant' : it.role === 'system' || it.role === 'developer' ? 'system' : 'user';
        let content = '';
        if (typeof it.content === 'string') content = it.content;
        else if (Array.isArray(it.content)) {
          const parts = [];
          for (const p of it.content) {
            if (typeof p === 'string') { if (p) parts.push({ type: 'text', text: p }); continue; }
            if (!p || typeof p !== 'object') continue;
            if (p.type === 'input_text' || p.type === 'output_text' || p.type === 'text') { if (typeof p.text === 'string' && p.text) parts.push({ type: 'text', text: p.text }); }
            else if (p.type === 'input_image' && model.vision && typeof p.image_url?.url === 'string' && /^(https?:\/\/|data:image\/)/.test(p.image_url.url)) parts.push({ type: 'image_url', image_url: p.image_url });
          }
          content = parts.length ? parts : '';
        }
        if (role === 'system') { addSystem(Array.isArray(content) ? content.map(x => x.text).join('\n') : content); continue; }
        if (content === '' || (Array.isArray(content) && !content.length)) continue;
        msgs.push({ role, content });
      }
    }
  }
  if (system.length) msgs.unshift({ role: 'system', content: system.join('\n\n') });
  if (model.prompt?.trim()) msgs.unshift({ role: 'system', content: model.prompt.trim() });
  if (!msgs.length) bad('input must contain at least one message.', 'input');
  return msgs;
}
function validateResponses(b, model, cap) {
  if (b.previous_response_id !== undefined) bad('previous_response_id is not supported.', 'previous_response_id');
  if (b.stream !== undefined && typeof b.stream !== 'boolean') bad('stream must be a boolean.', 'stream');
  if (b.temperature !== undefined && (typeof b.temperature !== 'number' || !Number.isFinite(b.temperature) || b.temperature < 0 || b.temperature > 2)) bad('Invalid temperature.', 'temperature');
  if (b.top_p !== undefined && (typeof b.top_p !== 'number' || !Number.isFinite(b.top_p) || b.top_p < 0 || b.top_p > 1)) bad('Invalid top_p.', 'top_p');
  if (b.max_output_tokens !== undefined && (!Number.isInteger(b.max_output_tokens) || b.max_output_tokens <= 0)) bad('max_output_tokens must be a positive integer.', 'max_output_tokens');
  if (b.parallel_tool_calls !== undefined && typeof b.parallel_tool_calls !== 'boolean') bad('Invalid parallel_tool_calls.', 'parallel_tool_calls');
  const body = { model: model.modelId, messages: responsesToMessages(b, model), stream: b.stream === true };
  for (const k of ['temperature', 'top_p', 'parallel_tool_calls']) if (b[k] !== undefined) body[k] = b[k];
  if (b.max_output_tokens !== undefined) body.max_tokens = cap == null ? b.max_output_tokens : Math.min(b.max_output_tokens, cap);
  if (b.tools !== undefined) {
    if (!Array.isArray(b.tools) || b.tools.length > 128) bad('Invalid tools.', 'tools');
    const tools = b.tools.filter(t => t && t.type === 'function' && (typeof t.name === 'string' || typeof t.function?.name === 'string'))
      .map(t => ({ type: 'function', function: { name: t.name || t.function.name, ...(t.description !== undefined ? { description: t.description } : {}), parameters: t.parameters ?? t.function?.parameters ?? { type: 'object', properties: {} } } }));
    if (tools.length) body.tools = tools;
  }
  const tc = b.tool_choice;
  if (typeof tc === 'string' && ['auto', 'none', 'required'].includes(tc)) body.tool_choice = tc;
  else if (tc && tc.type === 'function' && typeof tc.name === 'string') body.tool_choice = { type: 'function', function: { name: tc.name } };
  return body;
}
// Anthropic Messages API (Claude-совместимые клиенты: Claude Desktop, «Anthropic»-провайдеры в чат-клиентах).
// Переводит запрос/ответ, включая стрим: message_start → content_block_start/delta/stop → message_delta → message_stop.
// Неизвестные параметры (metadata, thinking, top_k, service_tier…) игнорируются.
function anthropicToMessages(b, model) {
  const systemParts = [];
  const sys = b.system;
  if (typeof sys === 'string' && sys.trim()) systemParts.push(sys.trim());
  else if (Array.isArray(sys)) for (const p of sys) { const t = typeof p === 'string' ? p : p?.type === 'text' ? p.text : ''; if (t && t.trim()) systemParts.push(t.trim()); }
  if (model.prompt?.trim()) systemParts.unshift(model.prompt.trim());
  if (!Array.isArray(b.messages) || !b.messages.length) bad('messages must contain at least one message.', 'messages');
  if (b.messages.length > 500) bad('messages must contain at most 500 messages.', 'messages');
  const msgs = [];
  if (systemParts.length) msgs.push({ role: 'system', content: systemParts.join('\n\n') });
  const extraSys = [];
  for (const m of b.messages) {
    if (!m || typeof m !== 'object') bad('Invalid message.', 'messages');
    // некоторые клиенты (Claude Desktop local-agent и др.) кладут system-промпт в messages и шлют role:'tool' — принимаем
    if (m.role === 'system' || m.role === 'developer') {
      const t = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.filter(x => x?.type === 'text' && typeof x.text === 'string').map(x => x.text).join('\n') : '';
      if (t.trim()) extraSys.push(t.trim());
      continue;
    }
    if (m.role === 'tool') {
      if (typeof m.tool_call_id !== 'string' || !m.tool_call_id) bad('Invalid tool message (tool_call_id required).', 'messages');
      msgs.push({ role: 'tool', tool_call_id: m.tool_call_id, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '') });
      continue;
    }
    if (m.role !== 'user' && m.role !== 'assistant') bad('Invalid message role (user/assistant expected).', 'messages');
    if (typeof m.content === 'string') { if (m.content.trim()) msgs.push({ role: m.role, content: m.content }); continue; }
    if (!Array.isArray(m.content)) bad('Invalid message content.', 'messages');
    const texts = [], imgs = [], tools = [], toolMsgs = [];
    for (const p of m.content) {
      if (!p || typeof p !== 'object') continue;
      if (p.type === 'text') { if (typeof p.text === 'string' && p.text) texts.push(p.text); }
      else if (p.type === 'image') {
        if (!model.vision) bad('This model does not support this image input.', 'messages');
        const src = p.source || {};
        const url = src.type === 'base64' && src.data ? 'data:' + (src.media_type || 'image/png') + ';base64,' + src.data : (src.type === 'url' && typeof src.url === 'string') ? src.url : null;
        if (!/^(https?:\/\/|data:image\/)/.test(String(url))) bad('Invalid image source.', 'messages');
        imgs.push(url);
      }
      else if (p.type === 'tool_use' && m.role === 'assistant') { if (typeof p.name !== 'string' || !p.id) bad('Invalid tool_use block.', 'messages'); tools.push({ id: p.id, type: 'function', function: { name: p.name, arguments: JSON.stringify(p.input ?? {}) } }); }
      else if (p.type === 'tool_result' && m.role === 'user') {
        if (typeof p.tool_use_id !== 'string' || !p.tool_use_id) bad('Invalid tool_result block.', 'messages');
        const c = typeof p.content === 'string' ? p.content : Array.isArray(p.content) ? p.content.filter(x => x?.type === 'text' && typeof x.text === 'string').map(x => x.text).join('\n') : '';
        toolMsgs.push({ role: 'tool', tool_call_id: p.tool_use_id, content: c });
      }
      else bad('Unsupported content block: ' + p.type, 'messages');
    }
    if (m.role === 'assistant' && tools.length) msgs.push({ role: 'assistant', content: texts.join('\n') || null, tool_calls: tools });
    else if (texts.length || imgs.length) msgs.push({ role: 'user', content: imgs.length ? [...texts.map(t => ({ type: 'text', text: t })), ...imgs.map(u => ({ type: 'image_url', image_url: { url: u } }))] : texts.join('\n') });
    for (const tm of toolMsgs) msgs.push(tm);
  }
  if (extraSys.length) { if (msgs.length && msgs[0]?.role === 'system') msgs[0].content += '\n\n' + extraSys.join('\n\n'); else msgs.unshift({ role: 'system', content: extraSys.join('\n\n') }); }
  if (msgs.length <= (systemParts.length || extraSys.length ? 1 : 0)) bad('messages must contain at least one message.', 'messages');
  return msgs;
}
function validateAnthropic(b, model, cap) {
  if (b.stream !== undefined && typeof b.stream !== 'boolean') bad('stream must be a boolean.', 'stream');
  if (b.temperature !== undefined && (typeof b.temperature !== 'number' || !Number.isFinite(b.temperature) || b.temperature < 0 || b.temperature > 1)) bad('Invalid temperature.', 'temperature');
  if (b.top_p !== undefined && (typeof b.top_p !== 'number' || !Number.isFinite(b.top_p) || b.top_p < 0 || b.top_p > 1)) bad('Invalid top_p.', 'top_p');
  if (b.stop_sequences !== undefined && !(typeof b.stop_sequences === 'string' || (Array.isArray(b.stop_sequences) && b.stop_sequences.length <= 4 && b.stop_sequences.every(x => typeof x === 'string')))) bad('Invalid stop_sequences.', 'stop_sequences');
  const mt = b.max_tokens !== undefined ? b.max_tokens : (cap ?? 16000);
  if (!Number.isInteger(mt) || mt <= 0) bad('max_tokens must be a positive integer.', 'max_tokens');
  const body = { model: model.modelId, messages: anthropicToMessages(b, model), stream: b.stream === true, max_tokens: cap == null ? mt : Math.min(mt, cap) };
  if (b.temperature !== undefined) body.temperature = b.temperature;
  if (b.top_p !== undefined) body.top_p = b.top_p;
  if (b.stop_sequences !== undefined) body.stop = b.stop_sequences;
  if (b.tools !== undefined) {
    // Claude Desktop local-agent шлёт ВСЮ MCP-поднягу (сотни тулов, мегабайты body) — принимаем, для провайдера берём первые 64
    let toolsArr = b.tools;
    if (typeof toolsArr === 'string') { try { toolsArr = JSON.parse(toolsArr); } catch { toolsArr = null; } }
    if (!Array.isArray(toolsArr)) bad('Invalid tools.', 'tools');
    const tools = toolsArr.filter(t => t && (typeof t.name === 'string' || typeof t?.function?.name === 'string'))
      .slice(0, 64)
      .map(t => ({ type: 'function', function: { name: t.name || t.function.name, ...(t.description !== undefined ? { description: t.description } : {}), parameters: t.input_schema ?? t.parameters ?? { type: 'object', properties: {} } } }));
    if (tools.length) body.tools = tools;
  }
  const tc = b.tool_choice;
  if (tc && typeof tc === 'object') {
    if (tc.type === 'auto') body.tool_choice = 'auto';
    else if (tc.type === 'any') body.tool_choice = 'required';
    else if (tc.type === 'none') body.tool_choice = 'none';
    else if (tc.type === 'tool' && typeof tc.name === 'string') body.tool_choice = { type: 'function', function: { name: tc.name } };
  }
  return body;
}
const ANTHROPIC_STOP = { stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use', content_filter: 'end_turn' };
function createPublicApi({ keys, bill, loadModels, readBody, endpoint, clientIp }) {
  const active = new Map(), failures = new Map();
  const cleanup = setInterval(() => { const now = Date.now(); for (const [ip, x] of failures) if (x.until <= now) failures.delete(ip); }, 60000); cleanup.unref();
  return async function handle(req, res, url) {
    res.setHeader('Cache-Control', 'no-store');
    const ip = clientIp(req), attempts = failures.get(ip);
    if (attempts?.until > Date.now() && attempts.n >= 30) { res.setHeader('Retry-After', '60'); return fail(res, 429, 'Too many authentication attempts.', 'rate_limit_exceeded'); }
    // Anthropic-совместимые клиенты шлют ключ в x-api-key, остальные — Authorization: Bearer
    const authHeader = req.headers.authorization || (typeof req.headers['x-api-key'] === 'string' && String(req.headers['x-api-key']).trim() ? 'Bearer ' + String(req.headers['x-api-key']).trim() : null);
    const auth = keys.authenticate(authHeader);
    if (!auth) {
      if (!attempts || attempts.until <= Date.now()) { if (failures.size >= 10000) failures.delete(failures.keys().next().value); failures.set(ip, { n: 1, until: Date.now() + 60000 }); } else attempts.n++;
      return fail(res, 401, 'Invalid, expired or revoked API key.', 'invalid_api_key');
    }
    const { user } = auth, p = url.pathname, km = auth.keyModels;
    const modelAllowed = m => !km || km.includes(m.id) || km.includes(publicId(m));
    const models = loadModels().filter(m => bill.modelPlans(m).includes(bill.planOf(user).id)).filter(modelAllowed);
    const object = m => ({ id: publicId(m), object: 'model', created: 0, owned_by: 'premier', name: m.name, vision: !!m.vision, weight: Math.max(0.1, Number(m.weight) || 1) });
    if (p === '/v1/models' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ object: 'list', data: models.map(object) })); }
    if (p.startsWith('/v1/models/') && req.method === 'GET') {
      const m = findModel(models, p.slice(11));
      if (!m) return fail(res, 404, 'Model not found or not available on your plan.', 'model_not_found', 'model');
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(object(m)));
    }
    if (p === '/v1/messages/count_tokens' && req.method === 'POST') {
      // Claude Desktop / claude-cli звонят сюда для оценки окна контекста; точный подсчёт не нужен — оценка
      let b = {};
      try { b = await readBody(req, 16e6); } catch (e) { return fail(res, e.status || 400, e.message === 'bad json' ? 'Invalid JSON.' : e.message, 'invalid_request'); }
      let n = 40; const count = (t) => { n += Math.ceil(String(t ?? '').length / 4); };
      const sys = b.system;
      if (typeof sys === 'string') count(sys); else if (Array.isArray(sys)) for (const x of sys) count(typeof x === 'string' ? x : x?.text);
      if (Array.isArray(b.messages)) for (const m of b.messages) {
        n += 8; const c = m?.content;
        if (typeof c === 'string') count(c);
        else if (Array.isArray(c)) for (const x of c) { if (x?.type === 'text') count(x.text); else if (x?.type === 'image') n += 1000; else if (x?.type === 'tool_use') count(JSON.stringify(x.input ?? {})); else if (x?.type === 'tool_result') count(typeof x.content === 'string' ? x.content : JSON.stringify(x.content ?? '')); }
      }
      if (Array.isArray(b.tools)) for (const t of b.tools) n += 20 + Math.ceil(JSON.stringify(t?.input_schema ?? t?.parameters ?? {}).length / 4);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ input_tokens: Math.max(1, n) }));
    }
    const isResp = p === '/v1/responses', isMsg = p === '/v1/messages';
    if (!isResp && !isMsg && p !== '/v1/chat/completions') return fail(res, 404, 'Endpoint not found.', 'not_found');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail(res, 405, 'Use POST.', 'method_not_allowed'); }
    let b, model, body;
    try {
      b = await readBody(req, 16e6); // Claude Desktop local-agent: мегабайты MCP-тулов + история
      if (typeof b?.model !== 'string' || !b.model) bad('model is required.', 'model');
      model = findModel(loadModels(), b.model);
      if (!model) return fail(res, 404, 'Model not found.', 'model_not_found', 'model');
      if (km && !modelAllowed(model)) return fail(res, 403, 'Model not allowed for this API key.', 'model_not_allowed', 'model');
      body = isResp ? validateResponses(b, model, bill.maxTokens(user)) : isMsg ? validateAnthropic(b, model, bill.maxTokens(user)) : validate(b, model, bill.maxTokens(user));
    } catch (e) { return fail(res, e.status || 400, e.message === 'bad json' ? 'Invalid JSON.' : e.message, 'invalid_request', e.param); }
    if ((active.get(user.id) || 0) >= 2) { res.setHeader('Retry-After', '5'); return fail(res, 429, 'Maximum 2 concurrent requests per account.', 'rate_limit_exceeded'); }
    const charge = bill.charge(user, model);
    if (charge.error) { if (charge.code !== 'model') res.setHeader('Retry-After', charge.code === 'burst' ? '300' : String(Math.ceil((Date.parse(bill.today() + 'T21:00:00Z') - Date.now()) / 1000))); return fail(res, charge.code === 'model' ? 403 : 429, charge.error, charge.code === 'model' ? 'model_not_allowed' : 'insufficient_quota'); }
    bill.flush(); // API reservations persist immediately, including concurrent callers.
    const chargedDay = bill.today();
    active.set(user.id, (active.get(user.id) || 0) + 1);
    const ac = new AbortController(), onClose = () => { if (!res.writableEnded) ac.abort(); };
    res.on('close', onClose);
    const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(timeoutMs())]);
    const id = 'chatcmpl-' + crypto.randomBytes(16).toString('hex'), rid = 'resp_' + crypto.randomBytes(16).toString('hex'), amsgId = 'msg_' + crypto.randomBytes(14).toString('hex'), created = Math.floor(Date.now() / 1000);
    let delivered = false, stopKeepAlive = null;
    const output = j => ({ id, object: body.stream ? 'chat.completion.chunk' : 'chat.completion', created, model: publicId(model),
      choices: j.choices.map((c, i) => ({ index: c.index ?? i, [body.stream ? 'delta' : 'message']: c[body.stream ? 'delta' : 'message'] || {}, finish_reason: c.finish_reason ?? null, ...(c.logprobs ? { logprobs: c.logprobs } : {}) })), ...(j.usage ? { usage: j.usage } : {}) });
    const meaningful = c => !!(c?.content || c?.reasoning_content || c?.reasoning || c?.refusal || c?.tool_calls?.length);
    const write = async text => {
      if (res.destroyed) throw new Error('disconnected');
      if (!res.write(text)) await new Promise((resolve, reject) => {
        const done = () => { clean(); resolve(); }, close = () => { clean(); reject(new Error('disconnected')); }, clean = () => { res.off('drain', done); res.off('close', close); };
        res.once('drain', done); res.once('close', close);
      });
    };
    try {
      // Cloudflare рвёт соединение (524) при 120с тишины: для стрим-запросов сразу
      // открываем ответ и держим его SSE-пингами, пока модель молчит до первого токена.
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
        const ping = () => { if (!res.destroyed && !res.writableEnded) { try { res.write(': ping\n\n'); } catch {} } };
        ping(); // первый пинг сразу: writeHead сам ничего не шлёт — пинг выталкивает заголовки в сеть
        const keepAlive = setInterval(ping, 15000);
        keepAlive.unref();
        stopKeepAlive = () => clearInterval(keepAlive);
      }
      let r = await fetch(endpoint(model.baseUrl), { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + model.apiKey }, body: JSON.stringify(body) });
      // нестабильный провайдер (5xx): одна повторная попытка после паузы — Claude Desktop и другие API-клиенты
      if (r.status >= 500 && r.status !== 501 && !signal.aborted) {
        try { if (r.body) await r.body.cancel(); } catch {}
        await new Promise((w) => setTimeout(w, 5000));
        if (!signal.aborted) { try { const r2 = await fetch(endpoint(model.baseUrl), { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + model.apiKey }, body: JSON.stringify(body) }); if (r2.ok || r2.status < 500) r = r2; else { try { if (r2.body) await r2.body.cancel(); } catch {} } } catch {} }
      }
      if (!r.ok) { try { if (r.body) await r.body.cancel(); } catch {} throw new Error('upstream'); }
      if (!body.stream) {
        const j = await r.json();
        if (isResp) {
          if (j.error || !Array.isArray(j.choices) || !j.choices.length) throw new Error('upstream');
          const m = j.choices[0].message || {};
          const ro = [];
          if (typeof m.content === 'string' && m.content) ro.push({ type: 'message', id: 'msg_' + crypto.randomBytes(10).toString('hex'), status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: m.content, annotations: [] }] });
          for (const t of m.tool_calls || []) {
            if (!t || t.type !== 'function' || !t.function?.name) continue;
            ro.push({ type: 'function_call', id: 'fc_' + crypto.randomBytes(10).toString('hex'), call_id: t.id || 'call_' + crypto.randomBytes(8).toString('hex'), name: t.function.name, arguments: typeof t.function.arguments === 'string' ? t.function.arguments : JSON.stringify(t.function.arguments ?? {}), status: 'completed' });
          }
          if (!ro.length) throw new Error('upstream');
          if (res.destroyed) throw new Error('disconnected');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ id: rid, object: 'response', created_at: created, status: 'completed', model: publicId(model), instructions: b.instructions ?? null, output: ro, error: null, incomplete_details: null, usage: usageOf(j.usage) }));
          delivered = true;
        } else if (isMsg) {
          if (j.error || !Array.isArray(j.choices) || !j.choices.length) throw new Error('upstream');
          const m = j.choices[0].message || {};
          const content = [];
          if (typeof m.content === 'string' && m.content) content.push({ type: 'text', text: m.content });
          for (const t of m.tool_calls || []) {
            if (!t || t.type !== 'function' || !t.function?.name) continue;
            let input = {}; try { input = JSON.parse(t.function.arguments || '{}'); } catch {}
            content.push({ type: 'tool_use', id: t.id || 'toolu_' + crypto.randomBytes(10).toString('hex'), name: t.function.name, input });
          }
          if (!content.length) throw new Error('upstream');
          if (res.destroyed) throw new Error('disconnected');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ id: amsgId, type: 'message', role: 'assistant', model: publicId(model), content, stop_reason: ANTHROPIC_STOP[j.choices[0].finish_reason] || 'end_turn', stop_sequence: null, usage: usageOf(j.usage) }));
          delivered = true;
        } else {
          if (j.error || !Array.isArray(j.choices) || !j.choices.length || !j.choices.some(c => meaningful(c.message))) throw new Error('upstream');
          if (res.destroyed) throw new Error('disconnected');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(output(j))); delivered = true;
        }
      } else if (isResp) {
        // Responses SSE: created → in_progress → item/part/argument deltas → completed (no [DONE]).
        let started = false, finished = false, finishReason = null, lastUsage = null;
        const ro = [];
        let msgId = null, msgText = '', msgIdx = -1;
        const tcs = [];
        const ev = (name, data) => write('event: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n');
        const streamObj = status => ({ id: rid, object: 'response', created_at: created, status, model: publicId(model), instructions: b.instructions ?? null, output: [], error: null, incomplete_details: null });
        const finalize = async () => {
          if (msgIdx >= 0) {
            ro[msgIdx] = { type: 'message', id: msgId, status: 'completed', role: 'assistant', content: msgText ? [{ type: 'output_text', text: msgText, annotations: [] }] : [] };
            await ev('response.output_text.done', { type: 'response.output_text.done', item_id: msgId, output_index: msgIdx, content_index: 0, text: msgText });
            await ev('response.content_part.done', { type: 'response.content_part.done', item_id: msgId, output_index: msgIdx, content_index: 0, part: { type: 'output_text', text: msgText, annotations: [] } });
            await ev('response.output_item.done', { type: 'response.output_item.done', output_index: msgIdx, item: ro[msgIdx] });
          }
          for (const x of tcs) {
            if (x.idx < 0) continue;
            ro[x.idx] = { type: 'function_call', id: x.itemId, call_id: x.id || 'call_' + crypto.randomBytes(8).toString('hex'), name: x.name, arguments: x.args, status: 'completed' };
            await ev('response.output_item.done', { type: 'response.output_item.done', output_index: x.idx, item: ro[x.idx] });
          }
        };
        for await (const j of events(r)) {
          if (!Array.isArray(j.choices)) throw new Error('upstream');
          if (j.usage) lastUsage = j.usage;
          if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
          if (!started) { started = true; await ev('response.created', { type: 'response.created', response: streamObj('in_progress') }); await ev('response.in_progress', { type: 'response.in_progress', response: streamObj('in_progress') }); }
          for (const c of j.choices) {
            const d = c.delta || {};
            const chunk = [d.content, d.refusal].filter(x => typeof x === 'string' && x).join('');
            if (chunk) {
              if (msgIdx < 0) {
                msgIdx = ro.length; msgId = 'msg_' + crypto.randomBytes(10).toString('hex'); ro.push(null);
                await ev('response.output_item.added', { type: 'response.output_item.added', output_index: msgIdx, item: { type: 'message', id: msgId, status: 'in_progress', role: 'assistant', content: [] } });
                await ev('response.content_part.added', { type: 'response.content_part.added', item_id: msgId, output_index: msgIdx, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
              }
              msgText += chunk; delivered = true;
              await ev('response.output_text.delta', { type: 'response.output_text.delta', item_id: msgId, output_index: msgIdx, content_index: 0, delta: chunk });
            }
            for (const t of d.tool_calls || []) {
              if (!t) continue;
              let x = tcs.find(y => y.key === (t.index ?? 0));
              if (!x) { x = { key: t.index ?? 0, id: null, name: '', args: '', itemId: 'fc_' + crypto.randomBytes(10).toString('hex'), idx: -1 }; tcs.push(x); }
              if (t.id) x.id = t.id;
              if (typeof t.function?.name === 'string') x.name += t.function.name;
              const argChunk = typeof t.function?.arguments === 'string' ? t.function.arguments : '';
              if (x.idx < 0 && (x.name || x.id || argChunk)) {
                x.idx = ro.length; ro.push(null);
                await ev('response.output_item.added', { type: 'response.output_item.added', output_index: x.idx, item: { type: 'function_call', id: x.itemId, call_id: x.id || '', name: x.name, arguments: '', status: 'in_progress' } });
              }
              if (argChunk && x.idx >= 0) { x.args += argChunk; delivered = true; await ev('response.function_call_arguments.delta', { type: 'response.function_call_arguments.delta', item_id: x.itemId, output_index: x.idx, delta: argChunk }); }
            }
            if (c.finish_reason != null && finishReason == null) { finishReason = c.finish_reason; await finalize(); }
          }
          if (finishReason != null) finished = true;
        }
        if (!finished || !delivered) throw new Error('upstream');
        await ev('response.completed', { type: 'response.completed', response: { ...streamObj('completed'), output: ro, usage: usageOf(lastUsage) } });
        res.end();
      } else if (isMsg) {
        // Anthropic SSE: message_start → content_block_start/delta/stop (текст, затем tool_use) → message_delta → message_stop
        let msgStarted = false, textOpen = false, textIdx = -1, nextIdx = 0, finishReason = null, lastUsage = null;
        const tcs = [];
        const ev = (name, data) => write('event: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n');
        const startMsg = async () => { if (msgStarted) return; msgStarted = true; await ev('message_start', { type: 'message_start', message: { id: amsgId, type: 'message', role: 'assistant', model: publicId(model), content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } }); };
        const openText = async () => { if (textOpen) return; textOpen = true; textIdx = nextIdx++; await ev('content_block_start', { type: 'content_block_start', index: textIdx, content_block: { type: 'text', text: '' } }); };
        const closeText = async () => { if (!textOpen) return; textOpen = false; await ev('content_block_stop', { type: 'content_block_stop', index: textIdx }); };
        for await (const j of events(r)) {
          if (!Array.isArray(j.choices)) throw new Error('upstream');
          if (j.usage) lastUsage = j.usage;
          if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
          await startMsg();
          for (const c of j.choices) {
            const d = c.delta || {};
            const chunk = [d.content, d.refusal].filter(x => typeof x === 'string' && x).join('');
            if (chunk) { delivered = true; await openText(); await ev('content_block_delta', { type: 'content_block_delta', index: textIdx, delta: { type: 'text_delta', text: chunk } }); }
            for (const t of d.tool_calls || []) {
              if (!t) continue;
              let x = tcs.find(y => y.key === (t.index ?? 0));
              if (!x) { x = { key: t.index ?? 0, id: null, name: '', args: '', open: false, idx: -1 }; tcs.push(x); }
              if (t.id && !x.id) x.id = t.id;
              if (typeof t.function?.name === 'string') x.name += t.function.name;
              if (!x.open && (x.id || x.name)) {
                x.open = true; x.idx = nextIdx++;
                if (textOpen) await closeText();
                await ev('content_block_start', { type: 'content_block_start', index: x.idx, content_block: { type: 'tool_use', id: x.id || 'toolu_' + crypto.randomBytes(10).toString('hex'), name: x.name || 'tool', input: {} } });
              }
              const argChunk = typeof t.function?.arguments === 'string' ? t.function.arguments : '';
              if (argChunk && x.open) { x.args += argChunk; delivered = true; await ev('content_block_delta', { type: 'content_block_delta', index: x.idx, delta: { type: 'input_json_delta', partial_json: argChunk } }); }
            }
            if (c.finish_reason != null && finishReason == null) {
              finishReason = c.finish_reason;
              if (textOpen) await closeText();
              for (const x of tcs) if (x.open) { x.open = false; await ev('content_block_stop', { type: 'content_block_stop', index: x.idx }); }
            }
          }
        }
        if (!delivered || finishReason == null) throw new Error('upstream');
        await ev('message_delta', { type: 'message_delta', delta: { stop_reason: ANTHROPIC_STOP[finishReason] || 'end_turn', stop_sequence: null }, usage: { input_tokens: lastUsage?.prompt_tokens ?? 0, output_tokens: lastUsage?.completion_tokens ?? 0 } });
        await ev('message_stop', { type: 'message_stop' });
        res.end();
      } else {
        let finished = false;
        for await (const j of events(r)) {
          if (!Array.isArray(j.choices)) throw new Error('upstream');
          if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
          await write('data: ' + JSON.stringify(output(j)) + '\n\n');
          if (j.choices.some(c => meaningful(c.delta))) delivered = true;
          if (j.choices.some(c => c.finish_reason != null)) finished = true;
        }
        if (!finished || !delivered) throw new Error('upstream');
        res.end('data: [DONE]\n\n');
      }
    } catch (e) {
      if (!res.destroyed) fail(res, signal.aborted && !ac.signal.aborted ? 504 : 502, signal.aborted && !ac.signal.aborted ? 'Model request timed out.' : 'Model provider could not complete the request.', 'upstream_error');
    } finally {
      if (stopKeepAlive) stopKeepAlive();
      ac.abort(); res.off('close', onClose);
      const count = (active.get(user.id) || 1) - 1; if (count) active.set(user.id, count); else active.delete(user.id);
      if (!delivered && chargedDay === bill.today()) { bill.add(user.id, 'm', -charge.weight); bill.flush(); }
    }
  };
}
module.exports = { createPublicApi, validate };
