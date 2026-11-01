'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const policy = require('../chat-policy');
const messages = (...texts) => texts.flatMap((content) => [{ role: 'user', content }, { role: 'assistant', content: 'Сделаю…' }]);

test('intent: игра/3D-сцена/сайт требуют HTML, в том числе запрос со скриншота', () => {
  for (const text of ['создай 3д поле от первого лица', 'сделай игру змейка', 'создай сайт для кафе', 'build a first-person game', 'создай игру с картинками'])
    assert.equal(policy.intentOf(messages(text)), 'artifact', text);
});
test('intent: короткие продолжения сохраняют задачу, исправление не превращается в картинку', () => {
  for (const text of ['ну че там', 'продолжи', 'доделай', 'сделай красный фон', 'я просил игру а не картинку'])
    assert.equal(policy.intentOf(messages('создай 3д поле от первого лица', text)), 'artifact', text);
  assert.equal(policy.intentOf(messages('сделай игру', 'ну че там', 'продолжи')), 'artifact');
});
test('intent: явно запрошенные изображения и видео не блокируются', () => {
  for (const text of ['нарисуй картинку поля', 'создай иллюстрацию игры', 'нарисуй скриншот игры'])
    assert.equal(policy.intentOf(messages('создай игру', text)), 'image', text);
  assert.equal(policy.intentOf(messages('создай игру', 'сделай видео игрового поля')), 'video');
});
test('intent: вопросы и не-HTML проекты не запускают принудительную генерацию сайта', () => {
  for (const text of ['почему игра не работает?', 'объясни код сайта', 'сделай игру на Python', 'создай игру на Unity', 'сколько будет два плюс два'])
    assert.equal(policy.intentOf(messages(text)), 'general', text);
  assert.equal(policy.intentOf(messages('создай игру', 'расскажи про космос', 'продолжи')), 'general');
  assert.equal(policy.intentOf(messages('создай игру', 'сделай игру на Python')), 'general');
  assert.equal(policy.intentOf(messages('создай игру', 'сделай функцию на JS')), 'general');
  assert.equal(policy.intentOf(messages('напиши функцию для игры')), 'general');
});
test('intent: журналы и вложенные картинки не заменяют пользовательскую задачу', () => {
  const content = [{ type: 'text', text: '(Журнал Premier — что на самом деле выполнили инструменты в прошлом ответе ассистента: нарисованы картинки. Ассистент такие заметки не пишет.)\n\nя просил игру а не картинку' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }];
  assert.equal(policy.intentOf([{ role: 'user', content }]), 'artifact');
});
test('policy: запрещённые для HTML инструменты и прямой media-роут не обходят режим', () => {
  for (const tool of ['generate_image', 'generate_video', 'view_page', 'run_python']) assert.equal(policy.toolAllowed(tool, 'artifact'), false);
  assert.equal(policy.toolAllowed('fetch_page', 'artifact'), true);
  assert.equal(policy.toolAllowed('generate_image', 'general'), true);
  assert.equal(policy.mediaWant('нарисуй игру', {}, 'artifact'), null);
  assert.equal(policy.mediaWant('нарисуй кота', {}, 'general'), 'image');
});
test('policy: неправильные аргументы инструментов дают понятную ошибку', () => {
  for (const args of [{}, { url: '' }, { url: 'example.com' }, { url: 'file:///etc/passwd' }, { url: 'https://user:pw@example.com' }, [], null])
    assert.throws(() => policy.validateTool('fetch_page', args));
  assert.equal(policy.validateTool('fetch_page', { url: 'https://example.com' }).url, 'https://example.com/');
  assert.throws(() => policy.validateTool('web_search', { query: '' }));
});
test('policy: обещание/обрезанный код не считается готовым HTML, отказ не повторяется', () => {
  for (const text of ['Сделаю сцену!', '```html\n<html><body>hello', '```html\n<html><body>hello\n```', '```js\nconsole.log("hello")\n```'])
    assert.equal(policy.completeHtml(text), false, text);
  assert.equal(policy.completeHtml('```html\n<!doctype html><html><body>hello</body></html>\n```'), true);
  assert.equal(policy.completeHtml('```html:game/index.html\n<html></html>\n```'), true);
  assert.equal(policy.needsRepair('Сделаю сцену!'), true);
  assert.equal(policy.needsRepair('Уточните, какую именно игру вы хотите?'), false);
  assert.equal(policy.needsRepair('Не могу выполнить эту задачу.'), false);
});