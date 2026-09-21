// Upload/remove a custom .glb/.gltf override for one asset (static-rig kinds: baked;
// SKINNED_GLB_KINDS: kept skeletal, the file's animation clips play in battle;
// RIGID_GLB_KINDS: baked rigid but keep body motion + saddle).
import { assetSchema, RIG_OF_KIND, RIGID_GLB_KINDS, SKINNED_GLB_KINDS, type AssetDef } from '@/shared/schema';
import { getDoc, putDoc } from '@/server/content';
import { checkRefs, guard, issuesOf, jsonError, unsupportedOnVercel } from '@/server/admin';
import { deleteAssetGlb, saveAssetGlb } from '@/server/assetUploads';

type Ctx = { params: Promise<{ id: string }> };

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request, ctx: Ctx) {
  const denied = unsupportedOnVercel() ?? (await guard());
  if (denied) return denied;
  const { id } = await ctx.params;
  const doc = (await getDoc('assets', id)) as AssetDef | null;
  if (!doc) return jsonError(404, 'Không tìm thấy asset');
  if (RIG_OF_KIND[doc.kind] !== 'static' && !(SKINNED_GLB_KINDS as readonly string[]).includes(doc.kind) && !(RIGID_GLB_KINDS as readonly string[]).includes(doc.kind))
    return jsonError(422, `Asset loại ${doc.kind} cần hoạt hình (rig ${RIG_OF_KIND[doc.kind]}), không nhận glb upload`);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(415, 'Cần multipart/form-data');
  }
  const file = form.get('file');
  if (!(file instanceof File)) return jsonError(400, 'Thiếu file');
  const ext = /\.(glb|gltf)$/i.exec(file.name)?.[0]?.toLowerCase();
  if (!ext) return jsonError(422, 'Chỉ nhận .glb hoặc .gltf');
  if (file.size > MAX_BYTES) return jsonError(413, `File quá lớn (tối đa ${MAX_BYTES / (1024 * 1024)}MB)`);
  const buf = Buffer.from(await file.arrayBuffer());
  if (ext === '.glb' && buf.toString('ascii', 0, 4) !== 'glTF') return jsonError(422, 'File .glb không hợp lệ');

  const { url, fileName } = await saveAssetGlb(id, ext, buf);
  const updated: AssetDef = { ...doc, glb: { url, fileName: file.name, uploadedAt: Date.now(), tint: {}, hide: [] }, sculpt: null };
  const parsed = assetSchema.safeParse(updated);
  if (!parsed.success) {
    await deleteAssetGlb(url);
    return jsonError(422, 'Dữ liệu không hợp lệ', issuesOf(parsed.error));
  }
  const refs = await checkRefs('assets', parsed.data);
  if (refs.length) {
    await deleteAssetGlb(url);
    return jsonError(422, 'Tham chiếu không hợp lệ', refs);
  }
  await putDoc('assets', parsed.data);
  // Old file (previous upload, if any) is no longer referenced by any doc — drop it to save disk.
  if (doc.glb && doc.glb.url !== url) await deleteAssetGlb(doc.glb.url);
  return Response.json(parsed.data);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await ctx.params;
  const doc = (await getDoc('assets', id)) as AssetDef | null;
  if (!doc) return jsonError(404, 'Không tìm thấy asset');
  if (!doc.glb) return Response.json(doc);
  const updated: AssetDef = { ...doc, glb: null };
  await putDoc('assets', updated);
  await deleteAssetGlb(doc.glb.url);
  return Response.json(updated);
}
