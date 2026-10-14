import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { AccessError, requireViewer } from '@/lib/auth';
import { apiError, authorizeMaterial, routeId } from '@/lib/api';
import { getMaterialFile } from '@/lib/db';
import { contentDisposition } from '@/lib/files';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const viewer = requireViewer(request), id = await routeId(context), versionText = new URL(request.url).searchParams.get('version'), version = versionText === null ? undefined : z.coerce.number().int().positive().parse(versionText);
    const material=authorizeMaterial(viewer, id, version); const file = getMaterialFile(id, material.ownerId, version); if (!file) throw new AccessError(404, 'Исходный файл отсутствует.');
    const info = await stat(file.path);
    const inline = new URL(request.url).searchParams.get('download') !== '1' && (file.mimeType.startsWith('image/') || file.mimeType === 'application/pdf');
    const disposition = inline ? contentDisposition(file.filename).replace(/^attachment;/, 'inline;') : contentDisposition(file.filename);
    return new Response(Readable.toWeb(createReadStream(file.path)) as ReadableStream, { headers: { 'Content-Type': file.mimeType, 'Content-Length': String(info.size), 'Content-Disposition': disposition, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  } catch (error) { return apiError(error); }
}
