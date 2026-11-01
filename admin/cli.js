#!/usr/bin/env node
// Восстановление доступа к панели прямо на сервере (из папки Premier):
//   node admin/cli.js list                    — администраторы и их роли
//   node admin/cli.js reset-2fa [логин]       — выключить 2FA (по умолчанию у владельца owner), если потерян телефон
//   node admin/cli.js reset-password <логин>  — новый пароль; для owner — новый случайный пароль при следующем запуске
//   node admin/cli.js logout-all              — завершить все сессии панели
'use strict';
const store = require('../db');
const { createAuth } = require('./auth');
const auth = createAuth({ store, owner: { check: () => false, set() {}, fromEnv: () => !!process.env.ADMIN_PASSWORD } });
const [cmd, arg] = process.argv.slice(2);
const q = (sql) => store.db.prepare(sql);
const byLogin = (l) => q('SELECT * FROM admins WHERE lower(login) = lower(?)').get(String(l || ''));

if (cmd === 'list') {
  for (const a of auth.list()) console.log(`${a.login.padEnd(20)} ${a.roleName.padEnd(14)} 2FA: ${a.totp ? 'да' : 'нет'}${a.disabled ? '  (отключён)' : ''}`);
} else if (cmd === 'reset-2fa') {
  const a = byLogin(arg || 'owner'); if (!a) { console.error('Нет такого администратора'); process.exit(1); }
  q('UPDATE admins SET totp = NULL, totp_on = 0, totp_last = 0 WHERE id = ?').run(a.id);
  console.log(`2FA у ${a.login} выключена. Войдите по паролю и включите защиту заново в «Профиль и безопасность».`);
} else if (cmd === 'reset-password') {
  const a = byLogin(arg); if (!a) { console.error('Укажите логин: node admin/cli.js reset-password <логин>'); process.exit(1); }
  if (a.id === 'owner') {
    if (process.env.ADMIN_PASSWORD) { console.log('Пароль владельца задан в ADMIN_PASSWORD — поменяйте его в окружении и перезапустите Premier.'); process.exit(0); }
    store.kv.del('admin:pw');
    console.log('Пароль владельца сброшен. Перезапустите Premier — новый пароль появится в журнале и в data/admin-password.txt.');
  } else {
    const r = auth.update(a.id, { resetPassword: true });
    console.log(`Новый пароль для ${a.login}: ${r.password}`);
  }
} else if (cmd === 'logout-all') {
  console.log(`Завершено сессий: ${q('DELETE FROM admin_sessions').run().changes}`);
} else {
  console.log('Команды: list | reset-2fa [логин] | reset-password <логин> | logout-all');
}
