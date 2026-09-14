import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContentBundle } from './schema';
import { missingDefaults, mergeDefaults } from './merge';
import { SEED } from './seed';
import { findRefIssues } from './validate';

/** A database from before skills existed, with one admin edit. */
function oldDatabase(): ContentBundle {
  const skills = new Set(SEED.units.flatMap((u) => u.skillIds));
  const newUnits = new Set(['musketeer', 'wind-shaman', 'pyromancer', 'thunder-mage', 'storm-lord']);
  return {
    ...SEED,
    units: SEED.units.filter((u) => !newUnits.has(u.id)).map((u) => ({ ...u, skillIds: [], hp: u.id === 'wizard' ? 999 : u.hp, unlockCost: 0, cardPrice: 0 })),
    weapons: SEED.weapons.filter((w) => !skills.has(w.id) && w.id !== 'musket' && w.id !== 'zap'),
    settings: { ...SEED.settings, burnParticleId: null },
  };
}

const everything = (db: ContentBundle) => missingDefaults(db, SEED).docs.map((d) => `${d.collection}/${d.id}`);

test('lists the default documents, skills and settings a database lacks', () => {
  const missing = missingDefaults(oldDatabase(), SEED);
  assert.ok(missing.docs.some((d) => d.collection === 'weapons' && d.id === 'loc-xoay'));
  assert.ok(missing.docs.some((d) => d.collection === 'units' && d.id === 'storm-lord'));
  assert.ok(missing.unskilled.some((u) => u.id === 'wizard'));
  assert.ok(missing.unpriced.some((u) => u.id === 'dragon'));
  assert.deepEqual(missing.settings, ['burnParticleId']);
  assert.deepEqual(missingDefaults(SEED, SEED), { docs: [], unskilled: [], unpriced: [], settings: [] });
});

test('merging adds what was picked and keeps admin edits', () => {
  const db = oldDatabase();
  const r = mergeDefaults(db, SEED, { docs: everything(db), skills: true, prices: true });
  assert.deepEqual(findRefIssues(r.content), []);
  assert.deepEqual(missingDefaults(r.content, SEED), { docs: [], unskilled: [], unpriced: [], settings: [] });
  const wizard = r.content.units.find((u) => u.id === 'wizard')!;
  const defaultWizard = SEED.units.find((u) => u.id === 'wizard')!;
  assert.equal(wizard.hp, 999);
  assert.deepEqual(wizard.skillIds, ['thien-thach']);
  assert.equal(wizard.unlockCost, defaultWizard.unlockCost);
  assert.equal(wizard.cardPrice, defaultWizard.cardPrice);
  assert.ok(r.priced.includes('wizard'));
  assert.ok(r.settings);
  assert.deepEqual(r.skipped, []);
});

test('picked documents whose references are gone are skipped, with their dependents', () => {
  const db = oldDatabase();
  // The admin deleted the legendary faction; its new units must not come back dangling.
  const noLegends = { ...db, factions: db.factions.filter((f) => f.id !== 'huyen-thoai'), units: db.units.filter((u) => u.factionId !== 'huyen-thoai') };
  const picks = everything(noLegends).filter((key) => key !== 'factions/huyen-thoai');
  const r = mergeDefaults(noLegends, SEED, { docs: picks, skills: false, prices: false });
  assert.deepEqual(findRefIssues(r.content), []);
  assert.ok(r.skipped.includes('units/storm-lord'));
  assert.ok(!r.content.units.some((u) => u.id === 'storm-lord'));
  assert.ok(r.content.weapons.some((w) => w.id === 'bao-sam'), 'skills stay available');
  assert.deepEqual(r.skilled, []);
  assert.deepEqual(r.priced, []);
});
