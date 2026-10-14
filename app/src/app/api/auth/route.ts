import { z } from 'zod';
import { assertSameOrigin, auditLogin, botToken, allowedTelegramIds, createSession, limitAuth, revokeSession, sessionCookie, verifyAccessKey, verifyTelegramInitData, telegramViewer, AccessError } from '@/lib/auth';
import { apiError, json, readJSON } from '@/lib/api';
export const runtime = 'nodejs';
const input = z.object({ key: z.string().max(1024).optional(), passcode: z.string().max(1024).optional(), initData: z.string().max(16_384).optional(), method: z.enum(['key', 'telegram']).optional() });
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); limitAuth(request);
    const data = input.parse(await readJSON(request, 20_000));
    const method = data.initData !== undefined ? 'telegram' : 'key';
    const identity=method==='telegram'?verifyTelegramInitData(data.initData!,botToken(),allowedTelegramIds()):null;
    const valid = method === 'telegram' ? Boolean(identity) : verifyAccessKey(data.key || data.passcode || '');
    if (!valid) throw new AccessError(401, 'Не удалось подтвердить доступ владельца.');
    const user=identity?telegramViewer(identity.id):null;
    if(identity&&!user)throw new AccessError();
    const token = createSession(user?.id); auditLogin(method,user?.id);
    const response = json({ ok: true }); response.headers.set('Set-Cookie', sessionCookie(token, request)); return response;
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request) {
  try { assertSameOrigin(request); revokeSession(request); const response = json({ ok: true }); response.headers.set('Set-Cookie', sessionCookie('', request, true)); return response; } catch (error) { return apiError(error); }
}
