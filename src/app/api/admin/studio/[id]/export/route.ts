// Downloads a version as a standalone TypeScript factory (kit + construction code).
import fs from 'node:fs/promises';
import path from 'node:path';
import { factoryName, generateFactorySource } from '@/game/sculpt/codegen';
import { guard, jsonError } from '@/server/admin';
import { getVersion } from '@/server/studio/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await ctx.params;
  const n = Number(new URL(req.url).searchParams.get('v'));
  const version = Number.isInteger(n) ? getVersion(id, n) : null;
  if (!version) return jsonError(404, 'Không tìm thấy version');
  const kit = await fs.readFile(path.join(process.cwd(), 'src/game/sculpt/kit.ts'), 'utf8');
  const source = generateFactorySource(version.spec, kit, { studioId: id, version: version.n });
  return new Response(source, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${factoryName(version.spec)}.ts"`,
      'cache-control': 'no-store',
    },
  });
}
