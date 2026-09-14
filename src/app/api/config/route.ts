import { getBundle } from '@/server/content';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await getBundle(), { headers: { 'cache-control': 'no-store' } });
}
