import { z } from 'zod';
import { relative } from 'node:path';
import { AccessError, assertSameOrigin, rateLimit, requireViewer } from '@/lib/auth';
import { apiError, json, publicMaterial, readJSON } from '@/lib/api';
import { createMaterial, dataDirectory, findDuplicate, getMaterial, getMaterialFile, hasPendingRecognition, listMaterials } from '@/lib/db';
import { parseBoundedFormData, removePrivateUpload, savePrivateUpload } from '@/lib/files';
import { enqueueMaterialExtraction, recoverDocumentQueue } from '@/lib/processing';
import {visibleMaterials,materialAccess,assertFeature,assertSubject,publishMaterial,assertPublicationTarget} from '@/lib/platform';

export const runtime = 'nodejs';
const fields = z.object({ title: z.string().trim().min(1).max(200), subjectId: z.string().min(1).max(100), kind: z.enum(['lecture', 'seminar', 'homework', 'rules', 'notes']).default('lecture'), topic: z.string().trim().max(300).default(''),audienceId:z.string().min(1).max(100).optional() });
const linked = fields.extend({ sourceUrl: z.url().max(2000).refine(value => { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }) });
export async function GET(request: Request) { try { const viewer = requireViewer(request); recoverDocumentQueue();const subjectId=new URL(request.url).searchParams.get('subjectId'); return json({ materials: visibleMaterials(viewer).filter(m=>!subjectId||m.subjectId===subjectId).map(m=>({...publicMaterial(m),access:materialAccess(viewer,m.id)})) }); } catch (error) { return apiError(error); } }
export async function POST(request: Request) {
  const savedPaths: string[] = [];
  try {
    const viewer = requireViewer(request); assertSameOrigin(request);assertFeature(viewer,'materials'); rateLimit(`uploads:${viewer.id}`, 40, 60_000);
    if ((request.headers.get('content-type') || '').includes('application/json')) {
      const input = linked.parse(await readJSON(request));
      assertSubject(viewer,input.subjectId);if(input.audienceId)assertPublicationTarget(viewer,input.audienceId,input.subjectId);
      const material = createMaterial(viewer.id, { ...input, mimeType: 'text/uri-list', status: 'limited', warnings: ['Сохранена ссылка. Содержимое внешнего сайта не загружено и не включено в контекст.'] });
      if(input.audienceId)publishMaterial(viewer,material.id,material.version,input.audienceId);
      return json({ material: publicMaterial(material), materials: [publicMaterial(material)] }, 201);
    }
    const form = await parseBoundedFormData(request);
    const files = [...form.getAll('files'), ...form.getAll('file')].filter((value): value is File => value instanceof File);
    if (!files.length || files.length > 20) throw new AccessError(400, 'Выберите от 1 до 20 файлов.');
    const input = fields.parse({ title: form.get('title') || files[0].name, subjectId: form.get('subjectId'), kind: form.get('kind') || 'lecture', topic: form.get('topic') || '',audienceId:form.get('audienceId')||undefined });
    assertSubject(viewer,input.subjectId);if(input.audienceId)assertPublicationTarget(viewer,input.audienceId,input.subjectId);
    const saved = [];
    for (const file of files) { const item = await savePrivateUpload(file); saved.push(item); savedPaths.push(item.filePath); }
    const materials = [];
    for (let index = 0; index < saved.length; index++) {
      const file = saved[index], duplicate = findDuplicate(viewer.id, file.hash), oldFile = duplicate && getMaterialFile(duplicate.id, viewer.id);
      const cached = duplicate && ['ready', 'limited'].includes(duplicate.status);
      const filePath = oldFile ? relative(dataDirectory(), oldFile.path) : file.filePath;
      const material = createMaterial(viewer.id, { ...input, ...file, filePath, title: saved.length === 1 ? input.title : file.filename, duplicateOf: duplicate?.id, ...(cached ? { status: duplicate.status, blocks: duplicate.blocks, warnings: duplicate.warnings, pageCount: duplicate.pageCount } : {}) });
      // Only the owner namespace can reuse files and extraction. Original cache remains private.
      if (oldFile) await removePrivateUpload(file.filePath);
      savedPaths.splice(savedPaths.indexOf(file.filePath), 1);
      if (!cached || hasPendingRecognition(material)) enqueueMaterialExtraction(material.id, viewer.id);
      if(input.audienceId)publishMaterial(viewer,material.id,getMaterial(material.id,viewer.id)!.version,input.audienceId);
      materials.push(publicMaterial(getMaterial(material.id, viewer.id)!));
    }
    return json({ materials, material: materials[0], duplicates: materials.filter(m => m.duplicateOf).map(m => ({ id: m.id, duplicateOf: m.duplicateOf })) }, 201);
  } catch (error) { for (const path of savedPaths) await removePrivateUpload(path); return apiError(error); }
}
