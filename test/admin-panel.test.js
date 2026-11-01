// Панель управления: вход и роли, 2FA, сессии после перезапуска, журнал действий, новые разделы и совместимость старых маршрутов.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { copyApp, seed, startServer, rm } = require('./helpers');
const { hotp, b32dec } = require('../admin/auth');

const PW = 'Test-Admin-Pass-2026';
const users = [
  { id: 'a1a1a1a1a1a1', login: 'anna', email: 'anna@example.com', created: '2026-01-01T00:00:00Z' },
  { id: 'b2b2b2b2b2b2', login: 'boris', email: 'boris@example.com', created: new Date(Date.now() - 2 * 864e5).toISOString(), plan: 'pro', until: Date.now() + 864e5 },
];
const totpNow = (secret) => hotp(b32dec(secret), Math.floor(Date.now() / 30000));

test('панель: вход, роли, 2FA, журнал, новые разделы', { timeout: 90000 }, async (t) => {
  const dir = copyApp();
  seed(dir, { users, sessions: { tokA: 'a1a1a1a1a1a1', tokB: 'b2b2b2b2b2b2' } });
  fs.writeFileSync(path.join(dir, 'data', 'payments.json'), JSON.stringify([
    { id: 'p-1', tx: 'tx-1', uid: 'b2b2b2b2b2b2', login: 'boris', plan: 'pro', days: 30, amount: 390, status: 'CONFIRMED', created: Date.now() - 864e5, paid: Date.now() - 864e5, applied: true },
    { id: 'p-2', tx: 'tx-2', uid: 'a1a1a1a1a1a1', login: 'anna', plan: 'max', days: 30, amount: 990, status: 'PENDING', created: Date.now() - 3600e3 },
  ]));
  let s = await startServer(dir);
  t.after(async () => { await s.stop(); rm(dir); });
  const as = (token) => (method, url, body) => s.req(method, url, { body, headers: { Authorization: 'Bearer ' + token } });

  // старый формат входа (только пароль) работает и даёт владельца
  assert.equal((await s.req('POST', '/api/admin/login', { body: { password: 'wrong-password-1' } })).status, 401);
  const login = await s.req('POST', '/api/admin/login', { body: { password: PW } });
  assert.equal(login.status, 200); assert.equal(login.json.admin.role, 'owner');
  const owner = as(login.json.token);
  assert.equal((await s.req('GET', '/api/admin/users/list')).status, 401);
  const me = await owner('GET', '/api/admin/me'); assert.equal(me.json.admin.login, 'owner'); assert.ok(me.json.admin.perms.includes('admins.manage'));

  // старые маршруты проходят через новую проверку входа
  assert.equal((await owner('GET', '/api/admin/users')).json.users.length, 2);
  assert.equal((await owner('GET', '/api/admin/plans')).status, 200);

  // список пользователей: фильтры, сортировка, агрегаты
  const list = await owner('GET', '/api/admin/users/list?status=paid');
  assert.equal(list.json.total, 1); assert.equal(list.json.items[0].login, 'boris'); assert.equal(list.json.items[0].spent, 390);
  assert.equal(list.json.facets.all, 2);
  assert.equal((await owner('GET', '/api/admin/users/list?q=ann')).json.items[0].id, 'a1a1a1a1a1a1');
  const card = await owner('GET', '/api/admin/users/b2b2b2b2b2b2');
  assert.equal(card.status, 200); assert.equal(card.json.payments.length, 1); assert.equal(card.json.usage.length, 30);
  const csv = await owner('GET', '/api/admin/users/export');
  assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(csv.text, /boris@example\.com/);

  // блокировка: сессии пользователя гаснут, вход в журнал с «было → стало»
  assert.equal((await s.req('GET', '/api/auth/me', { token: 'tokA' })).json.user.login, 'anna');
  assert.equal((await owner('POST', '/api/admin/users/a1a1a1a1a1a1/ban', { on: true, reason: 'спам' })).status, 200);
  assert.equal((await s.req('GET', '/api/auth/me', { token: 'tokA' })).json.user, null);
  const audit = await owner('GET', '/api/admin/audit?target=user:a1a1a1a1a1a1');
  assert.equal(audit.json.items[0].action, 'Аккаунт заблокирован');
  assert.ok(audit.json.items[0].data.diff.some((x) => x.p === 'user.banned'));
  assert.equal((await owner('GET', '/api/admin/users/list?status=banned')).json.total, 1);
  assert.equal((await owner('POST', '/api/admin/users/a1a1a1a1a1a1/ban', { on: false })).status, 200);

  // секреты не попадают в журнал
  await owner('POST', '/api/admin/pay', { merchant: 'm-1', secret: 'super-secret-value' });
  const payAudit = (await owner('GET', '/api/admin/audit?q=Platega')).json.items[0];
  assert.ok(payAudit && !JSON.stringify(payAudit).includes('super-secret-value'));

  // платежи: фильтры, сумма, возврат, выгрузка
  const pays = await owner('GET', '/api/admin/payments/list?status=CONFIRMED');
  assert.equal(pays.json.total, 1); assert.equal(pays.json.sum, 390); assert.equal(pays.json.counts.all, 2);
  assert.equal((await owner('GET', '/api/admin/payments/list?q=anna')).json.items[0].id, 'p-2');
  assert.equal((await owner('GET', '/api/admin/payments/p-1')).json.user.login, 'boris');
  assert.match((await owner('GET', '/api/admin/payments/export')).text, /tx-1/);
  assert.equal((await owner('POST', '/api/admin/payments/p-2/refund')).status, 400);

  // промокоды пачкой, пауза, статистика
  const bulk = await owner('POST', '/api/admin/promos/bulk', { prefix: 'SALE', count: 3, kind: 'discount', percent: 20 });
  assert.equal(bulk.json.codes.length, 3); assert.match(bulk.json.codes[0], /^SALE-[A-Z0-9]{7}$/);
  const paused = await owner('PATCH', '/api/admin/promos/' + bulk.json.codes[0], { paused: true });
  assert.equal(paused.json.status, 'paused');
  assert.equal((await owner('GET', '/api/admin/promos/list')).json.items.length, 3);
  assert.equal((await owner('POST', '/api/admin/promos/delete', { codes: bulk.json.codes })).json.n, 3);

  // дашборд, рефералы, API, модели, ошибки, сервер
  const dash = await owner('GET', '/api/admin/dashboard?days=7');
  assert.equal(dash.status, 200); assert.equal(dash.json.series.length, 7); assert.equal(dash.json.kpi.revenue.v, 390); assert.equal(dash.json.kpi.paying, 1);
  for (const u of ['/api/admin/referrals/stats', '/api/admin/referrals/list', '/api/admin/apistats?days=7', '/api/admin/apikeys', '/api/admin/modelhealth', '/api/admin/errors', '/api/admin/system', '/api/admin/badges', '/api/admin/find?q=bor', '/api/admin/reviews/list', '/api/admin/notify', '/api/admin/backups'])
    assert.equal((await owner('GET', u)).status, 200, u);
  assert.equal((await owner('GET', '/api/admin/find?q=bor')).json.users[0].login, 'boris');

  // объявление и техработы видны чату
  await owner('POST', '/api/admin/announce', { on: true, text: 'Скидка 20% до воскресенья', level: 'promo', link: '/chat' });
  const cfg = (await s.req('GET', '/api/config', { token: 'tokB' })).json;
  assert.equal(cfg.announce.text, 'Скидка 20% до воскресенья'); assert.equal(cfg.maintenance, undefined);
  await owner('POST', '/api/admin/announce', { on: true, text: 'Только для Max', plans: ['max'] });
  assert.equal((await s.req('GET', '/api/config', { token: 'tokB' })).json.announce, undefined);
  await owner('POST', '/api/admin/maintenance', { on: true, text: 'Обновляемся, 10 минут' });
  const chat = await s.req('POST', '/api/chat', { token: 'tokB', body: { model: 'x', messages: [] } });
  assert.equal(chat.status, 503); assert.equal(chat.json.error, 'Обновляемся, 10 минут');
  await owner('POST', '/api/admin/maintenance', { on: false });

  // резервная копия: создать и скачать по одноразовой ссылке
  const bk = await owner('POST', '/api/admin/backup');
  assert.equal(bk.status, 200); assert.ok(bk.json.size > 0);
  const file = await fetch(s.base + bk.json.url); assert.equal(file.status, 200); assert.ok((await file.arrayBuffer()).byteLength > 0);
  assert.equal((await fetch(s.base + bk.json.url)).status, 404);

  // команда: наблюдатель видит, но не меняет
  const created = await owner('POST', '/api/admin/admins', { login: 'olga', role: 'viewer' });
  assert.equal(created.status, 200); assert.ok(created.json.password);
  const vLogin = await s.req('POST', '/api/admin/login', { body: { login: 'olga', password: created.json.password } });
  assert.equal(vLogin.status, 200); assert.equal(vLogin.json.admin.role, 'viewer');
  const viewer = as(vLogin.json.token);
  assert.equal((await viewer('GET', '/api/admin/users/list')).status, 200);
  assert.equal((await viewer('POST', '/api/admin/users/b2b2b2b2b2b2/ban', { on: true })).status, 403);
  assert.equal((await viewer('POST', '/api/admin/plans', {})).status, 403);
  assert.equal((await viewer('GET', '/api/admin/admins')).status, 403);
  assert.equal((await viewer('POST', '/api/admin/backup')).status, 403);
  // поддержка может выдать сообщения, но не удалить аккаунт
  await owner('PATCH', '/api/admin/admins/' + created.json.admin.id, { role: 'support' });
  assert.equal((await viewer('POST', '/api/admin/usage', { uid: 'b2b2b2b2b2b2', action: 'give', amount: 5 })).status, 200);
  assert.equal((await viewer('DELETE', '/api/admin/users/b2b2b2b2b2b2')).status, 403);
  assert.equal((await viewer('POST', '/api/admin/users/bulk', { ids: ['b2b2b2b2b2b2'], action: 'delete' })).status, 403);
  // отключённый администратор сразу теряет доступ
  await owner('PATCH', '/api/admin/admins/' + created.json.admin.id, { disabled: true });
  assert.equal((await viewer('GET', '/api/admin/me')).status, 401);

  // 2FA владельца
  const setup = await owner('POST', '/api/admin/me/totp/setup');
  assert.match(setup.json.uri, /^otpauth:\/\/totp\//);
  assert.equal((await owner('POST', '/api/admin/me/totp/enable', { code: '000000' })).status, 400);
  assert.equal((await owner('POST', '/api/admin/me/totp/enable', { code: totpNow(setup.json.secret) })).status, 200);
  const need = await s.req('POST', '/api/admin/login', { body: { password: PW } });
  assert.equal(need.status, 401); assert.equal(need.json.totp, true);

  // сессия панели переживает перезапуск сервера
  await s.stop(); s = await startServer(dir);
  const again = as(login.json.token);
  const me2 = await again('GET', '/api/admin/me');
  assert.equal(me2.status, 200); assert.equal(me2.json.admin.totp, true);
  const sessions = await again('GET', '/api/admin/me/sessions'); assert.ok(sessions.json.items.length >= 1);
  await again('POST', '/api/admin/logout');
  assert.equal((await again('GET', '/api/admin/me')).status, 401);
});
