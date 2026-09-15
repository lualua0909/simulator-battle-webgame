import { jsonError } from '@/server/admin';
import { currentUser, touchLastActive } from '@/server/users';

export const dynamic = 'force-dynamic';

/** Presence heartbeat from signed-in clients: stores the server time as the user's lastActiveAt. */
export async function POST() {
  const user = await currentUser();
  if (!user) return jsonError(401, 'Chưa đăng nhập');
  await touchLastActive(user.uid);
  return Response.json({ ok: true, at: Date.now() });
}
