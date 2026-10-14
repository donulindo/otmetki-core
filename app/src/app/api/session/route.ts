import {aiConfigured} from '@/lib/provider';
import { AccessError, requireViewer, telegramConfigured } from '@/lib/auth';
import { apiError, json } from '@/lib/api';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try { return json({ viewer: requireViewer(request), configured: { ai: aiConfigured(), telegram: telegramConfigured() }, models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, { id: 'gpt-6-luna', label: 'GPT-6 Luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }] }); } catch (error) {
    if (error instanceof AccessError && error.status === 401) {
      const username = process.env.PREVIEW_BOT_USERNAME || '';
      return json({ viewer: null, configured: { telegram: telegramConfigured() }, ...(/^[A-Za-z0-9_]+$/.test(username) ? { telegramBotUsername: username } : {}) }, 401);
    }
    return apiError(error);
  }
}
