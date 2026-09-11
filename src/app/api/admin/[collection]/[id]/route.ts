import { COLLECTION_SCHEMAS, isCollection, type CollectionDocs, type CollectionName } from '@/shared/schema';
import { findDependents } from '@/shared/validate';
import { deleteDoc, getContent, getDoc, putDoc } from '@/server/db';
import { checkRefs, guard, issuesOf, jsonError, readJson } from '@/server/admin';

type Ctx = { params: Promise<{ collection: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const denied = await guard();
  if (denied) return denied;
  const { collection, id } = await ctx.params;
  if (!isCollection(collection)) return jsonError(404, 'Không có collection này');
  const doc = getDoc(collection, id);
  return doc ? Response.json(doc) : jsonError(404, 'Không tìm thấy');
}

export async function PUT(req: Request, ctx: Ctx) {
  const denied = await guard();
  if (denied) return denied;
  const { collection, id } = await ctx.params;
  if (!isCollection(collection)) return jsonError(404, 'Không có collection này');
  if (!getDoc(collection, id)) return jsonError(404, 'Không tìm thấy');
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = COLLECTION_SCHEMAS[collection].safeParse(body);
  if (!parsed.success) return jsonError(422, 'Dữ liệu không hợp lệ', issuesOf(parsed.error));
  const doc = parsed.data as CollectionDocs[CollectionName];
  if (doc.id !== id) return jsonError(422, 'Không đổi được id; hãy nhân bản rồi xóa bản cũ');
  const refs = checkRefs(collection, doc);
  if (refs.length) return jsonError(422, 'Tham chiếu không hợp lệ', refs);
  putDoc(collection, doc);
  return Response.json(doc);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const denied = await guard();
  if (denied) return denied;
  const { collection, id } = await ctx.params;
  if (!isCollection(collection)) return jsonError(404, 'Không có collection này');
  const content = getContent();
  const dependents = findDependents(content, collection, id);
  if (dependents.length) return jsonError(409, 'Đang được dùng bởi dữ liệu khác', dependents);
  if ((collection === 'maps' || collection === 'factions') && content[collection].length <= 1) return jsonError(409, 'Cần giữ lại ít nhất 1 mục');
  return deleteDoc(collection, id) ? Response.json({ ok: true }) : jsonError(404, 'Không tìm thấy');
}
