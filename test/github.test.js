'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), http = require('http'), path = require('path');
const { copyApp, seed, startServer, rm } = require('./helpers');

// поддельный GitHub: код авторизации определяет, какой пользователь «вошёл»
const PEOPLE = {
  new: { user: { id: 101, login: 'octocat', name: 'Octo Cat' }, emails: [{ email: 'octo@example.com', verified: true, primary: true }] },
  anna: { user: { id: 102, login: 'anna-gh', name: 'Anna' }, emails: [{ email: 'x@users.noreply.github.com', verified: true, primary: true }, { email: 'anna@example.com', verified: true, primary: false }] },
  noemail: { user: { id: 103, login: 'ghost' }, emails: [{ email: 'ghost@example.com', verified: false, primary: true }] },
};
function mockGithub() {
  const tokens = new Map();
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
      const send = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.url === '/login/oauth/access_token' && req.method === 'POST') {
        const p = new URLSearchParams(body);
        if (p.get('client_id') !== 'gh-id' || p.get('client_secret') !== 'gh-secret' || !PEOPLE[p.get('code')]) return send(200, { error: 'bad_verification_code' });
        const t = 'tok-' + p.get('code'); tokens.set(t, PEOPLE[p.get('code')]); return send(200, { access_token: t, token_type: 'bearer' });
      }
      const who = tokens.get((req.headers.authorization || '').replace('Bearer ', ''));
      if (!who) return send(401, {});
      if (req.url === '/user') return send(200, who.user);
      if (req.url === '/user/emails') return send(200, who.emails);
      send(404, {});
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })));
}

test('вход через GitHub', async (t) => {
  const gh = await mockGithub();
  const dir = copyApp(); seed(dir); // u1 — anna@example.com (создан раньше, например через Google)
  const s = await startServer(dir, { GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret', GITHUB_OAUTH_URL: gh.url, GITHUB_API_URL: gh.url });
  t.after(async () => { await s.stop(); gh.close(); rm(dir); });
  const login = async (code, { badState = false } = {}) => {
    const a = await s.req('GET', '/api/auth/github');
    assert.equal(a.status, 302); const loc = new URL(a.headers.get('location'));
    assert.equal(loc.origin + loc.pathname, gh.url + '/login/oauth/authorize'); assert.equal(loc.searchParams.get('client_id'), 'gh-id');
    const st = loc.searchParams.get('state'), ck = a.headers.get('set-cookie').match(/gh_state=([^;]+)/)[1];
    const cb = await s.req('GET', `/api/auth/github/callback?code=${code}&state=${badState ? 'x'.repeat(st.length) : st}`, { headers: { Cookie: 'gh_state=' + ck } });
    assert.equal(cb.status, 302);
    const sess = (cb.headers.get('set-cookie') || '').match(/premier_session=([a-f0-9]+)/);
    return { to: cb.headers.get('location'), token: sess && sess[1] };
  };
  const me = async (token) => (await s.req('GET', '/api/auth/me', { token })).json;

  await t.test('кнопка включена', async () => { assert.equal((await me()).github, true); assert.match((await s.req('GET', '/login')).text, /window\.GITHUB=true/); });
  let first;
  await t.test('новый пользователь регистрируется', async () => {
    const r = await login('new'); assert.equal(r.to, '/chat'); assert.ok(r.token);
    const u = (await me(r.token)).user; first = u.id;
    assert.equal(u.email, 'octo@example.com'); assert.equal(u.name, 'Octo Cat'); assert.equal(u.github, 'octocat'); assert.equal(u.login, 'octocat');
  });
  await t.test('повторный вход — тот же аккаунт', async () => { const r = await login('new'); assert.equal((await me(r.token)).user.id, first); });
  await t.test('существующий аккаунт с той же подтверждённой почтой привязывается', async () => {
    const r = await login('anna'); const u = (await me(r.token)).user;
    assert.equal(u.id, 'u1'); assert.equal(u.github, 'anna-gh');
  });
  await t.test('без подтверждённой почты — понятная ошибка', async () => { assert.equal((await login('noemail')).to, '/login?err=github_email'); });
  await t.test('чужой state отклоняется', async () => { const r = await login('new', { badState: true }); assert.equal(r.to, '/login?err=github_state'); assert.equal(r.token, null); });
  await t.test('отмена на стороне GitHub', async () => {
    const r = await s.req('GET', '/api/auth/github/callback?error=access_denied&state=a', { headers: { Cookie: 'gh_state=a' } });
    assert.equal(r.headers.get('location'), '/login?err=github_cancel');
  });
  await t.test('неверный код', async () => { assert.equal((await login('bad')).to, '/login?err=github_fail'); });
});

test('без ключей GitHub кнопка выключена', async (t) => {
  const dir = copyApp(); seed(dir); const s = await startServer(dir); t.after(async () => { await s.stop(); rm(dir); });
  assert.equal((await s.req('GET', '/api/auth/me')).json.github, false);
  assert.equal((await s.req('GET', '/api/auth/github')).headers.get('location'), '/login?err=github_off');
});

test('старая база получает колонку github', async (t) => {
  const dir = copyApp(); t.after(() => rm(dir));
  const { DatabaseSync } = require('node:sqlite');
  const old = new DatabaseSync(path.join(dir, 'data', 'premier.db'));
  old.exec("CREATE TABLE users (id TEXT PRIMARY KEY, login TEXT NOT NULL, email TEXT, google TEXT, created TEXT, data TEXT NOT NULL); INSERT INTO users VALUES ('a','old','o@x.ru',NULL,'2025-01-01','{\"id\":\"a\",\"login\":\"old\",\"email\":\"o@x.ru\"}')"); old.close();
  const store = require(path.join(dir, 'db.js')); t.after(() => store.db.close());
  store.users.update('a', (u) => { u.github = '55'; });
  assert.equal(store.users.byGithub('55').login, 'old');
});
