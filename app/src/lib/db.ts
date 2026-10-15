import 'server-only';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { UIMessage } from 'ai';
import type { Chat, Effort, Feedback, FeedbackStatus, Material, MaterialKind, MaterialStatus, ModelId, Subject, TextBlock } from './types';

type Row = Record<string, any>;
const instances = new Map<string, DatabaseSync>();
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export const MODELS: ModelId[] = ['gpt-6.1-sol', 'gpt-6-luna'];
export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const pendingRecognitionWarning = (warning: string | undefined) => Boolean(warning && /пока не распознан|ожидает доступности модели|ожидает распознавания/i.test(warning));
export function hasPendingRecognition(material: Pick<Material, 'blocks'>) { return material.blocks.some(block => Boolean(block.imageFile) && pendingRecognitionWarning(block.warning)); }
export function dataDirectory() {
  const directory = resolve(/* turbopackIgnore: true */ process.env.PREVIEW_DATA_DIR || join(process.cwd(), '.data'));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  return directory;
}
export function privatePath(relative: string) {
  const base = dataDirectory();
  const result = resolve(base, relative);
  if (!result.startsWith(base + sep)) throw new Error('Invalid private path');
  return result;
}
export function getDB() {
  const directory = dataDirectory();
  if (instances.has(directory)) return instances.get(directory)!;
  const path = join(directory, 'preview.sqlite3');
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS subjects(id TEXT PRIMARY KEY, name TEXT NOT NULL, short_name TEXT NOT NULL, direction TEXT NOT NULL, student_group TEXT NOT NULL, semester INTEGER NOT NULL, color TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS materials(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, subject_id TEXT NOT NULL REFERENCES subjects(id), kind TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT '', mime_type TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, warnings_json TEXT NOT NULL DEFAULT '[]', blocks_json TEXT NOT NULL DEFAULT '[]', page_count INTEGER NOT NULL DEFAULT 0, source_url TEXT, file_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, hash TEXT NOT NULL DEFAULT '', duplicate_of TEXT, is_example INTEGER NOT NULL DEFAULT 0, deleted_at TEXT);
    CREATE INDEX IF NOT EXISTS materials_owner_hash ON materials(owner_id,hash);
    CREATE TABLE IF NOT EXISTS material_versions(id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id), owner_id TEXT NOT NULL, version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(material_id,version));
    CREATE TABLE IF NOT EXISTS material_blocks(id TEXT NOT NULL, material_id TEXT NOT NULL REFERENCES materials(id), owner_id TEXT NOT NULL, ordinal INTEGER NOT NULL, text TEXT NOT NULL, kind TEXT NOT NULL, page INTEGER, slide INTEGER, warning TEXT, image_file TEXT, PRIMARY KEY(material_id,id));
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, material_id TEXT NOT NULL REFERENCES materials(id), kind TEXT NOT NULL, state TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, subject_id TEXT NOT NULL REFERENCES subjects(id), kind TEXT NOT NULL, model TEXT NOT NULL, effort TEXT NOT NULL, context_ids_json TEXT NOT NULL DEFAULT '[]', generation_state TEXT NOT NULL DEFAULT 'idle', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
    CREATE TABLE IF NOT EXISTS messages(id TEXT NOT NULL, chat_id TEXT NOT NULL REFERENCES chats(id), owner_id TEXT NOT NULL, message_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ordinal INTEGER NOT NULL, PRIMARY KEY(chat_id,id));
    CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, target_version INTEGER, attachment_text TEXT, attachment_filename TEXT, attachment_path TEXT, attachment_mime TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS feedback_messages(id TEXT PRIMARY KEY, feedback_id TEXT NOT NULL REFERENCES feedback(id), owner_id TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS feedback_attachments(id TEXT PRIMARY KEY, feedback_id TEXT NOT NULL REFERENCES feedback(id), owner_id TEXT NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, file_path TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(owner_id TEXT PRIMARY KEY, settings_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_attempts(bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, resets_at INTEGER NOT NULL);
  `);
  const add = db.prepare('INSERT OR IGNORE INTO subjects VALUES(?,?,?,?,?,?,?)');
  for (const [direction, group] of [['management', 'M104'], ['economics', 'E104']] as const) {
    const rows = direction === 'management' ? [
      ['math', 'Математика для менеджеров', 'Математика', '#B96E53'], ['management', 'Введение в менеджмент', 'Менеджмент', '#789180'], ['economics', 'Экономика для менеджеров', 'Экономика', '#9B83AE'], ['history', 'История России', 'История', '#C39152'], ['safety', 'Безопасность жизнедеятельности', 'ОБЖ', '#7896AA'], ['english', 'Английский язык', 'Английский', '#7F95B5'],
    ] : [['math', 'Математика', 'Математика', '#B96E53'], ['economics', 'Введение в экономику', 'Экономика', '#789180'], ['history', 'История России', 'История', '#C39152'], ['english', 'Английский язык', 'Английский', '#7F95B5']];
    for (const [key, name, short, color] of rows) add.run(`${direction}-${key}`, name, short, direction, group, 1, color);
  }
  instances.set(directory, db);
  return db;
}
export function closeDB() { for (const db of instances.values()) db.close(); instances.clear(); }
const transactionDepth=new Map<DatabaseSync,number>();let savepoint=0;
export function transaction<T>(operation: () => T): T {
  const db=getDB(),depth=transactionDepth.get(db)||0,name=`nested_${++savepoint}`;
  db.exec(depth?`SAVEPOINT ${name}`:'BEGIN IMMEDIATE');transactionDepth.set(db,depth+1);
  try {const result=operation();db.exec(depth?`RELEASE ${name}`:'COMMIT');return result;}
  catch(error){db.exec(depth?`ROLLBACK TO ${name}`:'ROLLBACK');if(depth)db.exec(`RELEASE ${name}`);throw error;}
  finally{transactionDepth.set(db,depth);}
}
export function recordAudit(ownerId: string, action: string, targetType: string, targetId: string, details: unknown = {}) {
  getDB().prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?)').run(id(), ownerId, action, targetType, targetId, JSON.stringify(details), now());
}
export function listSubjects(): Subject[] { return (getDB().prepare('SELECT * FROM subjects ORDER BY direction,name').all() as Row[]).map(r => ({ id: r.id, name: r.name, shortName: r.short_name, direction: r.direction, group: r.student_group, semester: r.semester, color: r.color })); }
export function getSubject(subjectId: string) { return listSubjects().find(s => s.id === subjectId) || null; }
function material(r: Row): Material { return { id: r.id, ownerId: r.owner_id, title: r.title, subjectId: r.subject_id, kind: r.kind, topic: r.topic, filename: r.filename, mimeType: r.mime_type, size: r.size, version: r.version, status: r.status, warnings: JSON.parse(r.warnings_json), blocks: JSON.parse(r.blocks_json), pageCount: r.page_count, sourceUrl: r.source_url, createdAt: r.created_at, updatedAt: r.updated_at, hash: r.hash, duplicateOf: r.duplicate_of, isExample: Boolean(r.is_example) }; }
export function getMaterial(materialId: string, ownerId: string): Material | null { const r = getDB().prepare('SELECT * FROM materials WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(materialId, ownerId) as Row | undefined; return r ? material(r) : null; }
export function listMaterials(ownerId: string, subjectId?: string): Material[] { return (getDB().prepare('SELECT * FROM materials WHERE owner_id=? AND deleted_at IS NULL AND (? IS NULL OR subject_id=?) ORDER BY created_at DESC').all(ownerId, subjectId ?? null, subjectId ?? null) as Row[]).map(material); }
export function getMaterialVersion(materialId: string, ownerId: string, version: number): Material | null { const r = getDB().prepare('SELECT snapshot_json FROM material_versions WHERE material_id=? AND owner_id=? AND version=?').get(materialId, ownerId, version) as Row | undefined; return r ? material(JSON.parse(r.snapshot_json)) : null; }
export function listMaterialVersions(materialId: string, ownerId: string) { return getDB().prepare('SELECT version,reason,created_at AS createdAt FROM material_versions WHERE material_id=? AND owner_id=? ORDER BY version DESC').all(materialId, ownerId); }
export function getMaterialFile(materialId: string, ownerId: string, version?: number): { path: string; mimeType: string; filename: string } | null {
  let r: Row | undefined;
  if (version !== undefined) { const saved = getDB().prepare('SELECT snapshot_json FROM material_versions WHERE material_id=? AND owner_id=? AND version=?').get(materialId, ownerId, version) as Row | undefined; r = saved ? JSON.parse(saved.snapshot_json) : undefined; }
  else r = getDB().prepare('SELECT file_path,mime_type,filename FROM materials WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(materialId, ownerId) as Row | undefined;
  return r?.file_path ? { path: privatePath(r.file_path), mimeType: r.mime_type, filename: r.filename } : null;
}
export function findDuplicate(ownerId: string, hash: string): Material | null { if (!hash) return null; const r = getDB().prepare('SELECT * FROM materials WHERE owner_id=? AND hash=? AND deleted_at IS NULL ORDER BY CASE status WHEN \'ready\' THEN 0 WHEN \'limited\' THEN 1 ELSE 2 END,created_at LIMIT 1').get(ownerId, hash) as Row | undefined; return r ? material(r) : null; }
function snapshotMaterial(materialId: string, ownerId: string, reason: string) { const r = getDB().prepare('SELECT * FROM materials WHERE id=? AND owner_id=?').get(materialId, ownerId) as Row; getDB().prepare('INSERT INTO material_versions VALUES(?,?,?,?,?,?,?)').run(id(), materialId, ownerId, r.version, JSON.stringify(r), reason, now()); }
export interface NewMaterial { title: string; subjectId: string; kind: MaterialKind; topic?: string; filename?: string; mimeType: string; size?: number; hash?: string; filePath?: string; sourceUrl?: string; duplicateOf?: string | null; status?: MaterialStatus; blocks?: TextBlock[]; warnings?: string[]; pageCount?: number; isExample?: boolean; }
export function createMaterial(ownerId: string, input: NewMaterial): Material {
  if (!getSubject(input.subjectId)) throw new Error('Subject not found');
  const materialId = id(), time = now();
  transaction(() => {
    getDB().prepare(`INSERT INTO materials(id,owner_id,title,subject_id,kind,topic,filename,mime_type,size,status,warnings_json,blocks_json,page_count,source_url,file_path,created_at,updated_at,hash,duplicate_of,is_example) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(materialId, ownerId, input.title, input.subjectId, input.kind, input.topic || '', input.filename || '', input.mimeType, input.size || 0, input.status || 'queued', JSON.stringify(input.warnings || []), JSON.stringify(input.blocks || []), input.pageCount || 0, input.sourceUrl || null, input.filePath || null, time, time, input.hash || '', input.duplicateOf || null, Number(input.isExample || false));
    replaceBlocks(materialId, ownerId, input.blocks || []);
    snapshotMaterial(materialId, ownerId, 'created'); recordAudit(ownerId, 'material.created', 'material', materialId, { subjectId: input.subjectId, duplicateOf: input.duplicateOf || null });
  });
  return getMaterial(materialId, ownerId)!;
}
function replaceBlocks(materialId: string, ownerId: string, blocks: TextBlock[]) {
  const db = getDB(); db.prepare('DELETE FROM material_blocks WHERE material_id=? AND owner_id=?').run(materialId, ownerId);
  const insert = db.prepare('INSERT INTO material_blocks VALUES(?,?,?,?,?,?,?,?,?,?)');
  blocks.forEach((block, ordinal) => insert.run(block.id, materialId, ownerId, ordinal, block.text, block.kind, block.page ?? null, block.slide ?? null, block.warning || null, block.imageFile || null));
}
type ExtractionUpdate = { blocks: TextBlock[]; status: MaterialStatus; warnings: string[]; pageCount: number };
export function updateMaterialExtraction(materialId: string, ownerId: string, input: ExtractionUpdate, reason?: string): Material;
export function updateMaterialExtraction(materialId: string, ownerId: string, input: ExtractionUpdate, reason: string | undefined, expectedVersion: number | undefined): Material | null;
export function updateMaterialExtraction(materialId: string, ownerId: string, input: ExtractionUpdate, reason = 'extraction', expectedVersion?: number): Material | null {
  return transaction(() => {
    const current = getMaterial(materialId, ownerId);
    if (expectedVersion !== undefined && (!current || current.version !== expectedVersion)) return null;
    if (!current) throw new Error('Material not found');
    getDB().prepare('UPDATE materials SET blocks_json=?,status=?,warnings_json=?,page_count=?,version=version+1,updated_at=? WHERE id=? AND owner_id=?').run(JSON.stringify(input.blocks), input.status, JSON.stringify(input.warnings), input.pageCount, now(), materialId, ownerId);
    replaceBlocks(materialId, ownerId, input.blocks); snapshotMaterial(materialId, ownerId, reason); recordAudit(ownerId, 'material.extraction', 'material', materialId, { version: current.version + 1, status: input.status, reason });
    return getMaterial(materialId, ownerId)!;
  });
}
export function setMaterialStatus(materialId: string, ownerId: string, status: MaterialStatus) { getDB().prepare('UPDATE materials SET status=?,updated_at=? WHERE id=? AND owner_id=? AND deleted_at IS NULL').run(status, now(), materialId, ownerId); }
export function createJob(materialId: string, ownerId: string, kind: string, payload: unknown = {}) {
  if (!getMaterial(materialId, ownerId)) throw new Error('Material not found');
  const jobId = id(), time = now(); getDB().prepare('INSERT INTO jobs(id,owner_id,material_id,kind,state,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(jobId, ownerId, materialId, kind, 'queued', JSON.stringify(payload), time, time); return jobId;
}
export function updateJob(jobId: string, ownerId: string, state: string, error: string | null = null) { getDB().prepare('UPDATE jobs SET state=?,error=?,updated_at=? WHERE id=? AND owner_id=?').run(state, error, now(), jobId, ownerId); }
export function listPendingJobs(ownerId?: string) { return getDB().prepare("SELECT * FROM jobs WHERE state IN ('queued','running') AND (? IS NULL OR owner_id=?) ORDER BY created_at").all(ownerId ?? null, ownerId ?? null); }
export function updateMaterial(materialId: string, ownerId: string, input: Partial<Pick<Material, 'title' | 'topic' | 'kind' | 'subjectId'>> & { version?: number }): Material {
  return transaction(() => {
    const current = getMaterial(materialId, ownerId); if (!current) throw new Error('Material not found');
    if (input.version !== undefined && input.version !== current.version) throw new Error('Version conflict');
    if (input.subjectId && !getSubject(input.subjectId)) throw new Error('Subject not found');
    getDB().prepare('UPDATE materials SET title=?,topic=?,kind=?,subject_id=?,version=version+1,updated_at=? WHERE id=? AND owner_id=?').run(input.title ?? current.title, input.topic ?? current.topic, input.kind ?? current.kind, input.subjectId ?? current.subjectId, now(), materialId, ownerId);
    snapshotMaterial(materialId, ownerId, 'metadata'); recordAudit(ownerId, 'material.updated', 'material', materialId, { version: current.version + 1 }); return getMaterial(materialId, ownerId)!;
  });
}
export function deleteMaterial(materialId: string, ownerId: string) { if (!getMaterial(materialId, ownerId)) return false; getDB().prepare('UPDATE materials SET deleted_at=?,updated_at=? WHERE id=? AND owner_id=?').run(now(), now(), materialId, ownerId); recordAudit(ownerId, 'material.deleted', 'material', materialId); return true; }
/** New upload becomes a new immutable version under the existing context identifier. */
export function replaceMaterialWithUpload(materialId: string, ownerId: string, candidateId: string, expectedVersion: number) {
  return transaction(() => {
    const current = getMaterial(materialId, ownerId), candidate = getMaterial(candidateId, ownerId);
    if (!current || !candidate) throw new Error('Material not found');
    if (materialId === candidateId || current.subjectId !== candidate.subjectId) throw new Error('Invalid replacement');
    if (current.version !== expectedVersion) throw new Error('Version conflict');
    if (['queued', 'extracting'].includes(current.status) || ['queued', 'extracting'].includes(candidate.status)) throw new Error('Material busy');
    const original = getDB().prepare('SELECT file_path FROM materials WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(candidateId, ownerId) as Row;
    if (!original.file_path) throw new Error('Replacement requires file');
    // Validate the internal storage path before transferring the private file reference.
    privatePath(original.file_path);
    getDB().prepare(`UPDATE materials SET filename=?,mime_type=?,size=?,hash=?,file_path=?,status=?,warnings_json=?,blocks_json=?,page_count=?,source_url=?,duplicate_of=?,is_example=?,version=version+1,updated_at=? WHERE id=? AND owner_id=?`).run(candidate.filename, candidate.mimeType, candidate.size, candidate.hash, original.file_path, candidate.status, JSON.stringify(candidate.warnings), JSON.stringify(candidate.blocks), candidate.pageCount, candidate.sourceUrl, candidate.duplicateOf === materialId ? null : candidate.duplicateOf, Number(candidate.isExample), now(), materialId, ownerId);
    replaceBlocks(materialId, ownerId, candidate.blocks);
    snapshotMaterial(materialId, ownerId, 'file_replaced');
    // An upload already selected in another conversation remains available there.
    const referenced = listChats(ownerId).some(chat => chat.contextIds.includes(candidateId));
    if (!referenced) getDB().prepare('UPDATE materials SET deleted_at=?,updated_at=? WHERE id=? AND owner_id=?').run(now(), now(), candidateId, ownerId);
    recordAudit(ownerId, 'material.file_replaced', 'material', materialId, { version: expectedVersion + 1, candidateId, candidateVersion: candidate.version, candidateArchived: !referenced });
    return { material: getMaterial(materialId, ownerId)!, candidateArchived: !referenced };
  });
}
export interface SimilarCandidate { id: string; title: string; version: number; overlapBlocks: number; comparedBlocks: number; candidateComparedBlocks: number; exactFileDuplicate: boolean; }
/** Literal normalized blocks only. Case, numbers, signs and qualifications remain significant. */
export function findSimilarMaterials(materialId: string, ownerId: string): SimilarCandidate[] {
  const source = getMaterial(materialId, ownerId); if (!source) return [];
  const fingerprint = (text: string) => createHash('sha256').update(text.normalize('NFC').replace(/\s+/g, ' ').trim()).digest('hex');
  function keysFor(id: string) {
    const keys = new Set<string>(); let characters = 0;
    const rows = getDB().prepare('SELECT text FROM material_blocks WHERE material_id=? AND owner_id=? AND length(text) BETWEEN 48 AND 65536 ORDER BY ordinal LIMIT 300').iterate(id, ownerId);
    for (const row of rows) { const text = (row as Row).text as string; characters += text.length; if (characters > 750_000) break; keys.add(fingerprint(text)); }
    return keys;
  }
  const ownKeys = keysFor(materialId);
  const candidates = getDB().prepare('SELECT id,title,version,hash FROM materials WHERE owner_id=? AND subject_id=? AND id!=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 80').all(ownerId, source.subjectId, materialId) as Row[];
  const results: SimilarCandidate[] = [];
  for (const candidate of candidates) {
    const exactFileDuplicate = Boolean(source.hash && source.hash === candidate.hash);
    const keys = keysFor(candidate.id); const overlapBlocks = [...keys].filter(key => ownKeys.has(key)).length;
    if (overlapBlocks || exactFileDuplicate) results.push({ id: candidate.id, title: candidate.title, version: candidate.version, overlapBlocks, comparedBlocks: ownKeys.size, candidateComparedBlocks: keys.size, exactFileDuplicate });
  }
  return results.sort((a, b) => Number(b.exactFileDuplicate) - Number(a.exactFileDuplicate) || b.overlapBlocks - a.overlapBlocks).slice(0, 6);
}
function chat(r: Row): Chat { return { id: r.id, ownerId: r.owner_id, title: r.title, subjectId: r.subject_id, kind: r.kind, model: r.model, effort: r.effort, contextIds: JSON.parse(r.context_ids_json), generationState: r.generation_state, createdAt: r.created_at, updatedAt: r.updated_at }; }
export function getChat(chatId: string, ownerId: string): Chat | null { const r = getDB().prepare('SELECT * FROM chats WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(chatId, ownerId) as Row | undefined; return r ? chat(r) : null; }
export function listChats(ownerId: string): Chat[] { return (getDB().prepare('SELECT * FROM chats WHERE owner_id=? AND deleted_at IS NULL ORDER BY updated_at DESC').all(ownerId) as Row[]).map(chat); }
export function getSettings(ownerId: string): { model: ModelId; effort: Effort } { const r = getDB().prepare('SELECT settings_json FROM settings WHERE owner_id=?').get(ownerId) as Row | undefined; return r ? JSON.parse(r.settings_json) : { model: 'gpt-6.1-sol', effort: 'medium' }; }
export function saveSettings(ownerId: string, settings: { model: ModelId; effort: Effort }) { if (!MODELS.includes(settings.model) || !EFFORTS.includes(settings.effort)) throw new Error('Invalid model settings'); getDB().prepare('INSERT INTO settings VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at').run(ownerId, JSON.stringify(settings), now()); recordAudit(ownerId, 'preferences.updated', 'preferences', ownerId, settings); return settings; }
export function createChat(ownerId: string, input: Partial<Pick<Chat, 'title' | 'kind' | 'model' | 'effort' | 'contextIds'>> & { subjectId: string },readable?:Material[]): Chat {
  if (!getSubject(input.subjectId)) throw new Error('Subject not found');
  const settings = getSettings(ownerId), chatId = id(), time = now();
  const contextIds = input.contextIds ?? (readable||listMaterials(ownerId, input.subjectId)).filter(m => m.subjectId===input.subjectId&&['lecture', 'seminar'].includes(m.kind) && ['ready', 'limited'].includes(m.status)).map(m => m.id);
  validateContext(ownerId, input.subjectId, contextIds,readable);
  const model = input.model ?? settings.model, effort = input.effort ?? settings.effort;
  if (!MODELS.includes(model) || !EFFORTS.includes(effort)) throw new Error('Invalid model settings');
  getDB().prepare('INSERT INTO chats VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)').run(chatId, ownerId, input.title || 'Новая беседа', input.subjectId, input.kind || 'work', model, effort, JSON.stringify(contextIds), 'idle', time, time);
  recordAudit(ownerId, 'chat.created', 'chat', chatId); return getChat(chatId, ownerId)!;
}
function validateContext(ownerId: string, subjectId: string, ids: string[],readable?:Material[]) { if (ids.length > 200 || new Set(ids).size !== ids.length || ids.some(id => { const m = readable?readable.find(m=>m.id===id):getMaterial(id, ownerId); return !m || m.subjectId !== subjectId; })) throw new Error('Invalid context'); }
export function updateChat(chatId: string, ownerId: string, input: Partial<Pick<Chat, 'title' | 'model' | 'effort' | 'contextIds'>>,readable?:Material[]): Chat {
  const current = getChat(chatId, ownerId); if (!current) throw new Error('Chat not found');
  const model = input.model ?? current.model, effort = input.effort ?? current.effort, contextIds = input.contextIds ?? current.contextIds;
  if (!MODELS.includes(model) || !EFFORTS.includes(effort)) throw new Error('Invalid model settings'); if(input.contextIds)validateContext(ownerId, current.subjectId, contextIds,readable);
  getDB().prepare('UPDATE chats SET title=?,model=?,effort=?,context_ids_json=?,updated_at=? WHERE id=? AND owner_id=?').run(input.title ?? current.title, model, effort, JSON.stringify(contextIds), now(), chatId, ownerId);
  recordAudit(ownerId, 'chat.updated', 'chat', chatId, { model, effort, contextIds }); return getChat(chatId, ownerId)!;
}
export function deleteChat(chatId: string, ownerId: string) { if (!getChat(chatId, ownerId)) return false; getDB().prepare('UPDATE chats SET deleted_at=?,updated_at=? WHERE id=? AND owner_id=?').run(now(), now(), chatId, ownerId); recordAudit(ownerId, 'chat.deleted', 'chat', chatId); return true; }
export function listMessages(chatId: string, ownerId: string): UIMessage[] { if (!getChat(chatId, ownerId)) return []; return (getDB().prepare('SELECT message_json FROM messages WHERE chat_id=? AND owner_id=? ORDER BY ordinal').all(chatId, ownerId) as Row[]).map(r => JSON.parse(r.message_json)); }
export function saveMessage(chatId: string, ownerId: string, message: UIMessage, status = 'completed') {
  if (!getChat(chatId, ownerId)) throw new Error('Chat not found');
  const time = now(); const ordinal = (getDB().prepare('SELECT COALESCE(MAX(ordinal),-1)+1 AS next FROM messages WHERE chat_id=?').get(chatId) as Row).next;
  getDB().prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(chat_id,id) DO UPDATE SET message_json=excluded.message_json,status=excluded.status,updated_at=excluded.updated_at').run(message.id, chatId, ownerId, JSON.stringify(message), status, time, time, ordinal);
  getDB().prepare('UPDATE chats SET updated_at=? WHERE id=? AND owner_id=?').run(time, chatId, ownerId);
}
export function setChatGenerationState(chatId: string, ownerId: string, state: Chat['generationState']) { if (!getChat(chatId, ownerId)) throw new Error('Chat not found'); getDB().prepare('UPDATE chats SET generation_state=?,updated_at=? WHERE id=? AND owner_id=?').run(state, now(), chatId, ownerId); }
function feedback(r: Row): Feedback { return { id: r.id, ownerId: r.owner_id, subject: r.subject, message: r.message, status: r.status, targetType: r.target_type, targetId: r.target_id, targetVersion: r.target_version, attachmentText: r.attachment_text, attachmentFilename: r.attachment_filename, messages: (getDB().prepare('SELECT * FROM feedback_messages WHERE feedback_id=? AND owner_id=? ORDER BY created_at,rowid').all(r.id, r.owner_id) as Row[]).map(m => ({ id: m.id, author: m.author, text: m.text, createdAt: m.created_at })), createdAt: r.created_at, updatedAt: r.updated_at }; }
export function getFeedback(feedbackId: string, ownerId: string): Feedback | null { const r = getDB().prepare('SELECT * FROM feedback WHERE id=? AND owner_id=?').get(feedbackId, ownerId) as Row | undefined; return r ? feedback(r) : null; }
export function listFeedback(ownerId: string): Feedback[] { return (getDB().prepare('SELECT * FROM feedback WHERE owner_id=? ORDER BY updated_at DESC').all(ownerId) as Row[]).map(feedback); }
export function createFeedback(ownerId: string, input: { subject: string; message: string; targetType: Feedback['targetType']; targetId?: string | null; targetVersion?: number | null; attachmentText?: string; attachmentFilename?: string; attachmentPath?: string; attachmentMime?: string; attachmentConsent?: boolean },authorizedTarget=false): Feedback {
  if ((input.attachmentText || input.attachmentPath || input.attachmentFilename) && input.attachmentConsent !== true) throw new Error('Attachment consent required');
  if (input.targetType === 'material' && (!input.targetId || !authorizedTarget&&!getMaterial(input.targetId, ownerId))) throw new Error('Material not found');
  if (input.targetType === 'chat' && (!input.targetId || !getChat(input.targetId, ownerId))) throw new Error('Chat not found');
  const feedbackId = id(), time = now();
  return transaction(() => {
    getDB().prepare('INSERT INTO feedback VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(feedbackId, ownerId, input.subject, input.message, 'received', input.targetType, input.targetId || null, input.targetVersion ?? null, input.attachmentText || null, input.attachmentFilename || null, input.attachmentPath || null, input.attachmentMime || null, time, time);
    recordAudit(ownerId, 'feedback.created', 'feedback', feedbackId, { targetType: input.targetType, targetId: input.targetId || null, attached: Boolean(input.attachmentText || input.attachmentPath) }); return getFeedback(feedbackId, ownerId)!;
  });
}
export function addFeedbackMessage(feedbackId: string, ownerId: string, text: string, author: 'user' | 'owner' = 'user') { return transaction(() => { if (!getFeedback(feedbackId, ownerId)) throw new Error('Feedback not found'); getDB().prepare('INSERT INTO feedback_messages VALUES(?,?,?,?,?,?)').run(id(), feedbackId, ownerId, author, text, now()); getDB().prepare('UPDATE feedback SET updated_at=? WHERE id=? AND owner_id=?').run(now(), feedbackId, ownerId); recordAudit(ownerId, 'feedback.reply', 'feedback', feedbackId); return getFeedback(feedbackId, ownerId)!; }); }
export function setFeedbackStatus(feedbackId: string, ownerId: string, status: FeedbackStatus) { return transaction(() => { if (!getFeedback(feedbackId, ownerId)) throw new Error('Feedback not found'); if (!['received', 'clarification', 'in_progress', 'resolved'].includes(status)) throw new Error('Invalid status'); getDB().prepare('UPDATE feedback SET status=?,updated_at=? WHERE id=? AND owner_id=?').run(status, now(), feedbackId, ownerId); recordAudit(ownerId, 'feedback.status', 'feedback', feedbackId, { status }); return getFeedback(feedbackId, ownerId)!; }); }
export function getFeedbackAttachment(feedbackId: string, ownerId: string) { const r = getDB().prepare('SELECT attachment_path,attachment_filename,attachment_mime FROM feedback WHERE id=? AND owner_id=?').get(feedbackId, ownerId) as Row | undefined; return r?.attachment_path ? { path: privatePath(r.attachment_path), filename: r.attachment_filename as string, mimeType: r.attachment_mime as string } : null; }
