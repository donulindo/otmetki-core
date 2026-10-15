import { z } from 'zod';
import { apiError, json, readJSON } from '@/lib/api';
import { assertSameOrigin, requireViewer } from '@/lib/auth';
import { createChat, listChats } from '@/lib/db';
import { recoverChatStates } from '@/lib/chat-runtime';
import {assertFeature,assertSubject,visibleMaterials} from '@/lib/platform';

export const runtime = 'nodejs';
const inputSchema = z.object({
  subjectId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(160).optional(),
  kind: z.enum(['work', 'tutor']).optional(),
  model: z.enum(['gpt-6.1-sol', 'gpt-6-luna']).optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  contextIds: z.array(z.string().min(1).max(100)).max(200).optional(),
}).strict();

export async function GET(request: Request) {
  try { const viewer = requireViewer(request); recoverChatStates(); return json({ chats: listChats(viewer.id) }); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const viewer = requireViewer(request); assertSameOrigin(request);
    const input = inputSchema.parse(await readJSON(request, 32 * 1024));
    assertFeature(viewer,input.kind==='tutor'?'tutor':'chat');assertSubject(viewer,input.subjectId);
    return json({ chat: createChat(viewer.id, input,visibleMaterials(viewer)) }, 201);
  } catch (error) { return apiError(error); }
}
