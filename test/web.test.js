'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const web = require('../web');

test('внутренние адреса распознаются во всех записях', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::a00:1', '2002:7f00:1::1', 'not-an-ip'])
    assert.equal(web.isPrivate(ip), true, ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '2a00:1450:4010:c05::64', '1.1.1.1']) assert.equal(web.isPrivate(ip), false, ip);
});
test('обходные формы адреса localhost блокируются', async () => {
  for (const u of ['http://[::ffff:7f00:1]:3000/', 'http://127.1/', 'http://0x7f000001/', 'http://2130706433/', 'http://localhost:3000/', 'http://a.localhost/', 'file:///etc/passwd', 'http://[::1]/'])
    await assert.rejects(web.assertPublic(new URL(u)), /внутренний|только http/, u);
});
test('проверка адреса в момент соединения (защита от DNS rebinding)', async () => {
  const r = await new Promise((ok) => web.safeLookup('localhost', {}, (e, a) => ok(e ? e.code : a)));
  assert.equal(r, 'EPRIVATE');
});
