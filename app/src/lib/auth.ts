import 'server-only';
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { getDB, now, recordAudit } from './db';
import type { Viewer } from './types';
import {confirmedViewer,confirmedTelegramIds,viewerForTelegram} from './platform';

export const SESSION_COOKIE = 'otmetki_preview';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
export class AccessError extends Error { constructor(public status = 401, message = 'Доступ только владельцу предпросмотра.') { super(message); } }
export function ownerViewer(): Viewer { return { id: 'preview-owner', displayName: process.env.PREVIEW_OWNER_DISPLAY_NAME || 'Владелец', group: process.env.PREVIEW_OWNER_GROUP || 'M104', role: 'owner' }; }
export function sha256(value: string) { return createHash('sha256').update(value).digest('hex'); }
let cachedKey: { secret: string; salt: Buffer; hash: Buffer } | undefined;
export function verifyAccessKey(candidate: string): boolean {
  const secret = process.env.PREVIEW_ACCESS_KEY;
  if (!secret || secret.length < 24 || candidate.length > 1024) return false;
  if (!cachedKey || cachedKey.secret !== secret) { const salt = randomBytes(32); cachedKey = { secret, salt, hash: scryptSync(secret, salt, 32) }; }
  const hash = scryptSync(candidate, cachedKey.salt, 32);
  return timingSafeEqual(hash, cachedKey.hash);
}
export function botToken() { return process.env.PREVIEW_BOT_TOKEN || process.env.PREVIEW_TELEGRAM_BOT_TOKEN || ''; }
export function allowedTelegramIds() { const owners=(process.env.PREVIEW_OWNER_TELEGRAM_IDS || '').split(/[\s,]+/).filter(id => /^\d+$/.test(id));return process.env.PREVIEW_ENABLE_PARTICIPANTS==='true'?[...new Set([...owners,...confirmedTelegramIds()])]:owners; }
export function telegramConfigured() { return Boolean(botToken() && allowedTelegramIds().length); }
/** Validation follows Telegram WebApp initData HMAC; signed name never authorizes access. */
export function verifyTelegramInitData(initData: string, token: string, allowedIds: string[], currentTime = Math.floor(Date.now() / 1000)): { id: string } | null {
  if (!token || !allowedIds.length || initData.length > 16_384) return null;
  const params = new URLSearchParams(initData), seen = new Set<string>();
  for (const [key] of params) { if (seen.has(key)) return null; seen.add(key); }
  const hash = params.get('hash'); if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  const authDate = params.get('auth_date'); if (!authDate || !/^\d+$/.test(authDate)) return null;
  const issued = Number(authDate); if (!Number.isSafeInteger(issued) || issued > currentTime + 30 || currentTime - issued > 300) return null;
  const check = [...params].filter(([key]) => key !== 'hash').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;
  try {
    const user = JSON.parse(params.get('user') || '{}');
    if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id < 1) return null;
    const id = String(user.id); return allowedIds.includes(id) ? { id } : null;
  } catch { return null; }
}
export function createSession(userId=ownerViewer().id): string {
  const token = randomBytes(32).toString('base64url');
  getDB().prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
  if(userId!==ownerViewer().id&&(!confirmedViewer(userId)||process.env.PREVIEW_ENABLE_PARTICIPANTS!=='true'))throw new AccessError();
  getDB().prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sha256(token), userId, Date.now() + SESSION_TTL_SECONDS * 1000, now());
  return token;
}
export function viewerForToken(token: string | undefined): Viewer | null {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = getDB().prepare('SELECT owner_id FROM sessions WHERE token_hash=? AND expires_at>?').get(sha256(token), Date.now()) as { owner_id: string } | undefined;
  return session?.owner_id === ownerViewer().id ? ownerViewer() : session&&process.env.PREVIEW_ENABLE_PARTICIPANTS==='true'?confirmedViewer(session.owner_id):null;
}
export function telegramViewer(telegramId:string){return (process.env.PREVIEW_OWNER_TELEGRAM_IDS||'').split(/[\s,]+/).includes(telegramId)?ownerViewer():process.env.PREVIEW_ENABLE_PARTICIPANTS==='true'?viewerForTelegram(telegramId):null;}
export function requestSessionToken(request: Request) { const values = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${SESSION_COOKIE}=`)); return values.length === 1 ? values[0].slice(SESSION_COOKIE.length + 1) : undefined; }
export function requireViewer(request: Request): Viewer { const viewer = viewerForToken(requestSessionToken(request)); if (!viewer) throw new AccessError(); return viewer; }
export function requireOwnerViewer(request:Request):Viewer {const v=requireViewer(request);if(v.role!=='owner')throw new AccessError(403,'Действие доступно владельцу.');return v;}
export async function getPageViewer(): Promise<Viewer | null> { const jar = await cookies(); const tokens = jar.getAll(SESSION_COOKIE); return tokens.length === 1 ? viewerForToken(tokens[0].value) : null; }
export function revokeSession(request: Request) { const token = requestSessionToken(request); if (token) getDB().prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token)); }
export function sessionCookie(token: string, request: Request, expires = false) {
  const secure = (process.env.PREVIEW_ORIGIN || process.env.PREVIEW_PUBLIC_ORIGIN || request.url).startsWith('https:');
  return `${SESSION_COOKIE}=${expires ? '' : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expires ? 0 : SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`;
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) throw new AccessError(403, 'Запрос отклонён.');
  const expected = new URL(process.env.PREVIEW_ORIGIN || process.env.PREVIEW_PUBLIC_ORIGIN || request.url).origin;
  if (!origin || origin !== expected) throw new AccessError(403, 'Запрос отклонён.');
}
export function rateLimit(bucket: string, max = 10, windowMs = 15 * 60 * 1000) {
  const db = getDB(), time = Date.now();
  const row = db.prepare('SELECT count,resets_at FROM auth_attempts WHERE bucket=?').get(bucket) as { count: number; resets_at: number } | undefined;
  if (row && row.resets_at > time && row.count >= max) throw new AccessError(429, 'Слишком много попыток. Попробуйте позже.');
  if (!row || row.resets_at <= time) db.prepare('INSERT INTO auth_attempts VALUES(?,?,?) ON CONFLICT(bucket) DO UPDATE SET count=1,resets_at=excluded.resets_at').run(bucket, 1, time + windowMs);
  else db.prepare('UPDATE auth_attempts SET count=count+1 WHERE bucket=?').run(bucket);
}
export function limitAuth(request: Request) {
  // In the local preview all clients share one trusted origin; no forwarded IP is trusted.
  rateLimit('auth:global', 60, 15 * 60 * 1000);
  rateLimit(`auth:${sha256(request.headers.get('user-agent') || 'local')}`, 12, 15 * 60 * 1000);
}
export function auditLogin(method: 'key' | 'telegram',userId=ownerViewer().id) { recordAudit(userId, 'session.created', 'session', userId, { method }); }
