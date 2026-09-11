// Export / import / reset the whole content bundle.
import { z } from 'zod';
import { COLLECTIONS, COLLECTION_SCHEMAS, settingsSchema, type ContentBundle } from '@/shared/schema';
import { SEED } from '@/shared/seed';
import { findRefIssues } from '@/shared/validate';
import { getContent, replaceContent } from '@/server/db';
import { guard, issuesOf, jsonError, readJson } from '@/server/admin';

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  return new Response(JSON.stringify(getContent(), null, 2), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="battle-content-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

const bundleSchema = z.object({
  ...Object.fromEntries(COLLECTIONS.map((c) => [c, z.array(COLLECTION_SCHEMAS[c])])),
  settings: settingsSchema,
});

export async function PUT(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = bundleSchema.safeParse(body);
  if (!parsed.success) return jsonError(422, 'File không hợp lệ', issuesOf(parsed.error).slice(0, 30));
  const content = parsed.data as unknown as ContentBundle;
  for (const c of COLLECTIONS) {
    const ids = new Set<string>();
    for (const d of content[c]) {
      if (ids.has(d.id)) return jsonError(422, `Trùng id ${c}/${d.id}`);
      ids.add(d.id);
    }
  }
  const refs = findRefIssues(content);
  if (refs.length) return jsonError(422, 'Tham chiếu không hợp lệ', refs.slice(0, 30));
  replaceContent(content);
  return Response.json({ ok: true });
}

/** { action: "reset" } restores the built-in default content. */
export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  if ((body as { action?: string })?.action !== 'reset') return jsonError(400, 'Hành động không hỗ trợ');
  replaceContent(SEED);
  return Response.json({ ok: true });
}
