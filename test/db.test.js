'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('path'), fs = require('fs');
const { copyApp, seed, rm } = require('./helpers');

test('база: перенос JSON и синхронизация чатов по одному', async (t) => {
  const dir = copyApp();
  seed(dir, { chats: { u1: { rev: 7, state: { projects: [{ id: 'p1', name: 'Работа' }], model: 'm1', chats: [{ id: 'a', msgs: [{ r: 'u', t: '1' }] }, { id: 'b', msgs: [] }] } } } });
  const store = require(path.join(dir, 'db.js'));
  t.after(() => { store.db.close(); rm(dir); });

  await t.test('пользователи и сессии перенесены, файлы отложены', () => {
    assert.equal(store.users.get('u1').login, 'anna');
    assert.ok(fs.readdirSync(path.join(dir, 'data')).some((n) => n.startsWith('legacy-json-')));
    assert.ok(!fs.existsSync(path.join(dir, 'data', 'users.json')));
  });
  await t.test('старые чаты разложены по строкам с сохранением порядка', () => {
    const f = store.chats.full('u1');
    assert.deepEqual(f.state.chats.map((c) => c.id), ['a', 'b']);
    assert.equal(f.state.model, 'm1');
    assert.equal(store.kv.get('chat:u1', null), null);
  });
  await t.test('since отдаёт только изменения', () => {
    const r0 = store.chats.rev('u1');
    const w = store.chats.write('u1', r0, { put: [{ id: 'a', msgs: [{ r: 'u', t: '1' }, { r: 'a', t: '2' }] }] });
    assert.equal(w.rev, r0 + 1); assert.deepEqual(w.conflicts, []);
    const s = store.chats.since('u1', r0);
    assert.deepEqual(s.chats.map((c) => c.id), ['a']); assert.equal(s.meta, null);
  });
  await t.test('правка с устаревшей версией не затирает чужую — конфликт', () => {
    const base = store.chats.rev('u1') - 1; // устройство, которое не видело последнюю правку чата a
    const w = store.chats.write('u1', base, { put: [{ id: 'a', msgs: [] }, { id: 'c', msgs: [] }] });
    assert.deepEqual(w.conflicts, ['a']);
    assert.equal(store.chats.full('u1').state.chats.find((c) => c.id === 'a').msgs.length, 2);
    assert.ok(store.chats.full('u1').state.chats.some((c) => c.id === 'c'));
  });
  await t.test('удаление важнее правки и приходит надгробием', () => {
    const r = store.chats.rev('u1');
    store.chats.write('u1', r, { del: ['b'] });
    const s = store.chats.since('u1', r);
    assert.deepEqual(s.chats, [{ id: 'b', v: r + 1, data: null }]);
    assert.ok(!store.chats.full('u1').state.chats.some((c) => c.id === 'b'));
    assert.ok(!store.chats.since('u1', 0).chats.some((c) => c.id === 'b'), 'при since=0 надгробий нет');
  });
  await t.test('конфликт меты', () => {
    const r = store.chats.rev('u1');
    assert.equal(store.chats.write('u1', r, { meta: { projects: [] } }).metaConflict, false);
    assert.equal(store.chats.write('u1', r, { meta: { projects: [{ id: 'x' }] } }).metaConflict, true);
  });
  await t.test('слишком большой чат отклоняется', () => {
    assert.throws(() => store.chats.write('u1', store.chats.rev('u1'), { put: [{ id: 'big', t: 'x'.repeat(8e6 + 10) }] }), /8 МБ/);
  });
  await t.test('удаление пользователя стирает его чаты', () => {
    store.users.remove('u1');
    assert.equal(store.chats.rev('u1'), 0); assert.equal(store.chats.full('u1').state, null);
  });
});
