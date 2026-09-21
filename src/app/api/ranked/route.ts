// Ranked lobby data for the signed-in player, and a season's leaderboard (?board=<season id>).
import { idSchema } from '@/shared/schema';
import { jsonError } from '@/server/admin';
import { leaderboard, rankView } from '@/server/ranked';
import { currentUser } from '@/server/users';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return jsonError(401, 'Cần đăng nhập');
  const board = new URL(req.url).searchParams.get('board');
  try {
    if (board !== null) {
      if (!idSchema.safeParse(board).success) return jsonError(422, 'Mùa không hợp lệ');
      return Response.json(await leaderboard(board, user.uid));
    }
    return Response.json(await rankView(user));
  } catch (e) {
    console.error('ranked:', e);
    return jsonError(503, 'Chưa kết nối được máy chủ dữ liệu, thử lại sau');
  }
}
