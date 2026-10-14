import {requireViewer} from '@/lib/auth';
import {authorizeChat,apiError,routeId} from '@/lib/api';
import {resumeChatResponse} from '@/lib/chat-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
  try {const viewer=requireViewer(request);const id=await routeId(context);authorizeChat(viewer,id);return resumeChatResponse(id,viewer.id);}catch(error){return apiError(error);}
}
