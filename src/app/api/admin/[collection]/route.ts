import { COLLECTION_SCHEMAS, isCollection, type CollectionDocs, type CollectionName } from '@/shared/schema';
import { getDoc, listDocs, putDoc } from '@/server/db';
import { checkRefs, guard, issuesOf, jsonError, readJson } from '@/server/admin';

type Ctx = { params: Promise<{ collection: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const denied = await guard();
  if (denied) return denied;
  const { collection } = await ctx.params;
  if (!isCollection(collection)) return jsonError(404, 'Không có collection này');
  return Response.json(listDocs(collection));
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = await guard();
  if (denied) return denied;
  const { collection } = await ctx.params;
  if (!isCollection(collection)) return jsonError(404, 'Không có collection này');
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = COLLECTION_SCHEMAS[collection].safeParse(body);
  if (!parsed.success) return jsonError(422, 'Dữ liệu không hợp lệ', issuesOf(parsed.error));
  const doc = parsed.data as CollectionDocs[CollectionName];
  if (getDoc(collection, doc.id)) return jsonError(409, `Đã tồn tại id "${doc.id}"`);
  const refs = checkRefs(collection, doc);
  if (refs.length) return jsonError(422, 'Tham chiếu không hợp lệ', refs);
  putDoc(collection, doc);
  return Response.json(doc, { status: 201 });
}
