import {z} from 'zod';
import {requireViewer,assertSameOrigin,AccessError} from '@/lib/auth';
import {authorizeChat,apiError,json,readJSON,routeId} from '@/lib/api';
import {listMessages} from '@/lib/db';
import {startChatResponse} from '@/lib/chat-runtime';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const v=requireViewer(request);assertSameOrigin(request);const chat=authorizeChat(v,await routeId(context)),a=z.object({expectedMessageId:z.string()}).parse(await readJSON(request));const last=listMessages(chat.id,v.id).filter(m=>m.role==='user').at(-1);if(!last||last.id!==a.expectedMessageId)throw new AccessError(409,'Беседа изменилась. Обновите её перед пересозданием.');const response=startChatResponse(chat.id,v.id,last,true);await response.body?.cancel();return json({started:true},202);}catch(e){return apiError(e);}}
