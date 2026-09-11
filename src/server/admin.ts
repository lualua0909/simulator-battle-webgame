// Shared guards/helpers for admin route handlers.
import { cookies } from 'next/headers';
import type { CollectionDocs, CollectionName } from '@/shared/schema';
import { findRefIssues } from '@/shared/validate';
import { adminPassword, SESSION_COOKIE, verifySession } from './auth';
import { getContent } from './db';

/** Reference issues a create/update of this document would introduce. */
export function checkRefs(collection: CollectionName, doc: CollectionDocs[CollectionName]): Array<{ path: string; message: string }> {
  const content = getContent();
  const list = content[collection] as Array<{ id: string }>;
  (content as unknown as Record<string, unknown>)[collection] = [...list.filter((d) => d.id !== doc.id), doc];
  return findRefIssues(content)
    .filter((i) => i.source === collection && i.id === doc.id)
    .map((i) => ({ path: i.field, message: i.message }));
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

export function jsonError(status: number, error: string, details?: unknown): Response {
  return Response.json({ error, details }, { status });
}

/** null when the request may proceed; otherwise the error response to return. */
export async function guard(): Promise<Response | null> {
  if (!adminPassword()) return jsonError(503, 'Admin đang khóa: hãy đặt biến môi trường ADMIN_PASSWORD');
  if (!(await isAdmin())) return jsonError(401, 'Chưa đăng nhập');
  return null;
}

/** JSON body; mutations must be JSON (blocks cross-site form posts). */
export async function readJson(req: Request): Promise<unknown | Response> {
  if (!req.headers.get('content-type')?.includes('application/json')) return jsonError(415, 'Cần Content-Type: application/json');
  try {
    return await req.json();
  } catch {
    return jsonError(400, 'JSON không hợp lệ');
  }
}

export function issuesOf(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): Array<{ path: string; message: string }> {
  return error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
}
