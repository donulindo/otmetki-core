import 'server-only';
import { z } from 'zod';
import { AccessError } from './auth';
import { getChat, getFeedback, getMaterial, getMaterialVersion,getMaterialFile } from './db';
import type { Material, Viewer } from './types';
import {PolicyError,requireMaterial} from './platform';
export const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export function apiError(error: unknown) {
  if (error instanceof AccessError || error instanceof PolicyError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return json({ error: 'Проверьте заполненные поля.' }, 400);
  if (error instanceof Error && error.message === 'Version conflict') return json({ error: 'Материал изменился. Обновите страницу перед сохранением.' }, 409);
  // Never return provider URLs, keys, filesystem paths or arbitrary exception text.
  return json({ error: 'Не удалось выполнить действие. Попробуйте снова.' }, 400);
}
export function authorizeMaterial(viewer: Viewer, id: string, version?: number) { try{return requireMaterial(viewer,id,version);}catch(e){if(e instanceof PolicyError)throw new AccessError(e.status,e.message);throw e;} }
export function authorizeChat(viewer: Viewer, id: string) { const chat = getChat(id, viewer.id); if (!chat) throw new AccessError(404, 'Беседа не найдена.'); return chat; }
export function authorizeFeedback(viewer: Viewer, id: string) { const item = getFeedback(id, viewer.id); if (!item) throw new AccessError(404, 'Обращение не найдено.'); return item; }
export function publicMaterial(material: Material): Material {
  return { ...material,hasOriginal:Boolean(getMaterialFile(material.id,material.ownerId,material.version)), blocks: material.blocks.map(block => ({ ...block, imageFile: block.imageFile ? `/api/materials/${material.id}/image?block=${encodeURIComponent(block.id)}&version=${material.version}` : undefined })) };
}
export async function readJSON(request: Request, maxBytes = 256 * 1024): Promise<unknown> {
  const claimed = Number(request.headers.get('content-length') || '0'); if (claimed > maxBytes) throw new AccessError(413, 'Запрос слишком большой.');
  if (!request.body) return {};
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new AccessError(413, 'Запрос слишком большой.'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export const routeId = async (context: { params: Promise<{ id: string }> }) => (await context.params).id;
