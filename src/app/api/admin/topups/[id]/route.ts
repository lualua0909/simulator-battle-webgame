// CMS: duyệt / huỷ một đơn nạp. Duyệt = cộng xu cho user trong cùng transaction.
import { EconomyError } from '@/shared/economy';
import { decideTopupSchema } from '@/shared/topup';
import { issuesOf, jsonError, readJson, requireCms } from '@/server/admin';
import { cancelTopup, confirmTopup } from '@/server/topups';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const actor = await requireCms();
  if (actor instanceof Response) return actor;
  const { id } = await ctx.params;
  if (!id) return jsonError(422, 'Thiếu id đơn nạp');
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = decideTopupSchema.safeParse(body);
  if (!parsed.success) return jsonError(422, 'Dữ liệu không hợp lệ', issuesOf(parsed.error));
  try {
    const order =
      parsed.data.action === 'confirm' ? await confirmTopup(id, actor.uid, parsed.data.note) : await cancelTopup(id, actor.uid, parsed.data.note);
    return Response.json({ order });
  } catch (e) {
    if (e instanceof EconomyError) return jsonError(409, e.message);
    console.error('admin topup decide:', e);
    return jsonError(503, 'Không xử lý được đơn nạp');
  }
}
