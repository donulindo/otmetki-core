import { z } from 'zod';
import { apiError, authorizeChat, authorizeMaterial, json, readJSON } from '@/lib/api';
import { AccessError, assertSameOrigin, rateLimit, requireViewer } from '@/lib/auth';
import { createFeedback, listFeedback } from '@/lib/db';
import { parseBoundedFormData, removePrivateUpload, savePrivateUpload } from '@/lib/files';

import {assertFeature} from '@/lib/platform';
export const runtime = 'nodejs';
const schema = z.object({
  subject: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(10000),
  targetType: z.enum(['general', 'material', 'chat']).default('general'),
  targetId: z.string().min(1).max(100).nullable().optional(),
  targetVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  attachmentText: z.string().trim().max(100000).optional(),
  attachmentConsent: z.boolean().optional(),
}).strict();

export async function GET(request: Request) {
  try { const viewer = requireViewer(request); return json({ feedback: listFeedback(viewer.id) }); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  let savedPath: string | undefined;
  try {
    const viewer = requireViewer(request); assertSameOrigin(request);assertFeature(viewer,'feedback');
    rateLimit(`feedback.create:${viewer.id}`, 30, 60 * 60 * 1000);
    let raw: unknown, screenshot: File | undefined;
    if (request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
      const form = await parseBoundedFormData(request, 41 * 1024 * 1024);
      const fields: Record<string, unknown> = {};
      for (const [key, value] of form) {
        if (key in fields || (key === 'screenshot' && screenshot)) throw new AccessError(400, 'Поле указано несколько раз.');
        if (key === 'screenshot') {
          if (typeof value === 'string') throw new AccessError(400, 'Добавьте изображение скриншота.');
          screenshot = value;
        } else {
          if (typeof value !== 'string') throw new AccessError(400, 'Неверное поле обращения.');
          fields[key] = key === 'targetVersion' ? Number(value) : key === 'attachmentConsent' ? value === 'true' : value;
        }
      }
      raw = fields;
    } else raw = await readJSON(request, 512 * 1024);
    const input = schema.parse(raw);
    if ((input.attachmentText || screenshot) && input.attachmentConsent !== true) throw new AccessError(400, 'Подтвердите отправку выбранного контекста.');
    if (input.targetType === 'general' && (input.targetId || input.targetVersion != null)) throw new AccessError(400, 'Проверьте место обращения.');
    if (input.targetType === 'material') {
      const material = authorizeMaterial(viewer, input.targetId || '');
      if (input.targetVersion && input.targetVersion > material.version) throw new AccessError(400, 'Проверьте версию материала.');
      input.targetVersion ??= material.version;
    } else if (input.targetType === 'chat') {
      authorizeChat(viewer, input.targetId || '');
      if (input.targetVersion != null) throw new AccessError(400, 'У беседы нет версии материала.');
    }
    let attachment: { attachmentFilename: string; attachmentPath: string; attachmentMime: string } | undefined;
    if (screenshot) {
      const file = await savePrivateUpload(screenshot, 'feedback', true); savedPath = file.filePath;
      attachment = { attachmentFilename: file.filename, attachmentPath: file.filePath, attachmentMime: file.mimeType };
    }
    const item = createFeedback(viewer.id, { ...input, ...attachment },true);
    savedPath = undefined;
    return json({ feedback: item }, 201);
  } catch (error) {
    if (savedPath) await removePrivateUpload(savedPath).catch(() => {});
    return apiError(error);
  }
}
