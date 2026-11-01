'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const code = require('../code');

test('контейнер для Python: без сети, только чтение, лимиты', () => {
  const a = code.dockerArgs('abc', '/x').join(' ');
  for (const s of ['--network none', '--read-only', '--cap-drop ALL', '--security-opt no-new-privileges', '--user 65534:65534', '--pids-limit 128', '--memory 512m', 'type=tmpfs,destination=/work/out,tmpfs-size=52428800', '/x:/work/src:ro'])
    assert.ok(a.includes(s), s);
  assert.ok(!a.includes(':/work/out'), 'папка результатов не должна быть папкой на диске сервера');
});
const hasPy = (() => { try { execFileSync('python3', ['--version']); return true; } catch { return false; } })();
test('результаты из контейнера: файлы, вывод, код выхода; ссылки и скрытые файлы пропускаются', { skip: !hasPy && 'нет python3' }, () => {
  const D = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-code-'));
  try {
    fs.mkdirSync(D + '/src'); fs.mkdirSync(D + '/out');
    fs.writeFileSync(D + '/src/main.py', 'import os,sys\nprint("привет")\nprint("ой", file=sys.stderr)\nopen("a.png","wb").write(b"1"*700)\nos.makedirs("d",exist_ok=True)\nopen("d/"+"я"*80+".txt","w").write("x")\nos.symlink("/etc/passwd","link")\nopen(".h","w").write("h")\nsys.exit(3)\n');
    const cmd = code.INNER.replace(/\/work\/src/g, D + '/src').replace(/\/work\/out/g, D + '/out').replace(/\/work/g, D).replace(/\/tmp\/meta/g, D + '/meta').replace(/python /, 'python3 ');
    const t = code.untar(execFileSync('sh', ['-c', cmd], { maxBuffer: 1e8 }));
    assert.equal(t.ok, true); assert.equal(t.meta.stdout, 'привет\n'); assert.equal(t.meta.stderr, 'ой\n'); assert.equal(Number(t.meta.rc), 3);
    assert.deepEqual(t.files.map((f) => f.rel).sort(), ['a.png', 'd/' + 'я'.repeat(80) + '.txt']);
    assert.equal(t.files.find((f) => f.rel === 'a.png').size, 700);
  } finally { fs.rmSync(D, { recursive: true, force: true }); }
});
test('битый архив не роняет сервер', () => {
  assert.equal(code.untar(Buffer.from('мусор')).ok, false);
  assert.equal(code.untar(Buffer.alloc(0)).ok, false);
});
