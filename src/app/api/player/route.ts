// The signed-in player's wallet (coins, cards, stars, unlocks, boxes) and every action that changes it.
import { EconomyError, playerActionSchema } from '@/shared/economy';
import { jsonError, readJson } from '@/server/admin';
import { getPlayerView, runPlayerAction } from '@/server/players';
import { currentUser } from '@/server/users';

export const dynamic = 'force-dynamic';

function failure(e: unknown): Response {
  if (e instanceof EconomyError) return jsonError(409, e.message);
  console.error('player:', e);
  return jsonError(503, 'Chưa kết nối được máy chủ dữ liệu, thử lại sau');
}

/** `{ player, boxes, now }`; player and boxes are null when signed out. `now` lets the client count down in server time. */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ player: null, boxes: null, now: Date.now() });
  try {
    return Response.json({ ...(await getPlayerView(user.uid)), now: Date.now() });
  } catch (e) {
    return failure(e);
  }
}

/** { action: "open-box", kind } | { action: "bot-win", botId, botCount } | { action: "unlock" | "upgrade", unitId } | { action: "buy-cards", unitId, count } */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return jsonError(401, 'Cần đăng nhập');
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = playerActionSchema.safeParse(body);
  if (!parsed.success) return jsonError(422, 'Yêu cầu không hợp lệ');
  try {
    return Response.json({ ...(await runPlayerAction(user.uid, parsed.data)), now: Date.now() });
  } catch (e) {
    return failure(e);
  }
}
