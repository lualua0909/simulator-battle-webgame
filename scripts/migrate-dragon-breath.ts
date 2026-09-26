// Share the existing baby-dragon-breath settings across all dragon models.
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { firestore } = await import('../src/server/firebase');
  const db = firestore();
  const canonicalId = 'baby-dragon-breath';
  const retiredId = 'dragon-breath';
  const changed = await db.runTransaction(async (tx) => {
    const canonical = await tx.get(db.collection('weapons').doc(canonicalId));
    if (!canonical.exists) throw new Error(`Missing ${canonicalId}; refusing to remove the old skill.`);
    const assets = await tx.get(db.collection('assets'));
    const units = await tx.get(db.collection('units'));
    const dragons = new Set(assets.docs.filter((doc) => doc.data().kind === 'dragon').map((doc) => doc.id));
    const updated: string[] = [];
    for (const doc of units.docs) {
      const unit = doc.data();
      const weaponId = dragons.has(unit.modelId) || unit.weaponId === retiredId ? canonicalId : unit.weaponId;
      const skillIds = [...new Set((unit.skillIds ?? []).map((id: string) => id === retiredId ? canonicalId : id))];
      if (weaponId !== unit.weaponId || JSON.stringify(skillIds) !== JSON.stringify(unit.skillIds ?? [])) {
        tx.update(doc.ref, { weaponId, skillIds });
        updated.push(doc.id);
      }
    }
    tx.delete(db.collection('weapons').doc(retiredId));
    return updated;
  });
  console.log(`Dragon breath consolidated. Updated units: ${changed.join(', ') || 'already migrated'}`);
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
