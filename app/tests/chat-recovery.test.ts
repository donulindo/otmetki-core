import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UIMessage } from 'ai';
import { closeDB, createChat, createMaterial, getChat, getDB, getMaterialVersion, listMessages, saveMessage, setChatGenerationState, updateMaterialExtraction } from '../src/lib/db';
import { recoverChatStates } from '../src/lib/chat-runtime';

const shared = globalThis as typeof globalThis & { __otmetkiChatRecovery?: boolean; __otmetkiChats?: Map<string, unknown> };
const controlledEnvironment = ['PREVIEW_DATA_DIR', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_KEY'] as const;
let directory = '', previousEnvironment: Record<string, string | undefined> = {};
beforeEach(async () => {
  closeDB(); shared.__otmetkiChatRecovery = false; shared.__otmetkiChats?.clear();
  previousEnvironment = Object.fromEntries(controlledEnvironment.map(key => [key, process.env[key]]));
  directory = await mkdtemp(join(tmpdir(), 'otmetki-chat-recovery-')); process.env.PREVIEW_DATA_DIR = directory;
  for (const key of controlledEnvironment.filter(key => key !== 'PREVIEW_DATA_DIR')) delete process.env[key];
});
afterEach(async () => {
  assert.equal(shared.__otmetkiChats?.size || 0, 0); shared.__otmetkiChatRecovery = false; shared.__otmetkiChats?.clear();
  closeDB(); await rm(directory, { recursive: true, force: true });
  for (const key of controlledEnvironment) { if (previousEnvironment[key] === undefined) delete process.env[key]; else process.env[key] = previousEnvironment[key]; }
});
test('restart preserves partial text and immutable source versions, marks interrupted answers as error, and never regenerates', () => {
  const ownerId = 'preview-owner', subjectId = 'management-math';
  const source = createMaterial(ownerId, { title: 'Лекция для ответа', subjectId, kind: 'lecture', filename: 'lecture.txt', mimeType: 'text/plain', status: 'ready', blocks: [{ id: 'b1', kind: 'formula', text: 'Условие исходника: x ≠ 14.' }] });
  const interrupted = createChat(ownerId, { subjectId, contextIds: [source.id] });
  const completed = createChat(ownerId, { subjectId, contextIds: [source.id] });
  const question: UIMessage = { id: 'question', role: 'user', parts: [{ type: 'text', text: 'Объясни условие.' }] };
  const partial: UIMessage = { id: 'partial', role: 'assistant', parts: [{ type: 'text', text: 'Из условия следует, что x не равно 14. Далее рассмотрим' }, { type: 'source-document', sourceId: source.id, mediaType: 'text/plain', title: 'Лекция для ответа · v1', filename: 'lecture.txt' }], metadata: { status: 'streaming', generationId: 'interrupted-generation', contextSources: [{ id: source.id, version: 1 }], model: 'gpt-6.1-sol', effort: 'medium' } };
  const finished: UIMessage = { id: 'completed-answer', role: 'assistant', parts: [{ type: 'text', text: 'Полный ответ остаётся без изменений.' }], metadata: { status: 'completed', contextSources: [{ id: source.id, version: 1 }] } };
  saveMessage(interrupted.id, ownerId, question); saveMessage(interrupted.id, ownerId, partial, 'streaming'); setChatGenerationState(interrupted.id, ownerId, 'streaming');
  saveMessage(completed.id, ownerId, finished, 'completed'); setChatGenerationState(completed.id, ownerId, 'completed');
  updateMaterialExtraction(source.id, ownerId, { blocks: [{ id: 'b1', kind: 'formula', text: 'Обновлённое условие: x ≠ 15.' }], status: 'ready', warnings: [], pageCount: 1 }, 'manual_correction');
  const count = (getDB().prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n;
  recoverChatStates(); recoverChatStates();
  assert.equal(getChat(interrupted.id, ownerId)?.generationState, 'error'); assert.equal(getChat(completed.id, ownerId)?.generationState, 'completed');
  const recovered = listMessages(interrupted.id, ownerId); assert.deepEqual(recovered[0], question); assert.deepEqual(recovered[1], { ...partial, metadata: { ...(partial.metadata as Record<string, unknown>), status: 'error' } });
  assert.deepEqual(listMessages(completed.id, ownerId), [finished]);
  assert.equal((getDB().prepare('SELECT status FROM messages WHERE chat_id=? AND id=?').get(interrupted.id, partial.id) as { status: string }).status, 'error');
  assert.equal(getMaterialVersion(source.id, ownerId, 1)?.blocks[0].text, 'Условие исходника: x ≠ 14.');
  assert.equal((getDB().prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n, count);
  assert.equal((getDB().prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n, 0); assert.equal(shared.__otmetkiChats?.size || 0, 0);
});
