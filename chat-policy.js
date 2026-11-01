'use strict';
const { plain, detect } = require('./media');

const stripJournal = (text) => String(text || '')
  .replace(/^\(Журнал Premier[\s\S]*?Ассистент такие заметки не пишет\.\)\s*/, '').trim();
const CREATE = /(?:созда|сдела|напиши|напиш|разработ|собери|запили|реализ|передела|добав|исправ|почини|хочу|нужн|нарису|create|make|build|implement|fix|write)/i;
const WEB_ARTIFACT = /(?:игр[ауые]|игрушк|сайт|лендинг|веб[ -]?прилож|интерактив|three\.?js|webgl|первого лица|first[ -]person|\bgame\b|\bwebsite\b|\blanding\b)/i;
const FOLLOW_UP = /^(?:ну\s+(?:ч[её]|что)\s+там|где\s+(?:код|игра|сайт|результат)|продолж(?:и|ай)|давай|жду|доделай|не\s+работает|(?:а\s+)?теперь\s+|(?:ещ[её]|добавь|исправь|поменяй|убери|сделай|доработай|доработать|улучши|улучшить|измени|изменить|обнови|почини)(?:\s|$))/i;
const EDIT_REQUEST = /(?:доработ(?:ай|ать)|улучш(?:и|ить)|измен(?:и|ить)|обнов(?:и|ить)|исправ(?:ь|ить)|почини|поменяй|убери|добав(?:ь|ить)|отредактир|enhance\b|improve\b|modify\b|update\b|change\b|fix\b)/i;
const RECREATE = /(?:с\s+нуля|заново|нов(?:ая|ую|ый|ое)\s+(?:игр|сайт|сцен|поле|лендинг)|друг(?:ую|ой|ое)\s+(?:игр|сайт|сцен|поле)|from\s+scratch|start\s+over|new\s+(?:game|website|scene))/i;
const NEW_REQUEST = /^(?:пожалуйста[,\s]+)?(?:создай|создать|сделай|сделать|напиши|собери|create\b|build\b|make\b)/i;
const QUESTION = /^(?:почему|зачем|как\s+(?:работает|устроен|сделать)|что\s+такое|объясни|расскажи|why\b|explain\b)/i;
const NEGATED_IMAGE = /(?:не\s+(?:картинк|изображен|фото)|(?:а\s+)?не\s+(?:картинк|изображен)|вместо\s+картинк)/i;
const EXPLICIT_IMAGE = /(?:нарису|изобрази|созда|сдела|сгенерир|generate|draw|create|make)[\s\S]{0,100}(?:картинк|изображен|иллюстрац|скриншот|логотип|обложк|постер|\bimage\b|\bpicture\b|\billustration\b|\blogo\b)/i;
const EXPLICIT_VIDEO = /(?:созда|сдела|сгенерир|сним|generate|create|make)[\s\S]{0,80}(?:видео|ролик|\bvideo\b|\bclip\b)/i;
const NON_HTML = /(?:\bpython\b|питон|pygame|unity|unreal|\bgodot\b|роблокс|\broblox\b|презентац|excel|\.pptx\b|\.xlsx\b)/i;

function directIntent(text) {
  if (!text || QUESTION.test(text)) return 'general';
  const commandAt = text.search(CREATE);
  const requested = commandAt >= 0 ? text.slice(commandAt) : text;
  const webAt = requested.search(WEB_ARTIFACT);
  const imageAt = requested.search(/картинк|изображен|иллюстрац|скриншот|логотип|обложк|постер|\bimage\b|\bpicture\b|\billustration\b|\blogo\b/i);
  const videoAt = requested.search(/видео|ролик|\bvideo\b|\bclip\b/i);
  if (!NEGATED_IMAGE.test(text) && EXPLICIT_IMAGE.test(text) && (webAt < 0 || imageAt < webAt)) return 'image';
  if (EXPLICIT_VIDEO.test(text) && !/не\s+видео/i.test(text) && (webAt < 0 || videoAt < webAt)) return 'video';
  if (/(?:напиши|создай|сделай)\s+(?:мне\s+)?(?:функци|скрипт)/i.test(text)) return 'general';
  if (WEB_ARTIFACT.test(text) && !NON_HTML.test(text) &&
      (CREATE.test(text) || /(?:я\s+просил|именно|а\s+не\s+картинк)/i.test(text))) return 'artifact';
  return 'general';
}

