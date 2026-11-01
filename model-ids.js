'use strict';
// Public API identity is separate from internal chat IDs and provider modelId.
const valid = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,95}$/.test(value);
const publicId = model => model.apiId || model.id;
function slug(name) {
  const ru = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
  return String(name || '').toLowerCase().replace(/[а-яё]/g, c => ru[c]).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9.]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 80).replace(/[.-]+$/g, '') || 'model';
}
function ensureApiIds(models) {
  // Reserve all internal IDs first so a new alias can never shadow a legacy ID.
  const internal = new Map(models.map(m => [m.id, m]));
  const claimed = new Set(); let changed = false;
  for (const m of models) {
    if (valid(m.apiId) && !claimed.has(m.apiId) && (!internal.has(m.apiId) || internal.get(m.apiId) === m)) claimed.add(m.apiId);
    else if (m.apiId !== undefined) { delete m.apiId; changed = true; }
  }
  const reserved = new Set([...internal.keys(), ...claimed, ...models.flatMap(m => Array.isArray(m.apiAliases) ? m.apiAliases.filter(valid) : [])]);
  for (const m of models) {
    if (m.apiId) continue;
    // Keep previously configured human-readable IDs. Generated 12-hex IDs get slugs.
    const base = valid(m.id) && !/^[a-f0-9]{12}$/i.test(m.id) ? m.id : slug(m.name);
    let candidate = base, n = 2;
    while (reserved.has(candidate) && !(candidate === m.id && !claimed.has(candidate))) candidate = base + '-' + n++;
    m.apiId = candidate; reserved.add(candidate); claimed.add(candidate); changed = true;
  }
  return changed;
}
const findModel = (models, id) => models.find(m => m.id === id) || models.find(m => publicId(m) === id) || models.find(m => Array.isArray(m.apiAliases) && m.apiAliases.includes(id));
function setApiId(models, model, value, { allowAuto = false } = {}) {
  if (typeof value !== 'string') throw Object.assign(new Error('Публичный Model ID должен быть строкой.'), { status:400 });
  const id = value.trim();
  if (!id && allowAuto) return;
  if (!valid(id)) throw Object.assign(new Error('Публичный Model ID: 1–96 символов. Строчные латинские буквы, цифры, точка, дефис и подчёркивание. Первый символ — буква или цифра.'), { status:400 });
  if (models.some(m => m.id !== model.id && (m.id === id || publicId(m) === id || (Array.isArray(m.apiAliases) && m.apiAliases.includes(id)))))
    throw Object.assign(new Error('Этот Model ID уже занят другой моделью или её прежним ID. Выберите другой.'), { status:409 });
  const previous = publicId(model);
  const aliases = new Set(Array.isArray(model.apiAliases) ? model.apiAliases.filter(valid) : []);
  if (previous && previous !== id && previous !== model.id) aliases.add(previous);
  aliases.delete(id); aliases.delete(model.id);
  model.apiId = id;
  if (aliases.size) model.apiAliases = [...aliases]; else delete model.apiAliases;
}
module.exports = { publicId, slug, ensureApiIds, findModel, setApiId };
