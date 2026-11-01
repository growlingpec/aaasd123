'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('path'), os = require('os');
const { copyApp, rm } = require('./helpers');
const desk = require('../desktop/premier-agent.js');

test('помощник блокирует разрушительные команды', () => {
  for (const c of ['rm -rf /', 'rm -rf ~', 'sudo rm -fr /*', 'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/sda', 'format c:', 'rd /s /q C:\\', 'Remove-Item -Recurse -Force C:\\', 'vssadmin delete shadows /all'])
    assert.throws(() => desk.guardCmd(c), /заблокирована/, c);
  for (const c of ['ls -la', 'npm install', 'rm -rf ./build', 'git status']) assert.doesNotThrow(() => desk.guardCmd(c), c);
  assert.equal(desk.P('~/x'), path.join(os.homedir(), 'x'));
});

test('подтверждения: авто-режим отключается после чтения сайтов', async (t) => {
  const dir = copyApp(); const agent = require(path.join(dir, 'agent.js')), store = require(path.join(dir, 'db.js'));
  t.after(() => { store.db.close(); rm(dir); });
  const { token, uid } = agent.connect(agent.makeCode('u1'), { os: 'test' });
  assert.equal(agent.uidOf(token), 'u1'); assert.equal(uid, 'u1');
  // помощник: забирает задачи и сразу отвечает
  let stop = false; (async () => { while (!stop) { const j = await agent.poll('u1', {}); if (j) agent.result('u1', j.jid, 'Готово: ' + j.name); } })();
  t.after(() => { stop = true; agent.disconnect('u1'); });
  const run = async (auto, name = 'computer_write') => {
    const ev = []; let asked = null;
    const p = agent.call('u1', (o) => { ev.push(o); if (o.ag?.ask) asked = o.ag; }, name, { path: '~/a.txt', content: 'x' }, auto);
    await new Promise((r) => setTimeout(r, 30));
    if (asked) agent.decide('u1', asked.cid, true);
    return { r: await p, asked };
  };
  assert.ok((await run(false)).asked, 'без авто-режима спрашиваем');
  assert.equal((await run('all')).asked, null, 'авто-режим — не спрашиваем');
  const w = await run('web'); assert.ok(w.asked, 'после чтения сайтов спрашиваем'); assert.equal(w.asked.why, 'web');
  assert.equal((await run('web', 'computer_read')).asked, null, 'чтение не требует подтверждения');
  assert.match(w.r, /^Готово/);
  // чужой пользователь не может подтвердить чужое действие
  const ev = []; const p = agent.call('u1', (o) => ev.push(o), 'computer_delete', { path: '~/x' }, false);
  await new Promise((r) => setTimeout(r, 20));
  const cid = ev.find((o) => o.ag).ag.cid;
  assert.equal(agent.decide('u2', cid, true), false);
  agent.decide('u1', cid, false); assert.match(await p, /ОТКЛОНИЛ/);
});
test('повторный опрос помощника не оставляет висящих запросов', async (t) => {
  const dir = copyApp(); const agent = require(path.join(dir, 'agent.js')), store = require(path.join(dir, 'db.js'));
  t.after(() => { store.db.close(); rm(dir); });
  const first = agent.poll('u9', {}); const second = agent.poll('u9', {});
  assert.equal(await first, null, 'первый запрос отпущен');
  agent.disconnect('u9'); assert.equal(await second, null);
});
