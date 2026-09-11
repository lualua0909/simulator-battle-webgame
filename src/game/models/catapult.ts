// Low-poly mangonel (catapult rig): wheel pivots, throwing-arm pivot, ammo part.
import type * as THREE from 'three';
import type { CatapultParams } from '@/shared/schema';
import { ball, beam, box, cyl, detail, faceColors, jitter, mesh, metal, modelRoot, part, shade } from './common';

export function createCatapultModel(p: CatapultParams): THREE.Group {
  const root = modelRoot('catapult', 'catapult');
  const base = part('base', [0, 0.45, 0]);
  root.add(base);
  const dark = shade(p.wood, 0.75);

  for (const s of [1, -1]) {
    base.add(mesh(`rail-${s}`, box(0.16, 0.16, 2.6), p.wood, [0.55 * s, 0, 0]));
    base.add(mesh(`upright-front-${s}`, beam([0.55 * s, 0, 0.75], [0.5 * s, 0.85, 0.3], 0.07, 0.06, 4), dark));
    base.add(mesh(`upright-back-${s}`, beam([0.55 * s, 0, -0.2], [0.5 * s, 0.85, 0.25], 0.07, 0.06, 4), dark));
  }
  for (const z of [1.15, 0.2, -1.15]) base.add(mesh(`crossbeam-${z}`, box(1.26, 0.12, 0.12), dark, [0, 0.02, z]));
  base.add(mesh('stop-bar', box(1.2, 0.14, 0.14), p.wood, [0, 0.9, 0.34]));
  base.add(detail(mesh('stop-pad', box(0.5, 0.1, 0.12), p.rope, [0, 0.9, 0.24])));
  base.add(metal('axle', cyl(0.06, 0.06, 1.25, 6), p.metal, [0, 0.28, 0.2], [0, 0, Math.PI / 2]));
  base.add(mesh('torsion-rope', cyl(0.15, 0.15, 0.7, 7), p.rope, [0, 0.28, 0.2], [0, 0, Math.PI / 2]));

  for (const [key, z] of [['F', 0.9], ['B', -0.9]] as const) {
    for (const s of [1, -1] as const) {
      const side = s > 0 ? 'L' : 'R';
      const wheel = part(`wheel${key}${side}`, [0.72 * s, 0, z]);
      wheel.add(mesh(`wheel-${key}${side}`, cyl(0.45, 0.45, 0.1, 9), p.wood, [0, 0, 0], [0, 0, Math.PI / 2]));
      wheel.add(detail(metal(`hub-${key}${side}`, cyl(0.1, 0.1, 0.16, 6), p.metal, [0, 0, 0], [0, 0, Math.PI / 2])));
      wheel.add(detail(mesh(`spoke-${key}${side}`, box(0.06, 0.8, 0.06), dark)));
      wheel.add(detail(mesh(`spoke2-${key}${side}`, box(0.06, 0.06, 0.8), dark)));
      base.add(wheel);
    }
  }

  const arm = part('arm', [0, 0.28, 0.2]);
  arm.add(mesh('arm-beam', beam([0, 0, 0.15], [0, 0.22, -1.55], 0.08, 0.06, 5), p.wood));
  arm.add(mesh('bucket', box(0.42, 0.14, 0.42), dark, [0, 0.26, -1.7]));
  arm.add(detail(mesh('bucket-lip', box(0.46, 0.08, 0.06), p.wood, [0, 0.34, -1.5])));
  base.add(arm);
  const ammo = part('ammo', [0, 0.46, -1.7]);
  ammo.add(mesh('ammo-stone', faceColors(jitter(ball(0.24, 1), 0.08, 7), '#8d8a84', '#6a675f', 7), '#8d8a84'));
  arm.add(ammo);
  return root;
}
