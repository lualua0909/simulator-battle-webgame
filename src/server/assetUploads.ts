// Disk storage for admin-uploaded .glb/.gltf asset overrides (no Firebase Storage wired up in
// this project; everything else the CMS persists is JSON in Firestore/SQLite, so a small local
// folder next to the other on-disk state is the simplest fit for a single-server deployment).
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'models');
const PUBLIC_PREFIX = '/uploads/models/';

/** Writes an uploaded model file for `assetId`, returning its public URL. Filename is timestamped so a browser/CDN never serves a stale cached copy after re-upload. */
export async function saveAssetGlb(assetId: string, ext: string, data: Buffer): Promise<{ url: string; fileName: string }> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const fileName = `${assetId}-${Date.now()}${ext}`;
  await writeFile(path.join(UPLOAD_DIR, fileName), data);
  return { url: PUBLIC_PREFIX + fileName, fileName };
}

/** Deletes a previously-uploaded model file by its public URL (no-op if missing or outside the upload folder). */
export async function deleteAssetGlb(url: string): Promise<void> {
  if (!url.startsWith(PUBLIC_PREFIX)) return;
  const name = url.slice(PUBLIC_PREFIX.length);
  if (!name || name.includes('/') || name.includes('..')) return;
  await unlink(path.join(UPLOAD_DIR, name)).catch(() => {});
}
