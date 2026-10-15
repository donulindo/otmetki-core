import {z} from 'zod';
import {requireViewer,assertSameOrigin} from '@/lib/auth';
import {apiError,json,publicMaterial,readJSON} from '@/lib/api';
import {publishMaterial,archiveMaterial,archivedMaterials,alternatives,resolveAlternative} from '@/lib/platform';
export const runtime='nodejs';
const edits=z.object({title:z.string().min(1).max(200).optional(),topic:z.string().max(300).optional(),kind:z.enum(['lecture','seminar','homework','rules','notes']).optional(),blocks:z.array(z.object({id:z.string().max(100),text:z.string().max(200000)})).max(2000).optional()}).strict();
const action=z.discriminatedUnion('action',[
 z.object({action:z.literal('publish'),materialId:z.string(),version:z.number().int().positive(),audienceId:z.string()}),
 z.object({action:z.literal('restore'),materialId:z.string()}),
 z.object({action:z.literal('resolve'),materialId:z.string(),alternativeId:z.string(),version:z.number().int().positive(),merged:edits.optional()})
]);
export async function GET(request:Request){try{const v=requireViewer(request),mid=new URL(request.url).searchParams.get('materialId');return json(mid?{alternatives:alternatives(v,mid)}:{archived:archivedMaterials(v).map(m=>publicMaterial(m!))});}catch(e){return apiError(e);}}
export async function POST(request:Request){try{const v=requireViewer(request);assertSameOrigin(request);const a=action.parse(await readJSON(request,2*1024*1024));if(a.action==='publish'){const r=publishMaterial(v,a.materialId,a.version,a.audienceId);return json({...r,...('material'in r?{material:publicMaterial(r.material!)}:{})},r.pending?202:201);}if(a.action==='restore'){archiveMaterial(v,a.materialId,false);return json({ok:true});}return json({material:publicMaterial(resolveAlternative(v,a.materialId,a.alternativeId,a.version,a.merged))});}catch(e){return apiError(e);}}
