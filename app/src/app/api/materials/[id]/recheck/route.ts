import { z } from 'zod';
import { assertSameOrigin, requireViewer, AccessError, rateLimit } from '@/lib/auth';
import { apiError, authorizeMaterial, json, publicMaterial, readJSON, routeId } from '@/lib/api';
import { getMaterial } from '@/lib/db';
import { enqueueRecheck } from '@/lib/processing';
import {assertFeature,materialAccess} from '@/lib/platform';
export const runtime = 'nodejs';
const input = z.object({ blockId: z.string().min(1).max(100), effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'), version: z.number().int().positive().optional() }).strict();
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { try { const viewer = requireViewer(request); assertSameOrigin(request); const id = await routeId(context), material = authorizeMaterial(viewer, id), body = input.parse(await readJSON(request)); assertFeature(viewer,'materials');if(!materialAccess(viewer,id).canEdit)throw new AccessError(403,'Редактирование набора закрыто.'); if (body.version !== undefined && body.version !== material.version) throw new AccessError(409, 'Материал изменился. Откройте актуальную версию перед перепроверкой.'); rateLimit(`recheck:${viewer.id}`, 12, 60_000); if (!material.blocks.some(block => block.id === body.blockId)) throw new AccessError(404, 'Фрагмент не найден.'); if (material.status === 'queued' || material.status === 'extracting') throw new AccessError(409, 'Материал уже обрабатывается.'); enqueueRecheck(id, material.ownerId, body.blockId, body.effort,viewer.id); return json({ queued: true, material: publicMaterial(getMaterial(id, material.ownerId)!) }, 202); } catch (error) { return apiError(error); } }
