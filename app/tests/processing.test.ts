import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { closeDB, createJob, createMaterial, getDB, getMaterial, hasPendingRecognition, updateJob, updateMaterial, updateMaterialExtraction } from '../src/lib/db';
import { savePrivateUpload } from '../src/lib/files';
import { recoverDocumentQueue } from '../src/lib/processing';
import type { TextBlock } from '../src/lib/types';

type TestQueue = { active: boolean; activeJobId?: string; tasks: unknown[]; recovered: boolean };
const queue = (globalThis as typeof globalThis & { __otmetkiDocuments: TestQueue }).__otmetkiDocuments;
const realSetTimeout = globalThis.setTimeout;
const timers = new Set<ReturnType<typeof setTimeout>>();
const controlledEnvironment = ['PREVIEW_DATA_DIR', 'DOCUMENT_PYTHON', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_KEY'] as const;
let previousEnvironment: Record<string, string | undefined> = {};
let directory = '';
beforeEach(async () => {
  closeDB(); assert.equal(queue.active, false);
  queue.tasks.length = 0; queue.recovered = false; queue.activeJobId = undefined;
  previousEnvironment = Object.fromEntries(controlledEnvironment.map(key => [key, process.env[key]]));
  directory = await mkdtemp(join(tmpdir(), 'otmetki-worker-'));
  process.env.PREVIEW_DATA_DIR = directory; process.env.DOCUMENT_PYTHON = resolve('.venv/bin/python');
  for (const key of ['OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_KEY']) delete process.env[key];
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, milliseconds?: number, ...args: unknown[]) => {
    const timer = realSetTimeout(callback, milliseconds, ...args); timers.add(timer); return timer;
  }) as typeof setTimeout;
});
async function idle() {
  const expires = Date.now() + 10_000;
  while (queue.active || queue.tasks.length) { if (Date.now() > expires) throw new Error('Offline worker did not finish within 10 seconds'); await new Promise<void>(resolve => realSetTimeout(resolve, 15)); }
}
afterEach(async () => {
  await idle();
  for (const timer of timers) clearTimeout(timer); timers.clear(); globalThis.setTimeout = realSetTimeout;
  queue.tasks.length = 0; queue.recovered = false; queue.activeJobId = undefined;
  closeDB(); await rm(directory, { recursive: true, force: true });
  for (const key of controlledEnvironment) { if (previousEnvironment[key] === undefined) delete process.env[key]; else process.env[key] = previousEnvironment[key]; }
});
const ownerId = 'preview-owner', subjectId = 'management-math';
function jobState(id: string) { return (getDB().prepare('SELECT state FROM jobs WHERE id=?').get(id) as { state: string }).state; }
test('a persisted queued text upload resumes once and extracts offline after process recovery', async () => {
  const file = await savePrivateUpload(new File(['Русский учебный текст. Условие: x ≠ 14, а y = 2.\nНе заменять знак неравенства.'], 'lecture.txt'));
  const material = createMaterial(ownerId, { ...file, title: 'Текстовая лекция', subjectId, kind: 'lecture' });
  const jobId = createJob(material.id, ownerId, 'extract', { expectedVersion: material.version, sourceHash: material.hash, effort: 'medium' });
  recoverDocumentQueue(); recoverDocumentQueue(); await idle();
  assert.equal(jobState(jobId), 'completed');
  const ready = getMaterial(material.id, ownerId)!; assert.equal(ready.status, 'ready'); assert.ok(ready.blocks.some(block => block.text.includes('x ≠ 14'))); assert.ok(ready.blocks.some(block => block.text.includes('Не заменять')));
  assert.equal((getDB().prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n, 1);
});
test('recovering a stale waiting checkpoint cancels it and preserves newer manual text without any model access', async () => {
  const file = await savePrivateUpload(new File(['Исходный текст'], 'source.txt'));
  const initialBlocks: TextBlock[] = [{ id: 'text', kind: 'text', text: 'Частичный результат: x = 14.' }, { id: 'scan', kind: 'image', text: '', imageFile: 'extractions/pending/scan.png', warning: 'Текст изображения пока не распознан.' }];
  const material = createMaterial(ownerId, { ...file, title: 'Частичное чтение', subjectId, kind: 'lecture', status: 'limited', blocks: initialBlocks });
  const jobId = createJob(material.id, ownerId, 'extract', { expectedVersion: material.version, sourceHash: material.hash, attempt: 1, effort: 'medium', resume: { blocks: initialBlocks, warnings: [], pageCount: 1, status: 'limited', needsVision: [{ blockId: 'scan', imageFile: join(directory, 'extractions/pending/scan.png') }] } });
  updateJob(jobId, ownerId, 'waiting');
  const manual = updateMaterialExtraction(material.id, ownerId, { blocks: [{ id: 'text', kind: 'text', text: 'Исправлено учеником: x ≠ 14; y = 2.' }], warnings: [], status: 'ready', pageCount: 1 }, 'manual_correction');
  recoverDocumentQueue(); await idle();
  assert.equal(jobState(jobId), 'cancelled'); assert.equal(getMaterial(material.id, ownerId)?.version, manual.version); assert.equal(getMaterial(material.id, ownerId)?.blocks[0].text, 'Исправлено учеником: x ≠ 14; y = 2.');
  assert.equal((getDB().prepare('SELECT COUNT(*) AS n FROM material_versions WHERE material_id=?').get(material.id) as { n: number }).n, 2);
});
test('an unfinished image remains pending while an advisory handwriting warning does not request another OCR pass', () => {
  const incomplete = { blocks: [{ id: 'b', text: '', kind: 'image' as const, imageFile: 'extractions/pending.png', warning: 'Распознавание изображения ожидает доступности модели.' }] };
  assert.equal(hasPendingRecognition(incomplete), true);
  const read = { blocks: [{ id: 'b', text: 'Проверенный полный текст: x ≠ 14.', kind: 'text' as const, imageFile: 'extractions/read.png', warning: 'Текст распознан — рекомендуется сверка с оригиналом.' }] };
  assert.equal(hasPendingRecognition(read), false);
});
test('metadata edits while a native task is queued preserve the new title and still allow unchanged content to finish', async () => {
  const file = await savePrivateUpload(new File(['Полное условие: x ≠ 14. Содержимое не менялось при переименовании.'], 'metadata.txt'));
  const material = createMaterial(ownerId, { ...file, title: 'Первое название', subjectId, kind: 'lecture' });
  const jobId = createJob(material.id, ownerId, 'extract', { expectedVersion: material.version, sourceHash: material.hash, baseline: { blocks: material.blocks, warnings: material.warnings }, effort: 'medium' });
  const metadata = updateMaterial(material.id, ownerId, { title: 'Уточнённое название лекции', topic: 'Новая тема без изменения текста', version: material.version });
  assert.equal(metadata.version, 2); assert.equal(metadata.status, 'queued');
  recoverDocumentQueue(); await idle();
  const processed = getMaterial(material.id, ownerId)!;
  assert.equal(jobState(jobId), 'completed'); assert.equal(processed.title, metadata.title); assert.equal(processed.topic, metadata.topic); assert.equal(processed.status, 'ready'); assert.equal(processed.version, 3);
  assert.ok(processed.blocks.some(block => block.text.includes('x ≠ 14')));
});
