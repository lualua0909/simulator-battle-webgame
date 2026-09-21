// CMS: ranked battles flagged as possible win-trading (?reviewed=1 for the handled ones),
// marking one reviewed, and lifting a player's dispute lock.
import { z } from 'zod';
import { issuesOf, jsonError, readJson, requireCms, unsupportedOnVercel } from '@/server/admin';
import { clearDisputes, listFlags, reviewFlag } from '@/server/ranked';

export const dynamic = 'force-dynamic';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('review'), id: z.string().min(1).max(64) }),
  z.object({ action: z.literal('clear-disputes'), uid: z.string().min(1).max(128) }),
]);

export async function GET(req: Request) {
  const off = unsupportedOnVercel();
  if (off) return off;
  const actor = await requireCms();
  if (actor instanceof Response) return actor;
  try {
    return Response.json({ flags: await listFlags(new URL(req.url).searchParams.get('reviewed') === '1') });
  } catch (e) {
    console.error('admin ranked flags:', e);
    return jsonError(503, 'Không đọc được danh sách cờ');
  }
}

export async function POST(req: Request) {
  const off = unsupportedOnVercel();
  if (off) return off;
  const actor = await requireCms();
  if (actor instanceof Response) return actor;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return jsonError(422, 'Dữ liệu không hợp lệ', issuesOf(parsed.error));
  try {
    if (parsed.data.action === 'review') await reviewFlag(parsed.data.id, actor.uid);
    else await clearDisputes(parsed.data.uid);
    return Response.json({ ok: true });
  } catch (e) {
    console.error('admin ranked action:', e);
    return jsonError(503, 'Không thực hiện được');
  }
}
