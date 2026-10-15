import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { AccessError, assertSameOrigin, createSession, ownerViewer, requireViewer, sessionCookie, sha256, verifyAccessKey, verifyTelegramInitData, viewerForToken } from '../src/lib/auth';
import { apiError, authorizeChat, authorizeMaterial, publicMaterial } from '../src/lib/api';
import { addFeedbackMessage, closeDB, createChat, createFeedback, createMaterial, findDuplicate, findSimilarMaterials, getChat, getDB, getFeedback, getMaterial, getMaterialFile, getMaterialVersion, getSettings, listMessages, listSubjects, privatePath, replaceMaterialWithUpload, saveMessage, saveSettings, setFeedbackStatus, setMaterialStatus, updateMaterialExtraction } from '../src/lib/db';
import { detectUploadType, parseBoundedFormData, safeFilename, savePrivateUpload } from '../src/lib/files';
import { POST as createFeedbackRoute } from '../src/app/api/feedback/route';
import { GET as sessionRoute } from '../src/app/api/session/route';
import { POST as recheckRoute } from '../src/app/api/materials/[id]/recheck/route';
import { PATCH as patchMaterialRoute } from '../src/app/api/materials/[id]/route';

let directory = '';
beforeEach(async () => { closeDB(); directory = await mkdtemp(join(tmpdir(), 'otmetki-backend-')); process.env.PREVIEW_DATA_DIR = directory; process.env.PREVIEW_ACCESS_KEY = 'test-preview-access-key-at-least-24-characters'; delete process.env.PREVIEW_ORIGIN; delete process.env.PREVIEW_PUBLIC_ORIGIN; });
afterEach(async () => { closeDB(); await rm(directory, { recursive: true, force: true }); });
const subjectId = 'management-math';
const ownerId = 'preview-owner';
function material(owner = ownerId, subject = subjectId) { return createMaterial(owner, { title: 'Тестовая лекция', subjectId: subject, kind: 'lecture', mimeType: 'text/plain', status: 'ready', hash: 'sha-of-test-file', blocks: [{ id: 'b1', kind: 'text', text: 'x ≠ 0; значение равно 14.', page: 1, imageFile: 'images/private-scan.png' }] }); }
function signedTelegram(userId: number, issued = 1_000_000, signature?: string) {
  const fields: Record<string, string> = { auth_date: String(issued), query_id: 'test-query', user: JSON.stringify({ id: userId, first_name: 'Владелец', last_name: 'Предпросмотр' }) };
  if (signature) fields.signature = signature;
  const secret = createHmac('sha256', 'WebAppData').update('test-bot-token').digest();
  const check = Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join('\n');
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
test('owner access fails closed, validates key, stores only hashed expiring session tokens', () => {
  assert.throws(() => requireViewer(new Request('http://localhost/api/materials')), AccessError);
  assert.equal(verifyAccessKey('wrong'), false); assert.equal(verifyAccessKey(process.env.PREVIEW_ACCESS_KEY!), true);
  const token = createSession(), request = new Request('http://localhost/api/session', { headers: { cookie: `otmetki_preview=${token}` } });
  assert.equal(requireViewer(request).role, 'owner');
  const stored = getDB().prepare('SELECT * FROM sessions').get() as Record<string, unknown>;
  assert.equal(stored.token_hash, sha256(token)); assert.ok(!JSON.stringify(stored).includes(token));
  assert.match(sessionCookie(token, request), /HttpOnly; SameSite=Strict/);
  getDB().prepare('UPDATE sessions SET expires_at=0').run(); assert.equal(viewerForToken(token), null);
});
test('Telegram validates HMAC, actual numeric identity, expiry, duplicate fields, and newer signature field', () => {
  assert.deepEqual(verifyTelegramInitData(signedTelegram(777), 'test-bot-token', ['777'], 1_000_000), { id: '777' });
  assert.deepEqual(verifyTelegramInitData(signedTelegram(777, 1_000_000, 'signed-third-party-value'), 'test-bot-token', ['777'], 1_000_000), { id: '777' });
  assert.equal(verifyTelegramInitData(signedTelegram(999), 'test-bot-token', ['777'], 1_000_000), null);
  assert.equal(verifyTelegramInitData(signedTelegram(777), 'wrong-token', ['777'], 1_000_000), null);
  assert.equal(verifyTelegramInitData(signedTelegram(777), 'test-bot-token', [], 1_000_000), null);
  assert.equal(verifyTelegramInitData(signedTelegram(777) + '&auth_date=1000000', 'test-bot-token', ['777'], 1_000_000), null);
  assert.equal(verifyTelegramInitData(signedTelegram(777, 999_699), 'test-bot-token', ['777'], 1_000_000), null);
  assert.equal(verifyTelegramInitData(signedTelegram(777, 1_000_031), 'test-bot-token', ['777'], 1_000_000), null);
  const tampered = signedTelegram(777).replace('777', '888'); assert.equal(verifyTelegramInitData(tampered, 'test-bot-token', ['888'], 1_000_000), null);
});
test('write actions reject absent/cross-site origins and accept same origin', () => {
  assert.throws(() => assertSameOrigin(new Request('http://localhost/api/auth', { method: 'POST' })), AccessError);
  assert.throws(() => assertSameOrigin(new Request('http://localhost/api/auth', { method: 'POST', headers: { origin: 'https://attacker.example' } })), AccessError);
  assert.doesNotThrow(() => assertSameOrigin(new Request('http://localhost/api/auth', { method: 'POST', headers: { origin: 'http://localhost' } })));
});
test('separated catalogs and owner scope prevent material, duplicate and sourceversion leaks', async () => {
  const subjects = listSubjects(); assert.ok(subjects.some(s => s.direction === 'economics' && s.group === 'E104')); assert.ok(subjects.some(s => s.direction === 'management' && s.group === 'M104'));
  const first = material(); assert.equal(getMaterial(first.id, 'other-person'), null); assert.equal(findDuplicate('other-person', first.hash), null); assert.throws(() => authorizeMaterial({ ...ownerViewer(), id: 'other-person' }, first.id), AccessError);
  const updated = updateMaterialExtraction(first.id, ownerId, { blocks: [{ ...first.blocks[0], text: 'Исправлено: x ≠ 14.' }], status: 'ready', warnings: [], pageCount: 1 }, 'manual_correction');
  assert.equal(updated.version, 2); assert.equal(getMaterialVersion(first.id, ownerId, 1)?.blocks[0].text, 'x ≠ 0; значение равно 14.'); assert.equal(getMaterialVersion(first.id, 'other-person', 1), null);
  assert.ok(!JSON.stringify(publicMaterial(updated)).includes('images/private-scan.png')); assert.match(publicMaterial(updated).blocks[0].imageFile!, /^\/api\/materials\//);
  assert.equal((await stat(directory)).mode & 0o777, 0o700); assert.equal((await stat(join(directory, 'preview.sqlite3'))).mode & 0o777, 0o600);
  assert.throws(() => privatePath('../secrets'), /Invalid private path/);
});
test('chat defaults are per profile but existing settings/context persist; foreign and wrong-course context rejected', () => {
  const source = material(); const first = createChat(ownerId, { subjectId }); assert.deepEqual(first.contextIds, [source.id]); assert.equal(first.model, 'gpt-6.1-sol');
  saveSettings(ownerId, { model: 'gpt-6-luna', effort: 'high' }); assert.equal(getSettings(ownerId).model, 'gpt-6-luna'); assert.equal(getChat(first.id, ownerId)?.model, 'gpt-6.1-sol'); assert.equal(createChat(ownerId, { subjectId }).model, 'gpt-6-luna');
  const foreign = material('someone-else'), otherSubject = material(ownerId, 'economics-math');
  assert.throws(() => createChat(ownerId, { subjectId, contextIds: [foreign.id] }), /Invalid context/); assert.throws(() => createChat(ownerId, { subjectId, contextIds: [otherSubject.id] }), /Invalid context/);
  assert.throws(() => authorizeChat({ ...ownerViewer(), id: 'someone-else' }, first.id), AccessError);
  const message = { id: 'msg-test', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'Начало ответа' }] };
  saveMessage(first.id, ownerId, message, 'streaming'); saveMessage(first.id, ownerId, { ...message, parts: [{ type: 'text', text: 'Сохранённый полный ответ' }] }, 'completed');
  assert.equal(listMessages(first.id, ownerId).length, 1); assert.equal(listMessages(first.id, 'someone-else').length, 0);
});
test('feedback attaches only explicitly selected text and preserves replies and statuses', () => {
  assert.throws(() => createFeedback(ownerId, { subject: 'Ошибка', message: 'Проверьте формулу', targetType: 'general', attachmentText: 'личная цитата' }), /consent/);
  const item = createFeedback(ownerId, { subject: 'Ошибка', message: 'Проверьте формулу', targetType: 'general', attachmentText: 'личная цитата', attachmentConsent: true });
  addFeedbackMessage(item.id, ownerId, 'Уточнение'); setFeedbackStatus(item.id, ownerId, 'in_progress');
  assert.equal(getFeedback(item.id, ownerId)?.status, 'in_progress'); assert.equal(getFeedback(item.id, ownerId)?.messages[0].text, 'Уточнение'); assert.equal(getFeedback(item.id, 'someone-else'), null);
});
test('feedback API requires explicit attachment consent and authenticated session responses contain no secrets', async () => {
  const token = createSession(), headers = { origin: 'http://localhost', cookie: `otmetki_preview=${token}`, 'content-type': 'application/json' };
  const denied = await createFeedbackRoute(new Request('http://localhost/api/feedback', { method: 'POST', headers, body: JSON.stringify({ subject: 'Ошибка', message: 'Проверьте', attachmentText: 'Только выбранный текст' }) })); assert.equal(denied.status, 400);
  const accepted = await createFeedbackRoute(new Request('http://localhost/api/feedback', { method: 'POST', headers, body: JSON.stringify({ subject: 'Ошибка', message: 'Проверьте', attachmentText: 'Только выбранный текст', attachmentConsent: true }) })); assert.equal(accepted.status, 201);
  const session = await sessionRoute(new Request('http://localhost/api/session', { headers })); const text = await session.text(); assert.ok(!text.includes(process.env.PREVIEW_ACCESS_KEY!)); assert.ok(!text.includes('BASE_URL')); assert.ok(!text.includes('API_KEY'));
  const failure = await apiError(new Error('secret-token http://private-provider.example/v1')).text(); assert.ok(!failure.includes('secret-token')); assert.ok(!failure.includes('private-provider'));
});
test('upload validates actual signatures, utf8, archive structure, names and actual request size', async () => {
  assert.equal(detectUploadType('lecture.txt', Buffer.from('Лекция: x ≠ 0')), 'text/plain');
  assert.throws(() => detectUploadType('fake.pdf', Buffer.from('not a PDF'))); assert.throws(() => detectUploadType('fake.docx', Buffer.from('PKxx'))); assert.throws(() => detectUploadType('code.txt', Buffer.from([0xff, 0])), /format|формат/);
  assert.equal(safeFilename('../../private/key.txt'), 'key.txt'); assert.equal(safeFilename('a\\b\\lecture.pdf'), 'lecture.pdf');
  const file = await savePrivateUpload(new File(['Лекция без дублей'], '../../notes.txt', { type: 'image/png' })); assert.equal(file.mimeType, 'text/plain'); assert.equal((await stat(privatePath(file.filePath))).mode & 0o777, 0o600); assert.equal((await readFile(privatePath(file.filePath))).toString('utf8'), 'Лекция без дублей');
  const request = new Request('http://localhost/api/materials', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: new Uint8Array(100) }); await assert.rejects(() => parseBoundedFormData(request, 50), AccessError);
});
test('replacement preserves stable context ID, metadata, original files and immutable prior version', async () => {
  const firstFile = await savePrivateUpload(new File(['Первое условие: x = 14.'], 'first.txt'));
  const secondFile = await savePrivateUpload(new File(['Исправление: x ≠ 14.'], 'second.txt'));
  const first = createMaterial(ownerId, { ...firstFile, title: 'Имя и тема остаются', topic: 'Семинар 3', kind: 'seminar', subjectId, status: 'ready', blocks: [{ id: 'before', text: 'Первое условие: x = 14.', kind: 'formula' }] });
  const candidate = createMaterial(ownerId, { ...secondFile, title: 'Новая загрузка', kind: 'lecture', subjectId, status: 'ready', blocks: [{ id: 'after', text: 'Исправление: x ≠ 14.', kind: 'formula' }] });
  const chat = createChat(ownerId, { subjectId, contextIds: [first.id] });
  const result = replaceMaterialWithUpload(first.id, ownerId, candidate.id, 1);
  assert.equal(result.material.id, first.id); assert.equal(result.material.title, first.title); assert.equal(result.material.topic, first.topic); assert.equal(result.material.kind, first.kind); assert.equal(result.material.version, 2); assert.equal(result.material.blocks[0].text, 'Исправление: x ≠ 14.');
  assert.deepEqual(getChat(chat.id, ownerId)?.contextIds, [first.id]); assert.equal(result.candidateArchived, true); assert.equal(getMaterial(candidate.id, ownerId), null);
  assert.equal(getMaterialVersion(first.id, ownerId, 1)?.blocks[0].text, 'Первое условие: x = 14.');
  assert.equal((await readFile(getMaterialFile(first.id, ownerId, 1)!.path)).toString(), 'Первое условие: x = 14.');
  assert.equal((await readFile(getMaterialFile(first.id, ownerId, 2)!.path)).toString(), 'Исправление: x ≠ 14.');
});
test('replacement rejects stale versions, foreign subjects/owners and in-flight jobs without mutation', async () => {
  const file = await savePrivateUpload(new File(['Проверка исходника'], 'source.txt'));
  const first = createMaterial(ownerId, { ...file, title: 'Первая', kind: 'lecture', subjectId, status: 'ready' });
  const valid = createMaterial(ownerId, { ...file, title: 'Вторая', kind: 'lecture', subjectId, status: 'ready' });
  const foreign = createMaterial('other-owner', { ...file, title: 'Чужая', kind: 'lecture', subjectId, status: 'ready' });
  const otherSubject = createMaterial(ownerId, { ...file, title: 'Другой предмет', kind: 'lecture', subjectId: 'economics-math', status: 'ready' });
  const queued = createMaterial(ownerId, { ...file, title: 'В очереди', kind: 'lecture', subjectId });
  assert.throws(() => replaceMaterialWithUpload(first.id, ownerId, valid.id, 2), /Version conflict/);
  assert.throws(() => replaceMaterialWithUpload(first.id, ownerId, foreign.id, 1), /Material not found/);
  assert.throws(() => replaceMaterialWithUpload(first.id, ownerId, otherSubject.id, 1), /Invalid replacement/);
  assert.throws(() => replaceMaterialWithUpload(first.id, ownerId, queued.id, 1), /Material busy/);
  setMaterialStatus(first.id, ownerId, 'extracting');
  assert.throws(() => replaceMaterialWithUpload(first.id, ownerId, valid.id, 1), /Material busy/);
  setMaterialStatus(first.id, ownerId, 'ready');
  assert.equal(getMaterial(first.id, ownerId)?.version, 1); assert.ok(getMaterial(valid.id, ownerId));
  createChat(ownerId, { subjectId, contextIds: [valid.id] });
  assert.equal(replaceMaterialWithUpload(first.id, ownerId, valid.id, 1).candidateArchived, false); assert.ok(getMaterial(valid.id, ownerId));
});
test('similarity is literal and scoped: changed mathematical signs/numbers are preserved and never merged', () => {
  const definition = 'Производная функции показывает скорость изменения её значения в данной точке.';
  const condition = 'Условие решения необходимо сохранить полностью: значение x должно быть равно 14, при этом y ≠ 0.';
  const first = createMaterial(ownerId, { title: 'Первая лекция', kind: 'lecture', subjectId, mimeType: 'text/plain', status: 'ready', hash: 'first', blocks: [{ id: 'definition', text: definition, kind: 'text' }, { id: 'condition', text: condition, kind: 'formula' }] });
  const similar = createMaterial(ownerId, { title: 'Вторая лекция', kind: 'lecture', subjectId, mimeType: 'text/plain', status: 'ready', hash: 'second', blocks: [{ id: 'definition', text: definition.replaceAll(' ', '\n'), kind: 'text' }, { id: 'condition', text: condition.replace('14', '15').replace('≠', '='), kind: 'formula' }] });
  createMaterial('other-owner', { title: 'Чужой файл', kind: 'lecture', subjectId, mimeType: 'text/plain', status: 'ready', hash: 'third', blocks: first.blocks });
  createMaterial(ownerId, { title: 'Другой предмет', kind: 'lecture', subjectId: 'economics-math', mimeType: 'text/plain', status: 'ready', hash: 'fourth', blocks: first.blocks });
  const matches = findSimilarMaterials(first.id, ownerId); assert.equal(matches.length, 1); assert.equal(matches[0].id, similar.id); assert.equal(matches[0].overlapBlocks, 1); assert.equal(matches[0].comparedBlocks, 2); assert.equal(matches[0].exactFileDuplicate, false);
  assert.equal(getMaterial(first.id, ownerId)?.blocks[1].text, condition); assert.ok(getMaterial(similar.id, ownerId)?.blocks[1].text.includes('15')); assert.equal(getMaterial(first.id, ownerId)?.version, 1);
});
test('stale recheck never queues AI; in-flight OCR blocks manual text edits but permits metadata', async () => {
  const current = material(), token = createSession();
  const request = (body: unknown, route: string) => new Request(`http://localhost/api/materials/${current.id}${route}`, { method: route ? 'POST' : 'PATCH', headers: { origin: 'http://localhost', cookie: `otmetki_preview=${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const context = { params: Promise.resolve({ id: current.id }) };
  const stale = await recheckRoute(request({ blockId: 'b1', effort: 'medium', version: 99 }, '/recheck'), context);
  assert.equal(stale.status, 409); assert.equal((getDB().prepare('SELECT COUNT(*) AS count FROM jobs').get() as { count: number }).count, 0); assert.equal(getMaterial(current.id, ownerId)?.version, 1);
  for (const status of ['queued', 'extracting'] as const) {
    setMaterialStatus(current.id, ownerId, status);
    const blocked = await patchMaterialRoute(request({ version: getMaterial(current.id, ownerId)!.version, blocks: [{ id: 'b1', text: 'Исправление ученика' }] }, ''), context);
    assert.equal(blocked.status, 409); assert.equal(getMaterial(current.id, ownerId)?.blocks[0].text, current.blocks[0].text);
  }
  const allowed = await patchMaterialRoute(request({ version: 1, title: 'Новое название во время OCR' }, ''), context); assert.equal(allowed.status, 200); assert.equal(getMaterial(current.id, ownerId)?.title, 'Новое название во время OCR'); assert.equal(getMaterial(current.id, ownerId)?.status, 'extracting');
  const staleEdit = await patchMaterialRoute(request({ version: 1, title: 'Устаревшая правка' }, ''), context); assert.equal(staleEdit.status, 409); assert.equal(getMaterial(current.id, ownerId)?.title, 'Новое название во время OCR');
});
test('delayed OCR result cannot overwrite a newer manual correction or create an extra revision/audit', () => {
  const initial = material();
  const manual = updateMaterialExtraction(initial.id, ownerId, { blocks: [{ ...initial.blocks[0], text: 'Ученик исправил: x ≠ 14; y = 2.' }], status: 'ready', warnings: [], pageCount: 1 }, 'manual_correction');
  const before = getDB().prepare('SELECT COUNT(*) AS count FROM audit').get() as { count: number };
  const stale = updateMaterialExtraction(initial.id, ownerId, { blocks: [{ ...initial.blocks[0], text: 'Задержанный OCR: x = 14; y = 1.' }], status: 'ready', warnings: [], pageCount: 1 }, 'retry', initial.version);
  assert.equal(stale, null); assert.equal(getMaterial(initial.id, ownerId)?.version, manual.version); assert.equal(getMaterial(initial.id, ownerId)?.blocks[0].text, 'Ученик исправил: x ≠ 14; y = 2.');
  assert.equal((getDB().prepare('SELECT COUNT(*) AS count FROM audit').get() as { count: number }).count, before.count);
  assert.equal((getDB().prepare('SELECT COUNT(*) AS count FROM material_versions WHERE material_id=?').get(initial.id) as { count: number }).count, 2);
  const accepted = updateMaterialExtraction(initial.id, ownerId, { blocks: manual.blocks, status: 'ready', warnings: ['Проверка актуальной версии'], pageCount: 1 }, 'recheck', manual.version);
  assert.equal(accepted?.version, 3);
});
