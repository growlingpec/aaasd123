'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const browser = require('../browser');

test('Chromium: sandbox по умолчанию, прокси без обхода loopback и без прямого DNS/UDP', () => {
  const args = browser.launchArgs('http://127.0.0.1:12345', false);
  assert.ok(!args.includes('--no-sandbox'));
  for (const arg of [
    '--proxy-server=http://127.0.0.1:12345', '--proxy-bypass-list=<-loopback>',
    '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  ]) assert.ok(args.includes(arg), arg);
  assert.ok(browser.launchArgs('http://127.0.0.1:12345', true).includes('--no-sandbox'));
});

test('Chromium: запрещённые схемы, credentials и локальные имена не доходят до навигации', () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'http://localhost./', 'http://a.internal/', 'https://user:pass@example.com/', 'invalid'])
    assert.equal(browser.allowed(url), false, url);
  for (const url of ['https://example.com/', 'data:text/html,hello', 'about:blank', 'blob:https://example.com/id'])
    assert.equal(browser.allowed(url), true, url);
});