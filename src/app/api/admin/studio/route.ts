import { z } from 'zod';
import { rigOfKind, SCULPT_KINDS } from '@/game/sculpt/rigs';
import { idSchema, RIG_OF_KIND } from '@/shared/schema';
import { IMAGE_DATA_URL } from '@/shared/studio';
import { guard, issuesOf, jsonError, readJson } from '@/server/admin';
import { getDoc } from '@/server/db';
import { engineStatus } from '@/server/studio/llm';
import { createJob, listJobs } from '@/server/studio/store';

export const dynamic = 'force-dynamic';

const createSchema = z
  .object({
    name: z.string().trim().min(1, 'bắt buộc').max(48),
    kind: z.enum(SCULPT_KINDS),
    baseAssetId: idSchema.nullable().default(null),
    prompt: z.string().max(4000).default(''),
    image: z.string().max(12_000_000).regex(IMAGE_DATA_URL, 'ảnh phải là PNG/JPEG/WebP/GIF').nullable().default(null),
    maxRounds: z.number().int().min(0).max(3).default(2),
  })
  .refine((b) => b.prompt.trim() || b.image, { message: 'Cần ảnh mẫu hoặc mô tả', path: ['prompt'] });

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  return Response.json({ engine: engineStatus(), jobs: listJobs() });
}

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError(422, 'Dữ liệu không hợp lệ', issuesOf(parsed.error));
  const input = parsed.data;
  if (input.baseAssetId) {
    const base = getDoc('assets', input.baseAssetId);
    if (!base) return jsonError(422, `Không có asset "${input.baseAssetId}"`);
    if (RIG_OF_KIND[base.kind] !== rigOfKind(input.kind)) return jsonError(422, `Asset "${base.id}" loại ${base.kind} không dùng được rig của loại ${input.kind}`);
  }
  return Response.json(createJob({ ...input, prompt: input.prompt.trim() }), { status: 201 });
}
