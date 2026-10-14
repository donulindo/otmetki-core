import {readFile} from 'node:fs/promises';
import {requireViewer,AccessError} from '@/lib/auth';
import {authorizeMaterial,apiError,routeId} from '@/lib/api';
import {privatePath} from '@/lib/db';
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
  try {
    const viewer=requireViewer(request);const id=await routeId(context);const url=new URL(request.url);
    const version=url.searchParams.get('version');const material=authorizeMaterial(viewer,id,version?Number(version):undefined);
    const block=material.blocks.find(b=>b.id===url.searchParams.get('block'));
    if(!block?.imageFile)throw new AccessError(404,'Изображение не найдено.');
    const bytes=await readFile(privatePath(block.imageFile));
    return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }catch(error){return apiError(error);}
}
