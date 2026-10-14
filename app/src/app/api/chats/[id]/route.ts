import { z } from 'zod';
import { apiError, authorizeChat, json, readJSON, routeId } from '@/lib/api';
import { AccessError, assertSameOrigin, requireViewer } from '@/lib/auth';
import { deleteChat, listMessages, updateChat } from '@/lib/db';
import { recoverChatStates } from '@/lib/chat-runtime';
import {visibleMaterials,assertFeature} from '@/lib/platform';
import {messagesForClient} from '@/lib/chat-privacy';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
const patchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  model: z.enum(['gpt-6.1-sol', 'gpt-6-luna']).optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  contextIds: z.array(z.string().min(1).max(100)).max(200).optional(),
}).strict().refine(value => Object.keys(value).length > 0);

export async function GET(request: Request, context: Context) {
  try {
    const viewer = requireViewer(request); recoverChatStates(); const chat = authorizeChat(viewer, await routeId(context));
    return json({ chat, messages: messagesForClient(listMessages(chat.id, viewer.id)) });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const viewer = requireViewer(request); assertSameOrigin(request);
    const chat = authorizeChat(viewer, await routeId(context));
    const input = patchSchema.parse(await readJSON(request, 32 * 1024));
    if(input.contextIds||input.model||input.effort)assertFeature(viewer,chat.kind==='tutor'?'tutor':'chat');
    if (['submitted', 'streaming'].includes(chat.generationState) && ('contextIds' in input || 'model' in input || 'effort' in input)) {
      throw new AccessError(409, 'Остановите ответ перед изменением модели или материалов.');
    }
    return json({ chat: updateChat(chat.id, viewer.id, input,visibleMaterials(viewer)) });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const viewer = requireViewer(request); assertSameOrigin(request);
    const chat = authorizeChat(viewer, await routeId(context));
    if (['submitted', 'streaming'].includes(chat.generationState)) throw new AccessError(409, 'Остановите ответ перед удалением беседы.');
    deleteChat(chat.id, viewer.id); return json({ deleted: true });
  } catch (error) { return apiError(error); }
}
