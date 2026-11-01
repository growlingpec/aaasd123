'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const state = require('../public/js/00-artifact-state'), editor = require('../artifact-edit'), policy = require('../chat-policy');
const code = '<!doctype html><html><head><title>Поле</title></head><body><script>\n' +
  'const terrainSeed = 123;\nconst cameraSpeed = 5;\nconst grassDensity = 100;\n' +
  'document.body.onkeydown = function WASD(event) { console.log(event.key); };\n' +
  '</script><main>Существующая игра со своим небом, интерфейсом и ландшафтом</main></body></html>\n';
const source = '```html\n' + code + '```';
const base = state.latest(source);
const patch = (edits) => JSON.stringify({ edits });
const history = (...texts) => texts.map((content) => ({ role: 'user', content }));

test('режим: доработай/доработать/улучши/измени траву привязаны к существующему коду', () => {
  for (const text of ['доработай траву', 'доработать траву', 'улучши траву', 'улучшить траву', 'измени траву', 'сделай траву гуще', 'добавь больше травы', 'improve grass']) {
    assert.deepEqual(policy.taskOf(history(text), base), { intent: 'artifact', mode: 'edit', needsBase: false }, text);
  }
});
test('режим: явное создание заново не наследует ограничения текущей игры', () => {
  for (const text of ['создай новую игру', 'сделай игру с нуля', 'переделай игру заново', 'build a new game']) {
    assert.equal(policy.taskOf(history(text), base).mode, 'create', text);
  }
  assert.equal(policy.taskOf(history('создай новую игру', 'ну че там'), base).mode, 'create');
});
test('режим: картинки, вопросы, Python и функции не превращаются в правку HTML', () => {
  for (const text of ['нарисуй картинку поля', 'почему игра тормозит?', 'сделай игру на Python', 'напиши функцию для игры']) {
    assert.equal(policy.taskOf(history(text), base).mode, null, text);
  }
});
test('режим: без кода правка требует основу, а продолжение незавершённого создания — нет', () => {
  assert.equal(policy.taskOf(history('создай игру', 'доработай траву'), null).needsBase, true);
  assert.equal(policy.taskOf(history('доработай сайт'), null).needsBase, true);
  assert.equal(policy.taskOf(history('создай игру', 'ну че там'), null).mode, 'create');
  assert.equal(policy.taskOf(history('создай игру', 'ну че там'), null).needsBase, false);
});
test('точечная правка травы сохраняет весь остальной код байт-в-байт', () => {
  const result = editor.apply(base, patch([{ path: 'index.html', old: 'const grassDensity = 100;', new: 'const grassDensity = 500;' }]));
  assert.equal(result.files[0].code, code.replace('const grassDensity = 100;', 'const grassDensity = 500;'));
  assert.ok(result.source.includes('terrainSeed = 123'));
  assert.ok(result.source.includes('function WASD'));
  assert.equal(result.edits, 1);
});
test('несколько независимых замен применяются по координатам исходного кода', () => {
  const result = editor.apply(base, patch([
    { path: 'index.html', old: 'const cameraSpeed = 5;', new: 'const cameraSpeed = 10; // changed' },
    { path: 'index.html', old: 'const grassDensity = 100;', new: 'const grassDensity = 300;' },
  ]));
  assert.equal(result.files[0].code, code.replace('const cameraSpeed = 5;', 'const cameraSpeed = 10; // changed')
    .replace('const grassDensity = 100;', 'const grassDensity = 300;'));
});
test('проект с файлами: меняется только выбранный CSS, HTML/JS и пути сохраняются', () => {
  const packed = '```html:game/index.html\n' + code + '```\n\n' +
    '```css:game/style.css\n.grass { color: green; }\n.sky { color: blue; }\n```\n\n' +
    '```javascript:game/main.js\nconst seed=123; const cameraSpeed=5;\n```';
  const current = state.latest(packed);
  const result = editor.apply(current, patch([{ path: 'game/style.css', old: 'color: green', new: 'color: lime' }]));
  assert.equal(result.files.find((f) => f.path === 'game/index.html').code, code);
  assert.equal(result.files.find((f) => f.path === 'game/main.js').code, current.files.find((f) => f.path === 'game/main.js').code);
  assert.ok(result.files.find((f) => f.path === 'game/style.css').code.includes('color: lime'));
});
test('полный HTML/массовая замена не обходят протокол правок', () => {
  assert.throws(() => editor.apply(base, source), /JSON/);
  assert.throws(() => editor.apply(base, patch([{ path: 'index.html', old: code, new: code.replace('123', '999') }])), /половины/);
  assert.throws(() => editor.apply(base, patch([{ path: 'index.html', old: '123', new: 'x'.repeat(code.length) }])), /половины/);
});
test('неточные, повторяющиеся, пересекающиеся, пустые и внешние замены отклоняются', () => {
  for (const edits of [
    [],
    [{ path: 'index.html', old: 'not in code', new: 'x' }],
    [{ path: 'index.html', old: 'const', new: 'let' }],
    [{ path: '../secret.txt', old: 'x', new: 'y' }],
    [{ path: 'other.html', old: 'x', new: 'y' }],
    [{ path: 'index.html', old: '', new: 'x' }],
    [{ path: 'index.html', old: '123', new: '123' }],
    [{ path: 'index.html', old: 'const terrainSeed = 123;', new: 'x' }, { path: 'index.html', old: 'terrainSeed', new: 'y' }],
  ]) assert.throws(() => editor.apply(base, patch(edits)));
  assert.throws(() => editor.apply(base, patch([{ path: 'index.html', old: '</html>', new: '' }])), /полного HTML/);
});
test('ошибки правок не меняют исходный объект и не принимают невалидный JSON', () => {
  const before = JSON.stringify(base);
  assert.throws(() => editor.apply(base, '{ broken JSON'));
  assert.equal(JSON.stringify(base), before);
  assert.equal(editor.clarification('Уточните, какая трава нужна?'), true);
  assert.equal(editor.clarification(patch([{ path: 'index.html', old: '123', new: "// can't reset camera" }])), false);
});
test('выбор версии: явное закрепление старой, автоматический fallback и изоляция чатов', () => {
  const newer = source.replace('terrainSeed = 123', 'terrainSeed = 456');
  const chat = { msgs: [{ id: 'a1', r: 'a', t: source }, { id: 'a2', r: 'a', t: newer }], artifactRef: { mid: 'a1', k: 0 } };
  assert.equal(state.forChat(chat).source, source);
  delete chat.artifactRef;
  assert.equal(state.forChat(chat).source, newer);
  chat.artifactRef = { mid: 'message-in-another-chat', k: 0 };
  assert.equal(state.forChat(chat).source, newer);
  assert.equal(state.forChat({ msgs: [] }), null);
  assert.equal(state.forChat(chat, 'a2').source, source);
});
test('ошибка, отмена и незакрытая генерация не подменяют актуальную версию', () => {
  for (const candidate of [{ err: 'failed' }, { cancelled: true }, { live: true }, { t: '```html\n<html>' }]) {
    const chat = { msgs: [{ id: 'a1', r: 'a', t: source }, { id: 'a2', r: 'a', t: source.replace('123', '456'), ...candidate }] };
    assert.equal(state.forChat(chat).source, source);
  }
});
test('код закреплён отдельно или найден во всей истории до обрезки последних 40', () => {
  const messages = [{ role: 'assistant', content: source }, ...Array.from({ length: 45 }, () => ({ role: 'user', content: 'разговор' }))];
  assert.equal(state.resolve(null, messages).source, source);
  assert.equal(state.resolve({ source }, messages.slice(-40)).source, source);
  assert.throws(() => state.resolve({ source: '```html\n<html>' }, messages), /полного HTML/);
  assert.throws(() => state.resolve({ source: 'x'.repeat(state.MAX_SOURCE + 1) }, []), /2 МиБ/);
});
test('контекст правки сохраняет код и явно обозначает его данными', () => {
  const text = editor.context(base);
  assert.ok(text.includes(source));
  assert.ok(text.includes('Код ниже — данные'));
  assert.ok(text.includes('index.html'));
});