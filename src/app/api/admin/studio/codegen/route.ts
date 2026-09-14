// Emits the standalone TypeScript factory of a sculpt spec (a studio version or an applied asset model).
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { factoryName, generateFactorySource } from '@/game/sculpt/codegen';
import { assetSculptSchema } from '@/shared/schema';
import { guard, issuesOf, jsonError, readJson } from '@/server/admin';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ spec: assetSculptSchema.shape.spec, studioId: z.string().max(64).default('models'), version: z.number().int().min(1).default(1) });

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError(422, 'Spec không hợp lệ', issuesOf(parsed.error));
  const { spec, studioId, version } = parsed.data;
  const kit = await fs.readFile(path.join(process.cwd(), 'src/game/sculpt/kit.ts'), 'utf8');
  const source = generateFactorySource(spec, kit, { studioId, version });
  return new Response(source, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${factoryName(spec)}.ts"`,
      'cache-control': 'no-store',
    },
  });
}
