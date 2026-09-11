// Low-poly giant eagle (bird rig): two-segment wings with fanned primaries, tail fan.
import type * as THREE from 'three';
import type { BirdParams } from '@/shared/schema';
import { ball, beam, box, cone, detail, ell, mesh, modelRoot, part, shade } from './common';

export function createBirdModel(p: BirdParams): THREE.Group {
  const root = modelRoot('bird', 'bird');
  const body = part('body', [0, 0.6, 0]);
  root.add(body);
  body.add(mesh('body', ell(0.22, 0.22, 0.46), p.body));
  body.add(mesh('chest', ell(0.19, 0.19, 0.25), shade(p.body, 1.2), [0, -0.04, 0.2]));

  const head = part('head', [0, 0.12, 0.4]);
  head.add(mesh('head', ball(0.16, 1), p.head, [0, 0.05, 0.05]));
  head.add(mesh('beak', cone(0.065, 0.2, 5), p.beak, [0, 0.0, 0.25], [Math.PI / 2 + 0.35, 0, 0]));
  head.add(detail(mesh('beak-hook', cone(0.035, 0.08, 4), shade(p.beak, 0.85), [0, -0.07, 0.32], [Math.PI, 0, 0])));
  for (const s of [1, -1]) {
    head.add(detail(mesh(`eye-${s}`, ball(0.028, 0), '#141414', [0.1 * s, 0.09, 0.14])));
    head.add(detail(mesh(`brow-${s}`, box(0.07, 0.02, 0.05), shade(p.head, 0.85), [0.09 * s, 0.13, 0.13], [0, 0, 0.35 * s])));
  }
  body.add(head);

  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'L' : 'R';
    const wing = part(`wing${side}`, [0.16 * s, 0.08, 0.05]);
    wing.add(mesh(`wing-inner-${side}`, box(0.62, 0.05, 0.36), p.wing, [0.31 * s, 0, -0.04]));
    wing.add(detail(mesh(`wing-covert-${side}`, box(0.55, 0.06, 0.16), shade(p.wing, 1.25), [0.3 * s, 0.02, 0.1])));
    const tip = part(`wingTip${side}`, [0.62 * s, 0, 0]);
    for (let i = 0; i < 5; i++) {
      const len = 0.5 - i * 0.05;
      const a = (i - 1) * 0.22 * s;
      tip.add(mesh(`primary-${side}-${i}`, box(len, 0.03, 0.1), shade(p.wing, 1 - i * 0.05), [Math.cos(a) * len * 0.5 * s, 0, -Math.sin(a) * len * 0.5 * s - i * 0.04], [0, a, 0]));
    }
    wing.add(tip);
    body.add(wing);
  }

  const tail = part('tail', [0, 0.02, -0.42]);
  for (let i = -2; i <= 2; i++) {
    tail.add(mesh(`tail-feather-${i}`, box(0.08, 0.025, 0.36), i % 2 === 0 ? p.head : p.body, [i * 0.045, 0, -0.16], [0, i * 0.18, 0]));
  }
  body.add(tail);

  const legs = part('legs', [0, -0.18, 0.05]);
  for (const s of [1, -1]) {
    legs.add(mesh(`leg-${s}`, beam([0.07 * s, 0, 0], [0.08 * s, -0.2, -0.08], 0.035, 0.025, 4), p.beak));
    for (const t of [-0.04, 0, 0.04]) legs.add(detail(mesh(`talon-${s}-${t}`, cone(0.015, 0.07, 3), '#222222', [0.08 * s + t, -0.22, -0.02], [Math.PI / 2, 0, 0])));
  }
  body.add(legs);
  return root;
}
