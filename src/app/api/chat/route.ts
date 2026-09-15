// World chat: signed-in players post here; everyone reads `chat/world` live from Firestore.
import { chatPostSchema } from '@/shared/chat';
import { jsonError, readJson } from '@/server/admin';
import { ChatRateLimitError, postWorldMessage } from '@/server/chat';
import { currentUser } from '@/server/users';

export const dynamic = 'force-dynamic';

/** { text } → { message } */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return jsonError(401, 'Cần đăng nhập');
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = chatPostSchema.safeParse(body);
  if (!parsed.success) return jsonError(422, parsed.error.issues[0]?.message ?? 'Tin nhắn không hợp lệ');
  try {
    return Response.json({ message: await postWorldMessage(user, parsed.data.text) });
  } catch (e) {
    if (e instanceof ChatRateLimitError) return jsonError(429, e.message);
    console.error('chat:', e);
    return jsonError(503, 'Chưa gửi được tin nhắn, thử lại sau');
  }
}
