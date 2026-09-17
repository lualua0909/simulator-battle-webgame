// Ví nạp xu của người chơi: xem cấu hình ngân hàng + tạo đơn pending (QR VietQR động theo đơn).
import { EconomyError } from '@/shared/economy';
import { createTopupSchema, TOPUP_BANK, TOPUP_PACKAGES } from '@/shared/topup';
import { jsonError, readJson } from '@/server/admin';
import { createTopup, getMyPendingTopup, listMyTopups } from '@/server/topups';
import { currentUser } from '@/server/users';

export const dynamic = 'force-dynamic';

/** `{ bank, packages, pending, orders }` — chưa đăng nhập thì orders/pending là null. */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ bank: TOPUP_BANK, packages: TOPUP_PACKAGES, pending: null, orders: [] });
  try {
    const [pending, orders] = await Promise.all([getMyPendingTopup(user.uid), listMyTopups(user.uid)]);
    return Response.json({ bank: TOPUP_BANK, packages: TOPUP_PACKAGES, pending, orders });
  } catch (e) {
    console.error('topup GET:', e);
    return jsonError(503, 'Chưa tải được đơn nạp, thử lại sau');
  }
}

/** `{ packageIndex }` → tạo đơn pending mới (luôn tạo đơn mới để có nội dung CK duy nhất). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return jsonError(401, 'Cần đăng nhập để nạp xu');
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = createTopupSchema.safeParse(body);
  if (!parsed.success) return jsonError(422, 'Gói nạp không hợp lệ');
  try {
    const order = await createTopup(user.uid, user.email, user.displayName, parsed.data.packageIndex);
    return Response.json({ order }, { status: 201 });
  } catch (e) {
    if (e instanceof EconomyError) return jsonError(409, e.message);
    console.error('topup POST:', e);
    return jsonError(503, 'Chưa tạo được đơn nạp, thử lại sau');
  }
}
