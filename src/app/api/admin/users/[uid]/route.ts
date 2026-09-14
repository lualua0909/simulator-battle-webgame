import { FieldValue } from 'firebase-admin/firestore';
import { assignableRoles, updateUserSchema, USERS_COLLECTION } from '@/shared/users';
import { issuesOf, jsonError, readJson, requireCms } from '@/server/admin';
import { adminAuth, firestore } from '@/server/firebase';
import { deletePlayer } from '@/server/players';
import { firebaseErrorResponse, requireManageable } from '@/server/userAdmin';
import { getUser } from '@/server/users';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ uid: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const actor = await requireCms();
  if (actor instanceof Response) return actor;
  const user = await getUser((await ctx.params).uid);
  return user ? Response.json({ me: actor, user }) : jsonError(404, 'Không tìm thấy người dùng');
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { uid } = await ctx.params;
  const access = await requireManageable(uid);
  if (access instanceof Response) return access;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) return jsonError(422, 'Dữ liệu không hợp lệ', issuesOf(parsed.error));
  const input = parsed.data;
  if (input.role !== undefined && !assignableRoles(access.actor).includes(input.role)) {
    return jsonError(403, 'Không được cấp quyền này', [{ path: 'role', message: 'vượt quyền' }]);
  }
  try {
    const authChanges = {
      ...(input.email !== undefined && { email: input.email }),
      ...(input.password && { password: input.password }),
      ...(input.displayName !== undefined && { displayName: input.displayName || null }),
      ...(input.disabled !== undefined && { disabled: input.disabled }),
    };
    if (Object.keys(authChanges).length) await adminAuth().updateUser(uid, authChanges);
    await firestore()
      .collection(USERS_COLLECTION)
      .doc(uid)
      .update({
        ...(input.email !== undefined && { email: input.email.toLowerCase() }),
        ...(input.displayName !== undefined && { displayName: input.displayName || null }),
        ...(input.role !== undefined && { role: input.role }),
        ...(input.disabled !== undefined && { disabled: input.disabled }),
        updatedAt: FieldValue.serverTimestamp(),
      });
    // Kick existing sessions when access shrinks or credentials change.
    const demoted = input.role !== undefined && input.role > access.target.role;
    if (input.disabled || input.password || demoted) await adminAuth().revokeRefreshTokens(uid);
    return Response.json(await getUser(uid));
  } catch (e) {
    return firebaseErrorResponse(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { uid } = await ctx.params;
  const access = await requireManageable(uid);
  if (access instanceof Response) return access;
  try {
    await adminAuth()
      .deleteUser(uid)
      .catch((e: { code?: string }) => {
        if (e?.code !== 'auth/user-not-found') throw e;
      });
    await firestore().collection(USERS_COLLECTION).doc(uid).delete();
    await deletePlayer(uid);
    return Response.json({ ok: true });
  } catch (e) {
    return firebaseErrorResponse(e);
  }
}
