import { cookies } from 'next/headers';
import { z } from 'zod';
import { jsonError, readJson } from '@/server/admin';
import { adminAuth } from '@/server/firebase';
import { recordActiveUser, recordLogin } from '@/server/metrics';
import { currentUser, SESSION_COOKIE, SESSION_MAX_AGE, syncUserOnLogin } from '@/server/users';

export const dynamic = 'force-dynamic';

/** Current profile (null when signed out). */
export async function GET() {
  return Response.json({ user: await currentUser() });
}

/** Exchange a fresh Firebase ID token for an httpOnly session cookie; creates the Firestore profile. */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = z.object({ idToken: z.string().min(1).max(4096), displayName: z.string().trim().max(64).optional() }).safeParse(body);
  if (!parsed.success) return jsonError(422, 'Dữ liệu không hợp lệ');
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(parsed.data.idToken, true);
  } catch (e) {
    // Only token problems are the client's fault; anything else (e.g. missing service account) is server config.
    if ((e as { code?: string })?.code?.startsWith('auth/')) return jsonError(401, 'Phiên đăng nhập không hợp lệ');
    console.error('verifyIdToken:', e);
    return jsonError(500, 'Máy chủ chưa cấu hình Firebase Admin (FIREBASE_SERVICE_ACCOUNT)');
  }
  const user = await syncUserOnLogin(decoded, parsed.data.displayName);
  if (user.disabled) return jsonError(403, 'Tài khoản đã bị khoá');
  const cookie = await adminAuth().createSessionCookie(parsed.data.idToken, { expiresIn: SESSION_MAX_AGE * 1000 });
  recordLogin();
  recordActiveUser(user.uid);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return Response.json({ user });
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
