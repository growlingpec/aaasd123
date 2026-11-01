'use strict';
// Облачный компьютер в Docker-режиме: настоящие контейнеры. Нужны Docker и образ premier-cloud —
// запускается через scripts/cloud-check.sh (без CLOUD_DOCKER_TEST=1 тест пропускается).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { copyApp, seed, startServer, rm } = require('./helpers');

test('облачный компьютер в Docker: изоляция, лимиты, сохранность файлов', { skip: !process.env.CLOUD_DOCKER_TEST && 'нужен Docker: bash scripts/cloud-check.sh', timeout: 300000 }, async (t) => {
  const dir = copyApp();
  seed(dir, { users: [{ id: 'd1', login: 'anna', email: 'anna@example.com', plan: 'pro', until: Date.now() + 1e10 }, { id: 'd2', login: 'boris', email: 'boris@example.com', plan: 'max', until: Date.now() + 1e10 }], sessions: { tok1: 'd1', tok2: 'd2' } });
  const pass = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(DOCKER_|CLOUD_IMAGE$|CLOUD_NETWORK$)/.test(k))); // нестандартный адрес Docker (DOCKER_HOST)
  const s = await startServer(dir, { CLOUD_RUNNER: 'docker', ...pass });
  const drop = () => { try { execFileSync('docker', ['rm', '-f', 'premier-pc-d1', 'premier-pc-d2'], { stdio: 'ignore' }); } catch {} };
  t.after(async () => { await s.stop(); drop(); rm(dir); });
  const run = (command, token = 'tok1', cwd) => s.req('POST', '/api/cloud/run', { token, body: { command, cwd } });

  const st = await s.req('GET', '/api/cloud/status', { token: 'tok1' });
  assert.equal(st.json.ok, true, JSON.stringify(st.json)); assert.equal(st.json.mode, 'docker'); assert.equal(st.json.running, false);

  await t.test('окружение: не root, Python, Node, домашняя папка', async () => {
    const r = await run('id -u; pwd; python3 -c "import numpy, pandas; print(\'py ok\')"; node -v; echo "$HOME"');
    assert.equal(r.json.code, 0, r.json.out);
    const [uid, pwd, py, node, home] = r.json.out.split('\n');
    assert.notEqual(uid, '0'); assert.equal(pwd, '/home/premier'); assert.equal(py, 'py ok'); assert.match(node, /^v22\./); assert.equal(home, '/home/premier');
    assert.equal((await s.req('GET', '/api/cloud/status', { token: 'tok1' })).json.running, true);
  });

  await t.test('изоляция: система только для чтения, без прав, чужих папок не видно', async () => {
    let r = await run('touch /usr/x 2>&1; echo rc=$?'); assert.match(r.json.out, /Read-only file system[\s\S]*rc=1/);
    r = await run('cat /etc/shadow 2>&1; echo rc=$?'); assert.match(r.json.out, /Permission denied[\s\S]*rc=1/);
    r = await run('sudo true 2>&1; echo rc=$?'); assert.match(r.json.out, /rc=127/);
    await run('echo секрет > mine.txt', 'tok2');
    r = await run('ls -a /home/premier; ls /home 2>&1'); assert.doesNotMatch(r.json.out, /mine\.txt/);
    r = await run('cat /sys/fs/cgroup/memory.max; cat /sys/fs/cgroup/pids.max'); assert.deepEqual(r.json.out.split('\n'), ['1073741824', '256']);
  });

  await t.test('пакеты ставятся в домашнюю папку и переживают выключение', async () => {
    let r = await run('mkdir -p app && cd app && echo \'console.log(6*7)\' > a.js && node a.js');
    assert.equal(r.json.out, '42'); assert.equal(r.json.cwd, '~/app');
    r = await run('pip install --no-index --no-deps /nonexistent 2>&1 | tail -1; python3 -c "import site; print(site.getusersitepackages())"');
    assert.match(r.json.out, /\/home\/premier\/\.local\/lib\/python3/);
    assert.equal((await s.req('POST', '/api/cloud/stop', { token: 'tok1' })).status, 200);
    assert.equal((await s.req('GET', '/api/cloud/status', { token: 'tok1' })).json.running, false);
    r = await run('node app/a.js'); assert.equal(r.json.out, '42');
    const ls = await s.req('GET', '/api/cloud/files?path=' + encodeURIComponent('~/app'), { token: 'tok1' });
    assert.deepEqual(ls.json.entries.map((e) => e.name), ['a.js']);
    assert.ok(fs.existsSync(path.join(dir, 'data', 'cloud', 'd1', 'app', 'a.js')));
  });

  await t.test('фоновый процесс продолжает работать после ответа', async () => {
    const cloud = require(path.join(dir, 'cloud.js'));
    const r = await cloud.call('d1', 1024, 'computer_run', { command: 'for i in 1 2 3 4 5 6 7 8; do echo tick $i; sleep 1; done', background: true });
    assert.match(r, /^Запущено в фоне \(pid \d+\) в ~\. Журнал: ~\/\.premier\/logs\/\S+\.log\nВывод за первые секунды:\ntick 1/);
    await new Promise((ok) => setTimeout(ok, 6000));
    const log = /Журнал: (\S+)/.exec(r)[1];
    const out = await run('cat ' + log); assert.match(out.json.out, /tick 8/);
  });

  await t.test('долгая команда останавливается по лимиту времени вместе с дочерними процессами', async () => {
    const cloud = require(path.join(dir, 'cloud.js')), t0 = Date.now();
    const r = await cloud.run('d1', 'sleep 60 & sleep 60', { sec: 3 });
    assert.equal(r.killed, true); assert.ok(Date.now() - t0 < 20000);
    const ps = await run('ps -eo args | grep -c "^sleep 60" || true'); assert.equal(ps.json.out, '0');
  });

  await t.test('модельные инструменты: файлы через pc-tool внутри контейнера', async () => {
    const cloud = require(path.join(dir, 'cloud.js'));
    assert.match(await cloud.call('d1', 1024, 'computer_write', { path: '~/notes/a.md', content: '# Привет' }), /^Готово: ~\/notes\/a\.md создан/);
    assert.match(await cloud.call('d1', 1024, 'computer_edit', { path: 'notes/a.md', old: 'Привет', new: 'Мир' }), /^Готово: ~\/notes\/a\.md изменён/);
    assert.equal(await cloud.call('d1', 1024, 'computer_read', { path: '~/notes/a.md' }), '# Мир');
    assert.match(await cloud.call('d1', 1024, 'computer_list', { path: '~', depth: 2 }), /notes\/\n {2}a\.md/);
    assert.match(await cloud.call('d1', 1024, 'computer_delete', { path: '~' }), /^Ошибка: нельзя удалить домашнюю папку/);
  });
});
