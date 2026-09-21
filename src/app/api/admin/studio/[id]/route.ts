import { guard, jsonError, unsupportedOnVercel } from '@/server/admin';
import { isRunning } from '@/server/studio/pipeline';
import { deleteJob, getJobDetail } from '@/server/studio/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const denied = unsupportedOnVercel() ?? (await guard());
  if (denied) return denied;
  const { id } = await ctx.params;
  const job = getJobDetail(id);
  return job ? Response.json(job) : jsonError(404, 'Không tìm thấy job');
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const denied = unsupportedOnVercel() ?? (await guard());
  if (denied) return denied;
  const { id } = await ctx.params;
  if (isRunning(id)) return jsonError(409, 'Job đang chạy, hãy dừng trước khi xóa');
  return deleteJob(id) ? Response.json({ ok: true }) : jsonError(404, 'Không tìm thấy job');
}
