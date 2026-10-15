import {requireViewer,assertSameOrigin,AccessError} from '@/lib/auth';
import {authorizeChat,apiError,readJSON} from '@/lib/api';
import {latestUserMessage,startChatResponse} from '@/lib/chat-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
  try {
    assertSameOrigin(request);const viewer=requireViewer(request);const body=await readJSON(request) as Record<string,unknown>;
    const chatId=String(body.chatId||body.id||'');authorizeChat(viewer,chatId);
    return startChatResponse(chatId,viewer.id,latestUserMessage(body));
  } catch(error) {
    if(error instanceof Error&&error.message==='CHAT_BUSY')return apiError(new AccessError(409,'В этой беседе уже готовится ответ. Дождитесь его или остановите.'));
    if(error instanceof Error&&error.message==='AI_UNAVAILABLE')return apiError(new AccessError(503,'ИИ пока недоступен. Сообщение сохранено; попробуйте позже.'));
    return apiError(error);
  }
}
