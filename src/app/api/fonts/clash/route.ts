// The game font, read from data/Clash_Regular.otf.ttf on each request. Replacing the file (e.g. with a
// build that has Vietnamese letters) needs no rebuild; while it is missing the game falls back to
// Paytone One (see globals.css) instead of failing.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

const FONT_FILE = path.join(process.cwd(), 'data', 'Clash_Regular.otf.ttf');

export async function GET(req: Request) {
  const info = await stat(FONT_FILE).catch(() => null);
  if (!info) return new Response('Font not found', { status: 404 });
  const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
  const headers = { etag, 'cache-control': 'public, max-age=3600, must-revalidate' };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  const data = await readFile(FONT_FILE);
  // CFF-flavoured OpenType starts with "OTTO"; anything else is served as TrueType.
  const type = data.subarray(0, 4).toString('latin1') === 'OTTO' ? 'font/otf' : 'font/ttf';
  return new Response(new Uint8Array(data), { headers: { ...headers, 'content-type': type } });
}
