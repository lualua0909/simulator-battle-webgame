// A user's wallet and ledger for the CMS; root/admin add or remove coins (top-up by hand, refunds).
import { coinAdjustSchema, EconomyError } from '@/shared/economy';
import { issuesOf, jsonError, readJson, requireCms } from '@/server/admin';
import { adjustPlayerCoins, getPlayerView, listLedger } from '@/server/players';
import { requireManageable } from '@/server/userAdmin';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ uid: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const actor = await requireCms();
  if (actor instanceof Response) return actor;
  const { uid } = await ctx.params;
  try {
    const [view, ledger] = await Promise.all([getPlayerView(uid), listLedger(uid)]);
    return Response.json({ ...view, ledger });
  } catch (e) {
    if (e instanceof EconomyError) return jsonError(409, e.message);
    console.error('wallet:', e);
    return jsonError(503, 'Không đọc được ví người chơi');
  }
}

/** { delta, note }: the same rules as user management apply, so nobody changes their own coins. */
export async function POST(req: Request, ctx: Ctx) {
  const { uid } = await ctx.params;
  const access = await requireManageable(uid);
  if (access instanceof Response) return access;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = coinAdjustSchema.safeParse(body);
  if (!parsed.success) return jsonError(422, 'Dữ liệu không hợp lệ', issuesOf(parsed.error));
  try {
    const view = await adjustPlayerCoins(uid, parsed.data.delta, parsed.data.note, access.actor.uid);
    return Response.json({ ...view, ledger: await listLedger(uid) });
  } catch (e) {
    if (e instanceof EconomyError) return jsonError(409, e.message);
    console.error('wallet:', e);
    return jsonError(503, 'Không cập nhật được ví người chơi');
  }
}
