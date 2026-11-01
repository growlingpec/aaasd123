'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const stream = require('../chat-stream');
const response = (chunks) => ({ body: (async function* () { for (const chunk of chunks) yield Buffer.from(chunk); })() });
const collect = async (r) => { const events = []; for await (const e of stream.events(r)) events.push(e); return events; };

test('SSE: разрезанный JSON, CRLF и последний JSON без новой строки', async () => {
  const result = await collect(response(['data: {"x":', '1}\r\n: keepalive\n', 'data: {"x":2}']));
  assert.deepEqual(result, [{ x: 1 }, { x: 2 }]);
});
test('SSE: UTF-8 не ломается на границе байтов, DONE игнорируется', async () => {
  const bytes = Buffer.from('data: {"text":"Привет"}\n\ndata: [DONE]\n');
  const body = (async function* () { for (const b of bytes) yield Buffer.from([b]); })();
  assert.deepEqual(await collect({ body }), [{ text: 'Привет' }]);
});
test('SSE: ошибки API и некорректный JSON не маскируются пустым ответом', async () => {
  await assert.rejects(collect(response(['data: {"error":{"message":"sensitive provider error"}}\n'])), /API модели сообщил ошибку/);
  await assert.rejects(collect(response(['data: not-json\n'])), /некорректный JSON/);
  await assert.rejects(collect({ body: null }), /пустой поток/);
});
test('таймаут модели: безопасное значение по умолчанию и настраиваемый предел', () => {
  const old = process.env.MODEL_REQUEST_TIMEOUT_MS;
  try {
    delete process.env.MODEL_REQUEST_TIMEOUT_MS; assert.equal(stream.timeoutMs(), 180000);
    process.env.MODEL_REQUEST_TIMEOUT_MS = 'no'; assert.equal(stream.timeoutMs(), 180000);
    process.env.MODEL_REQUEST_TIMEOUT_MS = '1000'; assert.equal(stream.timeoutMs(), 1000);
    process.env.MODEL_REQUEST_TIMEOUT_MS = '999999999'; assert.equal(stream.timeoutMs(), 600000);
  } finally { if (old === undefined) delete process.env.MODEL_REQUEST_TIMEOUT_MS; else process.env.MODEL_REQUEST_TIMEOUT_MS = old; }
});