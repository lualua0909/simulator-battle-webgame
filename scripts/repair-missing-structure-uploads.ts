import { loadEnvConfig } from '@next/env';
import { existsSync } from 'node:fs';
import path from 'node:path';

async function main() {
  loadEnvConfig(process.cwd());
  const { firestore } = await import('../src/server/firebase');
  const db = firestore();
  const updated = await db.runTransaction(async (tx) => {
    const refs = ['m-keep', 'm-wall'].map((id) => db.collection('assets').doc(id));
    const snapshots = await tx.getAll(...refs);
    const repaired: string[] = [];
    for (const doc of snapshots) {
      const asset = doc.data();
      const url = asset?.glb?.url;
      if (asset?.kind !== 'structure' || !['keep', 'wall'].includes(asset.params?.type)) continue;
      if (typeof url !== 'string' || !url.startsWith('/uploads/models/')) continue;
      const file = path.resolve('public', `.${url}`);
      const uploadRoot = path.resolve('public/uploads/models') + path.sep;
      if (!file.startsWith(uploadRoot) || existsSync(file)) continue;
      // Both kinds retain a procedural builder; removing the broken override
      // restores rendering without changing scale, colours or gameplay values.
      tx.update(doc.ref, { glb: null });
      repaired.push(doc.id);
    }
    return repaired;
  });
  console.log(`Cleared missing structure uploads: ${updated.join(', ') || 'none'}`);
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
