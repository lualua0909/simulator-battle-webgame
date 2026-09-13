// CMS user-management helpers shared by /api/admin/users routes.
import { canManage, type AppUser } from '@/shared/users';
import { jsonError, requireCms } from './admin';
import { getUser } from './users';

const FIREBASE_ERRORS: Record<string, [number, string]> = {
  'auth/email-already-exists': [409, 'Email đã được dùng'],
  'auth/invalid-email': [422, 'Email không hợp lệ'],
  'auth/invalid-password': [422, 'Mật khẩu tối thiểu 6 ký tự'],
  'auth/user-not-found': [404, 'Không tìm thấy người dùng'],
};

export function firebaseErrorResponse(e: unknown): Response {
  const code = (e as { code?: string })?.code ?? '';
  const known = FIREBASE_ERRORS[code];
  if (known) return jsonError(known[0], known[1]);
  console.error('firebase-admin:', e);
  return jsonError(500, e instanceof Error ? e.message : 'Lỗi Firebase');
}

/** Acting root/admin plus a target they may manage, or the error response. */
export async function requireManageable(uid: string): Promise<{ actor: AppUser; target: AppUser } | Response> {
  const actor = await requireCms();
  if (actor instanceof Response) return actor;
  const target = await getUser(uid);
  if (!target) return jsonError(404, 'Không tìm thấy người dùng');
  if (!canManage(actor, target)) return jsonError(403, actor.uid === uid ? 'Không tự sửa tài khoản của mình trong CMS' : 'Không đủ quyền với người dùng này');
  return { actor, target };
}
