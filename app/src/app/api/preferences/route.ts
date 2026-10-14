import { z } from 'zod';
import { apiError, json, readJSON } from '@/lib/api';
import { assertSameOrigin, requireViewer } from '@/lib/auth';
import { getSettings, saveSettings } from '@/lib/db';

export const runtime = 'nodejs';
const settingsSchema = z.object({
  model: z.enum(['gpt-6.1-sol', 'gpt-6-luna']).optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
}).strict().refine(value => Object.keys(value).length > 0);

export async function GET(request: Request) {
  try { const viewer = requireViewer(request); return json(getSettings(viewer.id)); }
  catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const viewer = requireViewer(request); assertSameOrigin(request);
    const input = settingsSchema.parse(await readJSON(request, 4096));
    return json(saveSettings(viewer.id, { ...getSettings(viewer.id), ...input }));
  } catch (error) { return apiError(error); }
}
