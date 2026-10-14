import {requireViewer,assertSameOrigin} from '@/lib/auth';
import {authorizeChat,apiError,routeId,json} from '@/lib/api';
import {stopChatResponse} from '@/lib/chat-runtime';
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  try {assertSameOrigin(request);const viewer=requireViewer(request);const id=await routeId(context);authorizeChat(viewer,id);return json(stopChatResponse(id,viewer.id));}catch(error){return apiError(error);}
}
