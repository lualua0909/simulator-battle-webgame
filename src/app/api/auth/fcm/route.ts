import { z } from 'zod';
import { jsonError, readJson } from '@/server/admin';
import { addFcmToken, currentUser } from '@/server/users';

/** Stores this device's FCM registration token on the signed-in user. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return jsonError(401, 'Chưa đăng nhập');
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = z.object({ token: z.string().min(1).max(4096) }).safeParse(body);
  if (!parsed.success) return jsonError(422, 'Dữ liệu không hợp lệ');
  if (!user.fcmTokens.includes(parsed.data.token)) await addFcmToken(user.uid, parsed.data.token);
  return Response.json({ ok: true });
}
