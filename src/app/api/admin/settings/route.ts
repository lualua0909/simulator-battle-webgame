import { settingsSchema } from '@/shared/schema';
import { findRefIssues } from '@/shared/validate';
import { getContent, getSettings, putSettings } from '@/server/db';
import { guard, issuesOf, jsonError, readJson } from '@/server/admin';

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  return Response.json(getSettings());
}

export async function PUT(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) return jsonError(422, 'Dữ liệu không hợp lệ', issuesOf(parsed.error));
  const refs = findRefIssues({ ...getContent(), settings: parsed.data }).filter((i) => i.source === 'settings');
  if (refs.length) return jsonError(422, 'Tham chiếu không hợp lệ', refs.map((i) => ({ path: i.field, message: i.message })));
  putSettings(parsed.data);
  return Response.json(parsed.data);
}
