import { z } from 'zod';
import {assertFeature} from '@/lib/platform';
import { apiError, authorizeFeedback, json, readJSON, routeId } from '@/lib/api';
import { assertSameOrigin, rateLimit, requireViewer, AccessError } from '@/lib/auth';
import { addFeedbackMessage, setFeedbackStatus } from '@/lib/db';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
const statusSchema = z.object({ status: z.enum(['received', 'clarification', 'in_progress', 'resolved']) }).strict();
const messageSchema = z.object({ text: z.string().trim().min(1).max(10000), author: z.enum(['user', 'owner']).optional() }).strict();

export async function GET(request: Request, context: Context) {
  try { const viewer = requireViewer(request); return json({ feedback: authorizeFeedback(viewer, await routeId(context)) }); }
  catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const viewer = requireViewer(request); assertSameOrigin(request);assertFeature(viewer,'feedback');
    const item = authorizeFeedback(viewer, await routeId(context));
    const input = statusSchema.parse(await readJSON(request, 4096));
    return json({ feedback: setFeedbackStatus(item.id, viewer.id, input.status) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const viewer = requireViewer(request); assertSameOrigin(request);assertFeature(viewer,'feedback');
    const item = authorizeFeedback(viewer, await routeId(context));
    rateLimit(`feedback.reply:${viewer.id}`, 100, 60 * 60 * 1000);
    const input = messageSchema.parse(await readJSON(request, 48 * 1024));
    if(input.author==='owner'&&viewer.role!=='owner')throw new AccessError(403,'Ответ владельца недоступен.');
    return json({ feedback: addFeedbackMessage(item.id, viewer.id, input.text, input.author || 'user') }, 201);
  } catch (error) { return apiError(error); }
}
