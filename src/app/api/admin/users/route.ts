import { FieldValue } from 'firebase-admin/firestore';
import { assignableRoles, createUserSchema, USERS_COLLECTION } from '@/shared/users';
import { issuesOf, jsonError, readJson, requireCms } from '@/server/admin';
import { adminAuth, firestore } from '@/server/firebase';
import { firebaseErrorResponse } from '@/server/userAdmin';
import { getUser, listUsers } from '@/server/users';

export const dynamic = 'force-dynamic';

export async function GET() {
  const actor = await requireCms();
  if (actor instanceof Response) return actor;
  return Response.json({ me: actor, users: await listUsers(), now: Date.now() });
}

export async function POST(req: Request) {
  const actor = await requireCms();
  if (actor instanceof Response) return actor;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) return jsonError(422, 'Dữ liệu không hợp lệ', issuesOf(parsed.error));
  const input = parsed.data;
  if (!assignableRoles(actor).includes(input.role)) return jsonError(403, 'Không được cấp quyền này', [{ path: 'role', message: 'vượt quyền' }]);
  try {
    const record = await adminAuth().createUser({
      email: input.email,
      password: input.password,
      displayName: input.displayName || undefined,
      disabled: input.disabled,
    });
    await firestore()
      .collection(USERS_COLLECTION)
      .doc(record.uid)
      .set({
        email: input.email.toLowerCase(),
        displayName: input.displayName || null,
        photoURL: null,
        providers: ['password'],
        role: input.role,
        disabled: input.disabled,
        fcmTokens: [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastLoginAt: null,
        lastActiveAt: null,
      });
    return Response.json(await getUser(record.uid), { status: 201 });
  } catch (e) {
    return firebaseErrorResponse(e);
  }
}
