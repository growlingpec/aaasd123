'use strict';
// Аналитика для панели: дашборд, пользователи с агрегатами, здоровье моделей, статистика API и рефералов.
// Сутки считаются по Москве — так же, как дневные лимиты в billing.js.
const MSK = 3 * 3600e3, DAY = 864e5;
const dayOf = (ms) => new Date(ms + MSK).toISOString().slice(0, 10);
const dayStart = (d) => Date.parse(d + 'T00:00:00+03:00');
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const quant = (arr, k) => { if (!arr.length) return null; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(k * s.length))]; };
const sum = (list, f) => list.reduce((a, x) => a + (f(x) || 0), 0);

function createStats({ store, bill, loadModels }) {
  const q = (sql) => store.db.prepare(sql);
  const all = (sql, ...a) => { try { return q(sql).all(...a); } catch { return []; } }; // таблиц API может ещё не быть
  const one = (sql, ...a) => { try { return q(sql).get(...a) || {}; } catch { return {}; } };
  const cache = new Map();
  const cached = (key, ttl, fn) => { const c = cache.get(key); if (c && c.exp > Date.now()) return c.v; const v = fn(); cache.set(key, { v, exp: Date.now() + ttl }); return v; };
  const days = (n, offset = 0) => { const out = [], t = Date.now(); for (let i = n - 1 + offset; i >= offset; i--) out.push(dayOf(t - i * DAY)); return out; };
  const usageOf = (d) => store.kv.get('usage:' + d, {}) || {};
  const payAt = (p) => p.paid || (typeof p.created === 'number' ? p.created : Date.parse(p.created || '')) || 0;
  const createdAt = (u) => Date.parse(u.created || '') || 0;
  const isPaid = (u, now) => !!(u.plan && u.plan !== 'free' && u.until > now && !u.trial);
  const loginOf = (uid) => { const u = store.users.get(uid); return u ? u.login : null; };
  const dnDay = (dn) => new Date(dn * DAY).toISOString().slice(0, 10);

  /* ---------- дашборд ---------- */
  function dashboard(n) {
    n = [7, 14, 30, 90, 180, 365].includes(n) ? n : 30;
    return cached('dash:' + n, 30e3, () => {
      bill.flush();
      const now = Date.now(), cur = days(n), prev = days(n, n), from = dayStart(cur[0]), pfrom = dayStart(prev[0]);
      const U = new Map(); for (const d of new Set([...prev, ...cur, ...days(30)])) U.set(d, usageOf(d));
      const users = store.users.all(), pays = store.payments.byStatus('CONFIRMED'), cfg = bill.cfg();
      const S = new Map(cur.map((d) => [d, { d, revenue: 0, payments: 0, signups: 0, messages: 0, active: 0, api: 0 }]));
      for (const p of pays) { const s = S.get(dayOf(payAt(p))); if (s) { s.revenue += p.amount || 0; s.payments++; } }
      for (const u of users) { const s = S.get(dayOf(createdAt(u))); if (s) s.signups++; }
      for (const d of cur) { const v = Object.values(U.get(d)), s = S.get(d); s.messages = Math.round(sum(v, (x) => x.m)); s.active = v.filter((x) => x.m > 0).length; }
      for (const r of all('SELECT CAST((at + ?) / 86400000 AS INTEGER) dn, count(*) n FROM api_log WHERE at >= ? GROUP BY dn', MSK, from)) { const s = S.get(dnDay(r.dn)); if (s) s.api = r.n; }

      const inR = (t, a, b) => t >= a && t < b;
      const curPays = pays.filter((p) => inR(payAt(p), from, now + 1)), prevPays = pays.filter((p) => inR(payAt(p), pfrom, from));
      const curSign = users.filter((u) => inR(createdAt(u), from, now + 1)), prevSign = users.filter((u) => inR(createdAt(u), pfrom, from));
      const activeSet = (list) => { const s = new Set(); for (const d of list) for (const [uid, x] of Object.entries(U.get(d) || {})) if (x.m > 0) s.add(uid); return s; };
      const msgs = (list) => Math.round(sum(list, (d) => sum(Object.values(U.get(d) || {}), (x) => x.m)));
      const aCur = activeSet(cur), aPrev = activeSet(prev), payers = new Set(pays.map((p) => p.uid));
      const revenue = sum(curPays, (p) => p.amount), revenuePrev = sum(prevPays, (p) => p.amount);
      const paying = users.filter((u) => isPaid(u, now));
      const planById = (id) => cfg.plans.find((p) => p.id === id);
      const mrr = Math.round(sum(paying, (u) => { const p = planById(u.plan); return p && p.days ? (p.price * 30) / p.days : 0; }));
      const payersIn = (list) => new Set(list.map((p) => p.uid)).size;
      const conv = (list) => pct(list.filter((u) => payers.has(u.id)).length, list.length);
      const plans = Object.fromEntries(cfg.plans.map((p) => [p.id, 0]));
      for (const u of users) { const id = bill.planOf(u).id; plans[id] = (plans[id] || 0) + 1; }
      const group = (list, key) => { const m = new Map(); for (const p of list) { const k = key(p), e = m.get(k) || { key: k, n: 0, sum: 0 }; e.n++; e.sum += p.amount || 0; m.set(k, e); } return [...m.values()].sort((a, b) => b.sum - a.sum); };
      const expiringAll = paying.filter((u) => u.until < now + 3 * DAY).sort((a, b) => a.until - b.until);
      const churned = users.filter((u) => u.plan && u.plan !== 'free' && !u.trial && u.until >= from && u.until <= now).length;
      const modelUse = all("SELECT model, count(*) n, sum(ok) ok FROM modelstats WHERE kind = 'chat' AND at >= ? GROUP BY model ORDER BY n DESC LIMIT 8", Math.max(from, now - 7 * DAY));
      const names = new Map(loadModels().map((m) => [m.id, m.name]));
      const kpi = {
        revenue: { v: revenue, prev: revenuePrev },
        payments: { v: curPays.length, prev: prevPays.length },
        avgCheck: { v: curPays.length ? Math.round(revenue / curPays.length) : 0, prev: prevPays.length ? Math.round(revenuePrev / prevPays.length) : 0 },
        arppu: { v: payersIn(curPays) ? Math.round(revenue / payersIn(curPays)) : 0, prev: payersIn(prevPays) ? Math.round(revenuePrev / payersIn(prevPays)) : 0 },
        signups: { v: curSign.length, prev: prevSign.length },
        active: { v: aCur.size, prev: aPrev.size },
        messages: { v: msgs(cur), prev: msgs(prev) },
        conversion: { v: conv(curSign), prev: conv(prevSign) },
        users: users.length, paying: paying.length, trials: users.filter((u) => u.trial && u.until > now).length, banned: users.filter((u) => u.banned).length,
        mrr, churned, churnRate: pct(churned, paying.length + churned),
        dau: activeSet(days(1)).size, wau: activeSet(days(7)).size, mau: activeSet(days(30)).size,
      };
      return {
        days: n, from, kpi, series: [...S.values()], plans,
        planNames: Object.fromEntries(cfg.plans.map((p) => [p.id, p.name])),
        byProvider: group(curPays, (p) => p.provider || 'platega'), byPlan: group(curPays, (p) => p.plan),
        funnel: { signups: curSign.length, active: curSign.filter((u) => aCur.has(u.id)).length, paid: curSign.filter((u) => payers.has(u.id)).length },
        expiring: { n: expiringAll.length, list: expiringAll.slice(0, 8).map((u) => ({ id: u.id, login: u.login, plan: u.plan, until: u.until })) },
        models: modelUse.map((r) => ({ id: r.model, name: names.get(r.model) || r.model, n: r.n, ok: pct(r.ok, r.n) })),
        recentPays: pays.slice(-6).reverse().map((p) => ({ id: p.id, login: p.login, uid: p.uid, plan: p.plan, amount: p.amount, at: payAt(p), provider: p.provider || 'platega' })),
        recentUsers: users.slice(-6).reverse().map((u) => ({ id: u.id, login: u.login, email: u.email || '', created: u.created, plan: bill.planOf(u).id })),
      };
    });
  }

  /* ---------- пользователи с агрегатами (для списка, фильтров и сортировки) ---------- */
  function userRows() {
    return cached('urows', 15e3, () => {
      bill.flush();
      const now = Date.now(), today = usageOf(bill.today());
      const spent = new Map(all("SELECT uid, count(*) n, sum(json_extract(data, '$.amount')) s, max(at) last FROM payments WHERE status = 'CONFIRMED' GROUP BY uid").map((r) => [r.uid, r]));
      const keys = new Map(all('SELECT uid, count(*) n FROM api_tokens GROUP BY uid').map((r) => [r.uid, r.n]));
      const seen = new Map(all('SELECT uid, max(at) at FROM chats GROUP BY uid').map((r) => [r.uid, r.at]));
      for (const r of all('SELECT uid, max(at) at FROM api_log GROUP BY uid')) if (!(seen.get(r.uid) >= r.at)) seen.set(r.uid, r.at);
      const sess = new Map(all('SELECT uid, count(*) n FROM sessions WHERE exp >= ? GROUP BY uid', now).map((r) => [r.uid, r.n]));
      return store.users.all().map((u) => {
        const pl = bill.planOf(u), lim = bill.limitOf(pl, 'm'), used = Number(((today[u.id] || {}).m || 0).toFixed(1)), sp = spent.get(u.id);
        const active = !!(u.plan && u.until > now);
        return {
          id: u.id, login: u.login, name: u.name || '', email: u.email || '', google: !!u.google, github: !!u.github,
          created: u.created || null, createdAt: createdAt(u), plan: pl.id, planName: pl.name, until: active ? u.until : null,
          expired: !!(u.plan && u.plan !== 'free' && u.until && u.until <= now), trial: !!(u.trial && active), banned: !!u.banned,
          used, msgLimit: lim == null ? null : lim, msgLeft: lim == null ? null : Number(Math.max(0, lim - used).toFixed(1)),
          ext: u.msgExt && u.msgExt.until > now ? { limit: Math.floor(Number(u.msgExt.limit)) || 0, until: u.msgExt.until } : null,
          spent: sp ? sp.s || 0 : 0, pays: sp ? sp.n : 0, keys: keys.get(u.id) || 0, seen: seen.get(u.id) || null, sessions: sess.get(u.id) || 0,
          tags: Array.isArray(u.tags) ? u.tags : [], note: !!u.adminNote,
        };
      });
    });
  }
  const STATUS = {
    paid: (r, now) => r.plan !== 'free' && !r.trial, trial: (r) => r.trial, free: (r) => r.plan === 'free', banned: (r) => r.banned,
    expiring: (r, now) => r.plan !== 'free' && !r.trial && r.until && r.until < now + 3 * DAY, expired: (r) => r.expired && r.plan === 'free',
    active7: (r, now) => r.seen > now - 7 * DAY, inactive30: (r, now) => !(r.seen > now - 30 * DAY), new7: (r, now) => r.createdAt > now - 7 * DAY,
    api: (r) => r.keys > 0, ext: (r) => !!r.ext, payers: (r) => r.pays > 0, noted: (r) => r.note || r.tags.length > 0,
  };
  const SORT = { created: (r) => r.createdAt, login: (r) => r.login.toLowerCase(), until: (r) => r.until || 0, spent: (r) => r.spent, seen: (r) => r.seen || 0, used: (r) => r.used, plan: (r) => r.plan };
  function queryUsers(p = {}) {
    const now = Date.now(), text = String(p.q || '').trim().toLowerCase();
    let rows = userRows();
    const facets = { all: rows.length };
    for (const [k, f] of Object.entries(STATUS)) facets[k] = rows.filter((r) => f(r, now)).length;
    const plans = {}; for (const r of rows) plans[r.plan] = (plans[r.plan] || 0) + 1;
    if (text) rows = rows.filter((r) => r.id === text || r.login.toLowerCase().includes(text) || r.email.includes(text) || r.name.toLowerCase().includes(text) || r.tags.some((t) => t.toLowerCase().includes(text)));
    if (p.plan) rows = rows.filter((r) => r.plan === p.plan);
    if (p.status && STATUS[p.status]) rows = rows.filter((r) => STATUS[p.status](r, now));
    if (p.via) rows = rows.filter((r) => (p.via === 'google' ? r.google : p.via === 'github' ? r.github : !r.google && !r.github));
    if (p.tag) rows = rows.filter((r) => r.tags.includes(p.tag));
    const key = SORT[p.sort] || SORT.created, dir = p.dir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
    const size = Math.min(500, Math.max(10, +p.size || 50)), pages = Math.max(1, Math.ceil(rows.length / size)), page = Math.min(pages, Math.max(1, +p.page || 1));
    const tags = [...new Set(userRows().flatMap((r) => r.tags))].sort();
    return { items: p.all ? rows : rows.slice((page - 1) * size, page * size), total: rows.length, page, size, pages, facets, plans, tags };
  }

  /* ---------- карточка пользователя: расход по дням ---------- */
  function userUsage(uid, n = 30) {
    bill.flush();
    return days(n).map((d) => ({ d, ...{ m: 0, c: 0, s: 0, i: 0, v: 0 }, ...(usageOf(d)[uid] || {}) })).map((x) => ({ ...x, m: Number((x.m || 0).toFixed(1)) }));
  }

  /* ---------- здоровье моделей ---------- */
  function modelHealth(hours) {
    hours = [6, 24, 72, 168].includes(hours) ? hours : 24;
    const now = Date.now(), since = now - hours * 3600e3, B = 48, step = (hours * 3600e3) / B;
    const by = new Map();
    for (const r of all('SELECT model, kind, ok, ms, first, err, at FROM modelstats WHERE at > ? ORDER BY at', since)) { const e = by.get(r.model) || { p: [], c: [] }; by.set(r.model, e); (r.kind === 'probe' ? e.p : e.c).push(r); }
    const list = loadModels().map((m) => {
      const e = by.get(m.id) || { p: [], c: [] }, okc = e.c.filter((x) => x.ok), lp = e.p[e.p.length - 1];
      const lat = okc.map((x) => x.ms).filter((x) => x > 0), first = okc.map((x) => x.first).filter((x) => x > 0);
      const errs = new Map(); for (const x of [...e.c, ...e.p]) if (!x.ok) { const k = String(x.err || 'ошибка').slice(0, 140); errs.set(k, (errs.get(k) || 0) + 1); }
      const tl = Array.from({ length: B }, () => ({ n: 0, f: 0 }));
      for (const x of [...e.c, ...e.p]) { const i = Math.min(B - 1, Math.max(0, Math.floor((x.at - since) / step))); tl[i].n++; if (!x.ok) tl[i].f++; }
      return {
        id: m.id, name: m.name, modelId: m.modelId, host: (() => { try { return new URL(m.baseUrl).hostname; } catch { return ''; } })(),
        chats: { n: e.c.length, ok: okc.length, pct: pct(okc.length, e.c.length), p50: quant(lat, 0.5), p95: quant(lat, 0.95), first50: quant(first, 0.5), first95: quant(first, 0.95) },
        probes: { n: e.p.length, ok: e.p.filter((x) => x.ok).length, pct: pct(e.p.filter((x) => x.ok).length, e.p.length), last: lp ? { ok: !!lp.ok, ms: lp.ms, at: lp.at, err: lp.err } : null },
        errors: [...errs].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([err, n]) => ({ err, n })), timeline: tl,
      };
    });
    return { hours, step, since, models: list };
  }
  const modelsDown = () => {
    const last = new Map(all("SELECT model, ok, at FROM modelstats WHERE kind = 'probe' AND at > ? ORDER BY at", Date.now() - 6 * 3600e3).map((r) => [r.model, r]));
    return loadModels().filter((m) => last.get(m.id) && !last.get(m.id).ok).map((m) => ({ id: m.id, name: m.name }));
  };

  /* ---------- API ---------- */
  function apiStats(n) {
    n = [1, 7, 30].includes(n) ? n : 7;
    const now = Date.now(), since = n === 1 ? dayStart(dayOf(now)) : dayStart(days(n)[0]);
    const ERR = "(status >= 400 OR (err IS NOT NULL AND err != ''))";
    const t = one(`SELECT count(*) req, sum(${ERR}) errs, sum(cost) cost, sum(in_tok) tin, sum(out_tok) tout, count(DISTINCT uid) users, avg(ms) ms, avg(ttft) ttft FROM api_log WHERE at >= ?`, since);
    const ser = new Map(days(n).map((d) => [d, { d, n: 0, e: 0 }]));
    for (const r of all(`SELECT CAST((at + ?) / 86400000 AS INTEGER) dn, count(*) n, sum(${ERR}) e FROM api_log WHERE at >= ? GROUP BY dn`, MSK, since)) { const s = ser.get(dnDay(r.dn)); if (s) { s.n = r.n; s.e = r.e || 0; } }
    const hours = n === 1 ? (() => { const h = Array.from({ length: 24 }, (_, i) => ({ h: i, n: 0, e: 0 })); for (const r of all(`SELECT CAST(((at + ?) % 86400000) / 3600000 AS INTEGER) hr, count(*) n, sum(${ERR}) e FROM api_log WHERE at >= ? GROUP BY hr`, MSK, since)) { h[r.hr].n = r.n; h[r.hr].e = r.e || 0; } return h; })() : null;
    return {
      days: n, since,
      total: { req: t.req || 0, errs: t.errs || 0, cost: Math.round((t.cost || 0) * 10) / 10, tin: t.tin || 0, tout: t.tout || 0, users: t.users || 0, ms: Math.round(t.ms || 0), ttft: Math.round(t.ttft || 0) },
      keys: { total: one('SELECT count(*) n FROM api_tokens').n || 0, active: one('SELECT count(*) n FROM api_tokens WHERE last_used >= ?', since).n || 0 },
      series: [...ser.values()], hours,
      byModel: all(`SELECT model, count(*) n, sum(cost) cost, sum(${ERR}) e, avg(ms) ms, sum(in_tok) tin, sum(out_tok) tout FROM api_log WHERE at >= ? GROUP BY model ORDER BY n DESC LIMIT 20`, since).map((r) => ({ ...r, cost: Math.round((r.cost || 0) * 10) / 10, ms: Math.round(r.ms || 0) })),
      byClient: all("SELECT coalesce(client, '—') client, count(*) n FROM api_log WHERE at >= ? GROUP BY 1 ORDER BY n DESC LIMIT 12", since),
      top: all('SELECT uid, count(*) n, sum(cost) cost, max(at) last FROM api_log WHERE at >= ? GROUP BY uid ORDER BY n DESC LIMIT 15', since).map((r) => ({ ...r, login: loginOf(r.uid), cost: Math.round((r.cost || 0) * 10) / 10 })),
      errors: all(`SELECT at, uid, model, status, err, client FROM api_log WHERE at >= ? AND ${ERR} ORDER BY at DESC LIMIT 30`, since).map((r) => ({ ...r, login: loginOf(r.uid) })),
    };
  }
  function apiKeys({ q: text = '', page = 1, size = 50 } = {}) {
    const rows = all('SELECT id, uid, name, hint, created, expires, last_used, last_ip, last_client, models, ips FROM api_tokens ORDER BY coalesce(last_used, created) DESC');
    const today = new Map(all('SELECT key_id, count(*) n FROM api_log WHERE at >= ? GROUP BY key_id', dayStart(dayOf(Date.now()))).map((r) => [r.key_id, r.n]));
    let items = rows.map((r) => ({ ...r, login: loginOf(r.uid), today: today.get(r.id) || 0, models: r.models ? JSON.parse(r.models) : null, ips: r.ips ? JSON.parse(r.ips) : null }));
    const s = String(text).trim().toLowerCase();
    if (s) items = items.filter((r) => [r.name, r.hint, r.login, r.uid, r.last_ip, r.last_client].some((x) => String(x || '').toLowerCase().includes(s)));
    return { items: items.slice((page - 1) * size, page * size), total: items.length, page, size };
  }

  /* ---------- рефералы ---------- */
  function referralStats() {
    const t = one("SELECT count(*) total, sum(status = 'active') active, sum(status = 'pending') pending, sum(status = 'rejected') rejected, sum(paid) paid FROM referrals");
    const top = all("SELECT ref, count(*) n, sum(status = 'active') active, sum(status = 'pending') pending, sum(paid) paid, max(at) last FROM referrals GROUP BY ref ORDER BY active DESC, n DESC LIMIT 15").map((r) => ({ ...r, login: loginOf(r.ref) }));
    const dup = (col) => all(`SELECT ${col} v, count(*) n, count(DISTINCT ref) refs, group_concat(DISTINCT ref) inviters, max(at) last FROM referrals WHERE ${col} != '' GROUP BY ${col} HAVING n > 1 ORDER BY n DESC LIMIT 15`)
      .map((r) => ({ ...r, inviters: String(r.inviters || '').split(',').slice(0, 5).map((id) => ({ id, login: loginOf(id) })) }));
    // приглашавшие, у которых почти никто не стал активным, — частый признак накрутки
    const idle = all("SELECT ref, count(*) n, sum(status = 'active') active FROM referrals GROUP BY ref HAVING n >= 5 AND active * 5 < n ORDER BY n DESC LIMIT 10").map((r) => ({ ...r, login: loginOf(r.ref) }));
    const ser = new Map(days(30).map((d) => [d, { d, n: 0, active: 0 }]));
    for (const r of all("SELECT CAST((at + ?) / 86400000 AS INTEGER) dn, count(*) n, sum(status = 'active') active FROM referrals WHERE at >= ? GROUP BY dn", MSK, dayStart(days(30)[0]))) { const s = ser.get(dnDay(r.dn)); if (s) { s.n = r.n; s.active = r.active || 0; } }
    return { total: t.total || 0, active: t.active || 0, pending: t.pending || 0, rejected: t.rejected || 0, paid: t.paid || 0,
      convActive: pct(t.active || 0, t.total || 0), convPaid: pct(t.paid || 0, t.total || 0), top, dupIp: dup('ip'), dupFp: dup('fp'), idle, series: [...ser.values()] };
  }
  function referralList({ status, q: text = '', ref, page = 1, size = 50 } = {}) {
    const w = [], a = [];
    if (status) { w.push('status = ?'); a.push(status); }
    if (ref) { w.push('ref = ?'); a.push(ref); }
    let rows = all(`SELECT * FROM referrals ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY at DESC`, ...a)
      .map((r) => ({ ...r, login: loginOf(r.id), refLogin: loginOf(r.ref) }));
    const s = String(text).trim().toLowerCase();
    if (s) rows = rows.filter((r) => [r.id, r.ref, r.login, r.refLogin, r.ip].some((x) => String(x || '').toLowerCase().includes(s)));
    const ipN = new Map(), fpN = new Map();
    for (const r of all("SELECT ip, fp FROM referrals")) { if (r.ip) ipN.set(r.ip, (ipN.get(r.ip) || 0) + 1); if (r.fp) fpN.set(r.fp, (fpN.get(r.fp) || 0) + 1); }
    const items = rows.slice((page - 1) * size, page * size).map((r) => ({ ...r, dupIp: (ipN.get(r.ip) || 0) > 1, dupFp: (fpN.get(r.fp) || 0) > 1, fp: r.fp ? r.fp.slice(0, 10) : '' }));
    return { items, total: rows.length, page, size };
  }

  return { dashboard, userRows, queryUsers, userUsage, modelHealth, modelsDown, apiStats, apiKeys, referralStats, referralList, invalidate: () => cache.clear(), dayOf, payAt };
}

module.exports = { createStats, dayOf };
