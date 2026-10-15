import { z } from 'zod';
import { AccessError, assertSameOrigin, requireViewer } from '@/lib/auth';
import { apiError, authorizeMaterial, json, publicMaterial, readJSON, routeId } from '@/lib/api';
import { getDB, getMaterial, replaceMaterialWithUpload } from '@/lib/db';
import { enqueueMaterialExtraction } from '@/lib/processing';
import {assertFeature,replaceSharedOriginal} from '@/lib/platform';
export const runtime = 'nodejs';
const schema = z.object({ candidateId: z.string().min(1).max(100), version: z.number().int().positive() }).strict();
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const viewer = requireViewer(request); assertSameOrigin(request);
    const materialId = await routeId(context), input = schema.parse(await readJSON(request)), current = authorizeMaterial(viewer, materialId), candidate = authorizeMaterial(viewer, input.candidateId);
    assertFeature(viewer,'materials');
    if(candidate.ownerId!==viewer.id)throw new AccessError(403,'Для замены выберите личный файл.');
    if(current.ownerId!==viewer.id){const result=replaceSharedOriginal(viewer,materialId,candidate.id,input.version);return json({...result,material:publicMaterial(result.material)},'alternativeId' in result?202:200);}
    if (current.subjectId !== candidate.subjectId || current.id === candidate.id) throw new AccessError(400, 'Выберите другой файл этого же предмета.');
    if (['queued', 'extracting'].includes(current.status) || ['queued', 'extracting'].includes(candidate.status)) throw new AccessError(409, 'Дождитесь окончания обработки файлов.');
    const waiting = getDB().prepare("SELECT id FROM jobs WHERE owner_id=? AND material_id=? AND state='waiting' LIMIT 1").get(viewer.id, candidate.id);
    const result = replaceMaterialWithUpload(materialId, viewer.id, candidate.id, input.version);
    if (waiting) enqueueMaterialExtraction(materialId, viewer.id);
    return json({ material: publicMaterial(getMaterial(materialId, viewer.id)!), candidateArchived: result.candidateArchived });
  } catch (error) { return apiError(error); }
}
