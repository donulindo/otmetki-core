import {z} from 'zod';
import {requireViewer,assertSameOrigin,AccessError} from '@/lib/auth';
import {apiError,readJSON,authorizeMaterial} from '@/lib/api';
import {contextTXT} from '@/lib/context';
export async function POST(request:Request) {
  try {
    assertSameOrigin(request);const viewer=requireViewer(request);
    const body=z.object({materialIds:z.array(z.string()).min(1).max(300),subjectId:z.string().optional()}).parse(await readJSON(request));
    const materials=[...new Set(body.materialIds)].map(id=>authorizeMaterial(viewer,id));
    if(body.subjectId&&materials.some(m=>m.subjectId!==body.subjectId))throw new AccessError(400,'Выберите материалы одного предмета.');
    return new Response(contextTXT(materials),{headers:{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="msu-context.txt"','Cache-Control':'no-store'}});
  }catch(error){return apiError(error);}
}
