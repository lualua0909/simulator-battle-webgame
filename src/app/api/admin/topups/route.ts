// CMS: danh sách đơn nạp theo trạng thái + đếm 3 tab.
import { TOPUP_STATUSES, type TopupStatus } from '@/shared/topup';
import { jsonError, requireCms } from '@/server/admin';
import { countTopups, listTopups } from '@/server/topups';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await requireCms();
  if (actor instanceof Response) return actor;
  const status = new URL(req.url).searchParams.get('status') ?? 'pending';
  if (status !== 'all' && !(TOPUP_STATUSES as readonly string[]).includes(status)) return jsonError(422, 'Trạng thái không hợp lệ');
  try {
    const [orders, counts] = await Promise.all([listTopups(status as TopupStatus | 'all'), countTopups()]);
    return Response.json({ orders, counts });
  } catch (e) {
    console.error('admin topups:', e);
    return jsonError(503, 'Không đọc được đơn nạp');
  }
}