// Короткие «ну че там» / правки наследуют задачу, но новый явный запрос заменяет её.
// Это ограниченная эвристика, не универсальный классификатор языка.
function intentOf(messages) {
  const users = messages.filter((m) => m?.role === 'user')
    .map((m) => stripJournal(plain(m.content))).slice(-12);
  const last = users.pop() || '';
  const direct = directIntent(last);
  if (direct !== 'general') return direct;
  if (NON_HTML.test(last) || /(?:напиши|создай|сделай)\s+(?:мне\s+)?(?:функци|скрипт)/i.test(last))
    return 'general';
  if (!QUESTION.test(last) && FOLLOW_UP.test(last)) {
    for (let i = users.length - 1; i >= 0; i--) {
      const prior = directIntent(users[i]);
      if (prior !== 'general') return prior;
      if (!FOLLOW_UP.test(users[i])) break; // Не наследуем старую задачу через смену темы.
    }
  }
  return 'general';
}
function taskOf(messages, base) {
  const users = messages.filter((m) => m?.role === 'user')
    .map((m) => stripJournal(plain(m.content)));
  const text = users.at(-1) || '';
  const intent = intentOf(messages);
  const mediaOrOther = intent === 'image' || intent === 'video' || QUESTION.test(text) ||
    NON_HTML.test(text) || /(?:напиши|создай|сделай)\s+(?:мне\s+)?(?:функци|скрипт)/i.test(text);
  if (mediaOrOther) return { intent, mode: null, needsBase: false };
  if (RECREATE.test(text) || (NEW_REQUEST.test(text) && WEB_ARTIFACT.test(text) && !EDIT_REQUEST.test(text)))
    return { intent: 'artifact', mode: 'create', needsBase: false };
  const asksEdit = EDIT_REQUEST.test(text) || FOLLOW_UP.test(text);
  // Короткий статус после нового незавершённого запроса не правит старую игру.
  if (base && asksEdit && !EDIT_REQUEST.test(text) && /^(?:ну\s|продолж|жду|давай)/i.test(text)) {
    const prior = users.slice(0, -1).reverse().find((u) => !FOLLOW_UP.test(u) || RECREATE.test(u));
    if (prior && RECREATE.test(prior)) return { intent: 'artifact', mode: 'create', needsBase: false };
  }
  if (asksEdit && (base || (EDIT_REQUEST.test(text) && (intent === 'artifact' || WEB_ARTIFACT.test(text)))))
    return { intent: 'artifact', mode: 'edit', needsBase: !base };
  return { intent, mode: intent === 'artifact' ? 'create' : null, needsBase: false };
}

function toolAllowed(name, intent) {
  return intent !== 'artifact' ||
    !['generate_image', 'generate_video', 'view_page', 'run_python'].includes(name);
}
function mediaWant(text, options, intent) {
  if (intent === 'artifact') return null;
  return intent === 'image' || intent === 'video' ? intent : detect(text, options);
}
function validateTool(name, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Аргументы инструмента должны быть JSON-объектом');
  if (name === 'fetch_page' || name === 'view_page') {
    if (typeof args.url !== 'string' || !args.url.trim()) throw new Error('Нужен полный URL страницы, например https://example.com/');
    let u; try { u = new URL(args.url); } catch { throw new Error('Некорректный URL страницы: нужен полный адрес http:// или https://'); }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password)
      throw new Error('Нужен URL http/https без логина и пароля');
    args = { ...args, url: u.href };
  }
  if (name === 'web_search' && (typeof args.query !== 'string' || !args.query.trim()))
    throw new Error('Нужен непустой поисковый запрос');
  return args;
}
function completeHtml(text) {
  const blocks = String(text || '').matchAll(/```([^\n]*)\n([\s\S]*?)```/g);
  for (const [, info, code] of blocks) {
    if ((/^html?(?:\s|:|$)/i.test(info.trim()) || /(?:^|[/:])[^/\s]+\.html?(?:\s|$)/i.test(info.trim()) || !info.trim()) &&
        /<(?:!doctype|html|body)\b/i.test(code) && /<\/html\s*>/i.test(code))
      return true;
  }
  return false;
}
const ARTIFACT_NOTE = `

РЕЖИМ ИНТЕРАКТИВНОГО HTML-РЕЗУЛЬТАТА.
Пользователь ждёт работающую браузерную игру/сайт/сцену, а не иллюстрацию и не описание плана.
Верни полный HTML-документ в закрытом блоке кода html (или полные HTML/CSS/JS-файлы, если просили проект).
Для игры от первого лица реализуй управление и интерактивность кодом. Не подменяй игру изображением или видео.
Не вызывай generate_image, generate_video, view_page или run_python: они не создают этот результат.
Если нужен поиск документации, используй web_search; fetch_page — только с настоящим полным URL.
Объяснение перед кодом — максимум одно короткое предложение. Не говори «готово/создал» без самого кода.
Если задача неясна или её нельзя выполнить, честно задай уточнение/объясни ограничение вместо обещания.`;
const REPAIR_NOTE = `В предыдущем ответе нет полного HTML-документа. Один раз заверши исходную задачу сейчас:
пришли готовую интерактивную игру/сайт полным HTML-документом в закрытом блоке html с </html>.
Не присылай картинку, видео, план, обещание или вызовы инструментов. CSS и JS внутри HTML;
если пользователь явно просил проект из файлов — верни полные файлы с путями.
Если выполнить нельзя, прямо скажи об этом; не утверждай, что результат готов.`;

function needsRepair(text) {
  // Не навязываем код после явного отказа или уточнения.
  return !completeHtml(text) && !/(?:не могу|не буду|нельзя выполнить|не удалось|уточни|уточните|какую именно|какой именно|could you clarify|cannot|can't)/i.test(text);
}
module.exports = { stripJournal, intentOf, taskOf, toolAllowed, mediaWant, validateTool, completeHtml, needsRepair, ARTIFACT_NOTE, REPAIR_NOTE };