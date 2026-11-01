'use strict';
const crypto = require('node:crypto');
const hash = (key) => crypto.createHash('sha256').update(key).digest('hex');
const parseModels = (v) => {
  if (v == null || v === '') return null;
  try { const a = JSON.parse(v); return Array.isArray(a) && a.length ? a.map(String).filter(Boolean) : null; } catch { return null; }
};
function createKeyStore(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, prefix TEXT NOT NULL,
    created INTEGER NOT NULL, expires INTEGER, last_used INTEGER);
    CREATE INDEX IF NOT EXISTS api_keys_uid ON api_keys(uid);`);
  try { store.db.exec('ALTER TABLE api_keys ADD COLUMN models TEXT'); } catch {} // миграция: ограничение ключа по моделям
  const q = (sql) => store.db.prepare(sql);
  const fields = 'id, name, prefix, created, expires, last_used, models';
  return {
    list: (uid) => q(`SELECT ${fields} FROM api_keys WHERE uid = ? ORDER BY created DESC`).all(uid).map(r => ({ ...r, models: parseModels(r.models) })),
    create(uid, name, days, models) {
      return store.tx(() => {
        if (q('SELECT count(*) AS n FROM api_keys WHERE uid = ?').get(uid).n >= 5)
          throw Object.assign(new Error('Максимум 5 ключей на аккаунт. Чтобы создать новый, сначала отзовите один.'), { status: 409 });
        const key = 'sk-premier-' + crypto.randomBytes(32).toString('hex');
        const list = Array.isArray(models) && models.length ? models : null;
        const item = { id: crypto.randomBytes(12).toString('hex'), name, prefix: key.slice(0, 18) + '…' + key.slice(-4), created: Date.now(), expires: days ? Date.now() + days * 86400000 : null, last_used: null, models: list };
        q('INSERT INTO api_keys(id, uid, hash, name, prefix, created, expires, models) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(item.id, uid, hash(key), name, item.prefix, item.created, item.expires, list ? JSON.stringify(list) : null);
        return { ...item, key };
      });
    },
    remove: (uid, id) => q('DELETE FROM api_keys WHERE uid = ? AND id = ?').run(uid, id).changes > 0,
    authenticate(header) {
      const match = /^Bearer (sk-premier-[a-f0-9]{64})$/i.exec(String(header || ''));
      if (!match) return null;
      const row = q('SELECT id, uid, expires, models FROM api_keys WHERE hash = ?').get(hash(match[1]));
      if (!row || (row.expires && row.expires <= Date.now())) return null;
      const user = store.users.get(row.uid); if (!user) return null;
      q('UPDATE api_keys SET last_used = ? WHERE id = ?').run(Date.now(), row.id);
      return { user, keyId: row.id, keyModels: parseModels(row.models) };
    },
  };
}
module.exports = { createKeyStore };
