// Shared guards/helpers for admin route handlers.
import { IS_VERCEL } from '@/shared/deploy';
import type { CollectionDocs, CollectionName } from '@/shared/schema';
import { findRefIssues } from '@/shared/validate';
import { canAccessCms, type AppUser } from '@/shared/users';
import { getContent } from './content';
import { currentUser } from './users';

/** Reference issues a create/update of this document would introduce. */
export async function checkRefs(collection: CollectionName, doc: CollectionDocs[CollectionName]): Promise<Array<{ path: string; message: string }>> {
  const content = await getContent();
  const list = content[collection] as Array<{ id: string }>;
  (content as unknown as Record<string, unknown>)[collection] = [...list.filter((d) => d.id !== doc.id), doc];
  return findRefIssues(content)
    .filter((i) => i.source === collection && i.id === doc.id)
    .map((i) => ({ path: i.field, message: i.message }));
}

/** Signed-in root/admin, or null. */
export async function cmsUser(): Promise<AppUser | null> {
  const user = await currentUser();
  return canAccessCms(user) ? user : null;
}

export function jsonError(status: number, error: string, details?: unknown): Response {
  return Response.json({ error, details }, { status });
}

/** 404 for a feature Vercel cannot run (see IS_VERCEL); null elsewhere. */
export function unsupportedOnVercel(): Response | null {
  return IS_VERCEL ? jsonError(404, 'Tính năng không hỗ trợ khi deploy trên Vercel') : null;
}

/** The acting root/admin, or the error response to return. */
export async function requireCms(): Promise<AppUser | Response> {
  const user = await currentUser();
  if (!user) return jsonError(401, 'Chưa đăng nhập');
  if (!canAccessCms(user)) return jsonError(403, 'Chỉ root/admin được vào CMS');
  return user;
}

/** null when the request may proceed; otherwise the error response to return. */
export async function guard(): Promise<Response | null> {
  const user = await requireCms();
  return user instanceof Response ? user : null;
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
