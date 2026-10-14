import { readFile } from 'node:fs/promises';
import { apiError, authorizeFeedback, routeId } from '@/lib/api';
import { AccessError, requireViewer } from '@/lib/auth';
import { getFeedbackAttachment } from '@/lib/db';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const viewer = requireViewer(request), item = authorizeFeedback(viewer, await routeId(context));
    const attachment = getFeedbackAttachment(item.id, viewer.id);
    if (!attachment) throw new AccessError(404, 'Вложение не найдено.');
    const bytes = await readFile(attachment.path);
    return new Response(bytes, { headers: {
      'Content-Type': attachment.mimeType,
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `attachment; filename="screenshot"; filename*=UTF-8''${encodeURIComponent(attachment.filename).replace(/'/g, '%27')}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    } });
  } catch (error) { return apiError(error); }
}
