'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const mon = require('../monitor');
test('ошибки в коде отличаются от ошибок пользователя', () => {
  assert.equal(mon.isBug(new TypeError('x')), true);
  assert.equal(mon.isBug(new Error('Неверный пароль')), false);
  assert.equal(mon.isBug(Object.assign(new TypeError('x'), { status: 400 })), false);
  assert.equal(mon.isBug(new SyntaxError('Unexpected token in JSON')), false);
});
test('одинаковые ошибки склеиваются', () => {
  const n = mon.list().length; const ce = console.error; console.error = () => {};
  try { mon.error('тест', new TypeError('a')); mon.error('тест', new TypeError('a')); } finally { console.error = ce; }
  assert.equal(mon.list().length, n + 1); assert.equal(mon.list()[0].n, 2);
});
