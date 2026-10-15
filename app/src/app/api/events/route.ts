import {z} from 'zod';
import {requireViewer,assertSameOrigin} from '@/lib/auth';
import {apiError,json,readJSON} from '@/lib/api';
import {listEvents,saveEvent,archiveEvent} from '@/lib/events';
export const runtime='nodejs';
const event=z.object({id:z.string().optional(),version:z.number().int().positive().optional(),audienceId:z.string().nullable(),subjectId:z.string(),title:z.string().trim().min(1).max(200),startsAt:z.string().datetime({offset:true}),endsAt:z.string().datetime({offset:true}),kind:z.enum(['lesson','work'])}).strict();
export async function GET(r:Request){try{const v=requireViewer(r);return json({events:listEvents(v).map(({authorId,...e})=>({...e,canEdit:(v.role==='owner'||authorId===v.id)}))});}catch(e){return apiError(e);}}
export async function POST(r:Request){try{const v=requireViewer(r);assertSameOrigin(r);return json({event:saveEvent(v,event.parse(await readJSON(r)))},201);}catch(e){return apiError(e);}}
export async function DELETE(r:Request){try{const v=requireViewer(r);assertSameOrigin(r);const a=z.object({id:z.string(),version:z.number().int().positive()}).parse(await readJSON(r));archiveEvent(v,a.id,a.version);return json({ok:true});}catch(e){return apiError(e);}}
