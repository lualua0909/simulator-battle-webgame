// Export / import / reset the whole content bundle.
import { z } from 'zod';
import { COLLECTIONS, COLLECTION_SCHEMAS, settingsSchema, type CollectionDocs, type CollectionName, type ContentBundle } from '@/shared/schema';
import { mergeDefaults } from '@/shared/merge';
import { SEED } from '@/shared/seed';
import { findRefIssues } from '@/shared/validate';
import { getContent, putDoc, putSettings, replaceContent } from '@/server/content';
import { guard, issuesOf, jsonError, readJson } from '@/server/admin';

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  return new Response(JSON.stringify(await getContent(), null, 2), {
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
  await replaceContent(content);
  return Response.json({ ok: true });
}

async function putAdded<K extends CollectionName>(content: ContentBundle, collection: K, id: string): Promise<void> {
  const doc = (content[collection] as CollectionDocs[K][]).find((d) => d.id === id);
  if (doc) await putDoc(collection, doc);
}

const mergeSchema = z.object({ action: z.literal('merge'), docs: z.array(z.string().max(120)).max(2000), skills: z.boolean(), prices: z.boolean().default(false) });

/**
 * { action: "reset" } restores the built-in default content.
 * { action: "merge", docs, skills, prices } adds picked default documents the database lacks, keeping everything else.
 */
export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const action = (body as { action?: string })?.action;
  if (action === 'reset') {
    await replaceContent(SEED);
    return Response.json({ ok: true });
  }
  const merge = mergeSchema.safeParse(body);
  if (!merge.success) return jsonError(400, 'Hành động không hỗ trợ');
  const r = mergeDefaults(await getContent(), SEED, merge.data);
  for (const { collection, id } of r.added) await putAdded(r.content, collection, id);
  for (const id of new Set([...r.skilled, ...r.priced])) await putDoc('units', r.content.units.find((u) => u.id === id)!);
  if (r.settings) await putSettings(r.content.settings);
  return Response.json({ ok: true, added: r.added.length, skilled: r.skilled.length, priced: r.priced.length, settings: r.settings, skipped: r.skipped });
}
