import { getBundle } from '@/server/db';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(getBundle(), { headers: { 'cache-control': 'no-store' } });
}
