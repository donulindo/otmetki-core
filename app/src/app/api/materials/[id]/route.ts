import { z } from 'zod';
import { assertSameOrigin, requireViewer, AccessError } from '@/lib/auth';
import { apiError, authorizeMaterial, json, publicMaterial, readJSON, routeId } from '@/lib/api';
import { deleteMaterial, findSimilarMaterials, listMaterialVersions, pendingRecognitionWarning, updateMaterial, updateMaterialExtraction } from '@/lib/db';
import {materialAccess,reviseShared,alternatives,archiveMaterial,assertFeature,assertSubject} from '@/lib/platform';
export const runtime = 'nodejs';
const metadata = z.object({ title: z.string().trim().min(1).max(200).optional(), topic: z.string().trim().max(300).optional(), kind: z.enum(['lecture', 'seminar', 'homework', 'rules', 'notes']).optional(), subjectId: z.string().min(1).max(100).optional(), version: z.number().int().positive(), blocks: z.array(z.object({ id: z.string().min(1).max(100), text: z.string().max(200_000) })).max(2000).optional() });
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const viewer = requireViewer(request), id = await routeId(context), versionText = new URL(request.url).searchParams.get('version');
    const version = versionText === null ? undefined : z.coerce.number().int().positive().parse(versionText), material = authorizeMaterial(viewer, id, version), versions = materialAccess(viewer,id).scope==='review'?[{version:material.version,reason:'publication_review',createdAt:material.updatedAt}]:listMaterialVersions(id, material.ownerId);
    return json({ material: {...publicMaterial(material),access:materialAccess(viewer,id)}, alternatives:alternatives(viewer,id),versions, latestVersion: Math.max(material.version, ...versions.map(item => Number(item.version))), similarCandidates: version === undefined ? findSimilarMaterials(id, viewer.id) : [] });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const viewer = requireViewer(request); assertSameOrigin(request); const id = await routeId(context), current = authorizeMaterial(viewer, id), input = metadata.parse(await readJSON(request, 2 * 1024 * 1024));
    assertFeature(viewer,'materials');
    if(current.ownerId!==viewer.id){if(input.subjectId&&input.subjectId!==current.subjectId)throw new AccessError(400,'Предмет общей записи меняется через новый учебный набор.');const result=reviseShared(viewer,id,input.version,input);return json({...result,material:publicMaterial(result.material)},'alternativeId' in result?202:200);}
    if(input.subjectId)assertSubject(viewer,input.subjectId);
    if (input.version !== current.version) throw new AccessError(409, 'Материал изменился. Обновите страницу перед сохранением.');
    if (input.blocks && (current.status === 'extracting' || current.status === 'queued')) throw new AccessError(409, 'Дождитесь окончания обработки материала перед исправлением текста.');
    let result = current;
    if (input.blocks) {
      const updates = new Map(input.blocks.map(b => [b.id, b.text]));
      if (updates.size !== input.blocks.length || [...updates.keys()].some(id => !current.blocks.some(b => b.id === id))) throw new AccessError(400, 'Не удалось найти указанный фрагмент.');
      result = updateMaterialExtraction(id, viewer.id, { blocks: current.blocks.map(block => updates.has(block.id) ? { ...block, text: updates.get(block.id)!, warning: pendingRecognitionWarning(block.warning) ? undefined : block.warning } : block), status: current.status, warnings: current.warnings, pageCount: current.pageCount }, 'manual_correction');
    }
    if (input.title !== undefined || input.topic !== undefined || input.kind !== undefined || input.subjectId !== undefined) result = updateMaterial(id, viewer.id, { title: input.title, topic: input.topic, kind: input.kind, subjectId: input.subjectId, version: result.version });
    return json({ material: publicMaterial(result) });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) { try { const viewer = requireViewer(request); assertSameOrigin(request); const id = await routeId(context); authorizeMaterial(viewer, id); archiveMaterial(viewer,id,true); return json({ deleted: true }); } catch (error) { return apiError(error); } }
