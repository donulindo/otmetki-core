import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { AccessError } from './auth';
import { privatePath } from './db';

export const DOCUMENT_LIMIT = 100 * 1024 * 1024;
export const IMAGE_LIMIT = 40 * 1024 * 1024;
export const MULTIPART_LIMIT = 120 * 1024 * 1024;
const types: Record<string, string> = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.doc': 'application/msword', '.ppt': 'application/vnd.ms-powerpoint', '.txt': 'text/plain', '.md': 'text/plain', '.csv': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
export function safeFilename(filename: string) { return basename(filename.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '').replace(/^\.+/, '').slice(0, 180) || 'material'; }
function readZipNames(bytes: Buffer) {
  let offset = bytes.length - 22;
  while (offset >= Math.max(0, bytes.length - 65_557) && bytes.readUInt32LE(offset) !== 0x06054b50) offset--;
  if (offset < Math.max(0, bytes.length - 65_557)) throw new AccessError(400, 'Повреждённый архив документа.');
  const entries = bytes.readUInt16LE(offset + 10), directorySize = bytes.readUInt32LE(offset + 12), directoryOffset = bytes.readUInt32LE(offset + 16);
  if (entries > 5000 || entries === 0xffff || directoryOffset + directorySize > offset) throw new AccessError(413, 'Структура документа слишком большая.');
  const names = new Set<string>(); let cursor = directoryOffset, expanded = 0;
  for (let entry = 0; entry < entries; entry++) {
    if (cursor + 46 > directoryOffset + directorySize || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new AccessError(400, 'Повреждённый архив документа.');
    const flags = bytes.readUInt16LE(cursor + 8), compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24), nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32);
    if (cursor + 46 + nameLength + extra + comment > bytes.length || flags & 1) throw new AccessError(400, 'Защищённый или повреждённый документ.');
    expanded += size;
    if (size > DOCUMENT_LIMIT || expanded > 512 * 1024 * 1024 || (compressed > 0 && size / compressed > 500)) throw new AccessError(413, 'Распакованный документ слишком большой.');
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new AccessError(400, 'Недопустимая структура документа.');
    names.add(name); cursor += 46 + nameLength + extra + comment;
  }
  return names;
}
export function detectUploadType(filename: string, bytes: Buffer, imageOnly = false) {
  const extension = extname(safeFilename(filename)).toLowerCase(), mimeType = types[extension];
  if (!mimeType || (imageOnly && !mimeType.startsWith('image/'))) throw new AccessError(400, 'Этот формат пока не поддерживается.');
  if (!bytes.length) throw new AccessError(400, 'Файл пустой.');
  const image = mimeType.startsWith('image/'); if (bytes.length > (image ? IMAGE_LIMIT : DOCUMENT_LIMIT)) throw new AccessError(413, image ? 'Фотография должна быть не больше 40 МБ.' : 'Документ должен быть не больше 100 МБ.');
  let valid = false;
  if (mimeType === 'application/pdf') valid = bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'));
  else if (mimeType === 'image/png') valid = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  else if (mimeType === 'image/jpeg') valid = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  else if (mimeType === 'image/webp') valid = bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  else if (extension === '.docx' || extension === '.pptx') { const names = readZipNames(bytes); valid = names.has('[Content_Types].xml') && names.has(extension === '.docx' ? 'word/document.xml' : 'ppt/presentation.xml'); }
  else if (extension === '.doc' || extension === '.ppt') valid = bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  else { try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); valid = !bytes.includes(0); } catch { valid = false; } }
  if (!valid) throw new AccessError(400, 'Содержимое файла не соответствует его формату.');
  return mimeType;
}
export async function parseBoundedFormData(request: Request, maxBytes = MULTIPART_LIMIT) {
  if (Number(request.headers.get('content-length') || 0) > maxBytes) throw new AccessError(413, 'За одну загрузку можно отправить до 120 МБ.');
  if (!request.body) throw new AccessError(400, 'Файл не получен.');
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new AccessError(413, 'Загрузка слишком большая.'); } chunks.push(item.value); } } finally { reader.releaseLock(); }
  const blob = Buffer.concat(chunks);
  return new Request(request.url, { method: 'POST', headers: { 'content-type': request.headers.get('content-type') || '' }, body: blob }).formData();
}
export async function savePrivateUpload(file: File, folder = 'originals', imageOnly = false) {
  if (!['originals', 'feedback'].includes(folder)) throw new Error('Invalid storage folder');
  if (file.size > (imageOnly ? IMAGE_LIMIT : DOCUMENT_LIMIT)) throw new AccessError(413, 'Файл слишком большой.');
  const bytes = Buffer.from(await file.arrayBuffer()), filename = safeFilename(file.name), mimeType = detectUploadType(filename, bytes, imageOnly);
  const filePath = `${folder}/${randomUUID()}${extname(filename).toLowerCase()}`, absolute = privatePath(filePath), temporary = `${absolute}.upload`;
  await mkdir(privatePath(folder), { recursive: true, mode: 0o700 });
  try { await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' }); await rename(temporary, absolute); } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  return { filename, mimeType, size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex'), filePath };
}
export async function removePrivateUpload(filePath: string) { await unlink(privatePath(filePath)).catch(() => {}); }
export const contentDisposition = (filename: string) => `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(safeFilename(filename))}`;
