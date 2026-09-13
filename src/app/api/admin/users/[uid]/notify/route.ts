import { notifySchema } from '@/shared/users';
import { issuesOf, jsonError, readJson, requireCms } from '@/server/admin';
import { messaging } from '@/server/firebase';
import { firebaseErrorResponse } from '@/server/userAdmin';
import { getUser, removeFcmTokens } from '@/server/users';

type Ctx = { params: Promise<{ uid: string }> };

const DEAD_TOKEN = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

/** Push a notification to every device of the user; prunes dead tokens. */
export async function POST(req: Request, ctx: Ctx) {
  const actor = await requireCms();
  if (actor instanceof Response) return actor;
  const user = await getUser((await ctx.params).uid);
  if (!user) return jsonError(404, 'Không tìm thấy người dùng');
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = notifySchema.safeParse(body);
  if (!parsed.success) return jsonError(422, 'Dữ liệu không hợp lệ', issuesOf(parsed.error));
  if (!user.fcmTokens.length) return jsonError(422, 'Người dùng chưa có thiết bị nhận thông báo (FCM token)');
  try {
    const res = await messaging().sendEachForMulticast({
      tokens: user.fcmTokens,
      notification: { title: parsed.data.title, body: parsed.data.body || undefined },
    });
    const dead = res.responses.flatMap((r, i) => (r.error && DEAD_TOKEN.has(r.error.code) ? [user.fcmTokens[i]] : []));
    await removeFcmTokens(user.uid, dead);
    return Response.json({ sent: res.successCount, failed: res.failureCount, removed: dead.length });
  } catch (e) {
    return firebaseErrorResponse(e);
  }
}
