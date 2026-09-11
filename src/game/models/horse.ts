// Low-poly war horse (quadruped rig) with a saddle socket for a rider.
import type * as THREE from 'three';
import type { HorseParams } from '@/shared/schema';
import { beam, box, cone, cyl, detail, ell, mesh, modelRoot, part, shade, socket, sweep } from './common';

export function createHorseModel(p: HorseParams): THREE.Group {
  const root = modelRoot('horse', 'quadruped');
  const hoof = '#2a2320';

  const body = part('body', [0, 1.25, 0]);
  root.add(body);
  body.add(mesh('barrel', ell(0.36, 0.4, 0.82), p.coat));
  body.add(mesh('chest', ell(0.33, 0.37, 0.32), p.coat, [0, 0.03, 0.52]));
  body.add(mesh('rump', ell(0.35, 0.37, 0.3), p.coat, [0, 0.04, -0.55]));
  if (p.barding) {
    body.add(mesh('barding', ell(0.39, 0.3, 0.86), p.bardingColor, [0, -0.12, 0]));
  }
  body.add(mesh('blanket', box(0.8, 0.03, 0.62), p.barding ? shade(p.bardingColor, 0.8) : shade(p.saddle, 1.4), [0, 0.39, -0.05]));
  body.add(mesh('saddle', box(0.36, 0.1, 0.46), p.saddle, [0, 0.44, -0.05]));
  body.add(detail(mesh('saddle-pommel', box(0.2, 0.12, 0.06), p.saddle, [0, 0.52, 0.17])));
  body.add(socket('saddle', [0, 0.47, -0.08]));

  // neck + head
  const neck = part('neck', [0, 0.2, 0.62]);
  body.add(neck);
  neck.add(mesh('neck', beam([0, 0, 0], [0, 0.62, 0.4], 0.25, 0.15), p.coat));
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    neck.add(detail(mesh(`mane-${i}`, box(0.07, 0.16, 0.12), p.mane, [0, 0.14 + t * 0.58, -0.12 + t * 0.36], [0.55, 0, 0])));
  }
  const head = part('head', [0, 0.66, 0.42]);
  neck.add(head);
  head.add(mesh('skull', ell(0.15, 0.16, 0.2), p.coat, [0, 0.02, 0]));
  head.add(mesh('muzzle', beam([0, 0.02, 0.05], [0, -0.26, 0.42], 0.14, 0.1), p.coat));
  head.add(mesh('nose', ell(0.1, 0.09, 0.1), shade(p.coat, 0.75), [0, -0.27, 0.44]));
  for (const s of [1, -1]) {
    head.add(detail(mesh(`eye-${s}`, cone(0.03, 0.02, 4), '#111111', [0.13 * s, 0.04, 0.06], [0, 0, (-Math.PI / 2) * s])));
    head.add(mesh(`ear-${s}`, cone(0.05, 0.17, 4), p.coat, [0.08 * s, 0.2, -0.04], [-0.2, 0, -0.25 * s]));
  }
  head.add(detail(mesh('forelock', box(0.08, 0.1, 0.08), p.mane, [0, 0.14, 0.05])));
  if (p.barding) head.add(detail(mesh('chanfron', box(0.17, 0.05, 0.36), p.bardingColor, [0, 0.0, 0.2], [0.72, 0, 0])));

  // legs
  for (const [key, z] of [['F', 0.52], ['B', -0.55]] as const) {
    for (const s of [1, -1] as const) {
      const side = s > 0 ? 'L' : 'R';
      const leg = part(`leg${key}${side}`, [0.2 * s, -0.22, z]);
      leg.add(mesh(`thigh-${key}${side}`, beam([0, 0.12, 0], [0, -0.48, 0], 0.13, 0.075), p.coat));
      const shin = part(`shin${key}${side}`, [0, -0.48, 0]);
      shin.add(mesh(`cannon-${key}${side}`, beam([0, 0.02, 0], [0, -0.45, 0], 0.07, 0.06), p.coat));
      shin.add(mesh(`hoof-${key}${side}`, cyl(0.075, 0.088, 0.1, 6), hoof, [0, -0.5, 0.01]));
      if (p.barding && key === 'F') shin.add(detail(mesh(`sock-${side}`, cyl(0.08, 0.08, 0.1, 6), p.bardingColor, [0, -0.38, 0])));
      leg.add(shin);
      body.add(leg);
    }
  }

  const tail = part('tail', [0, 0.2, -0.82]);
  tail.add(mesh('tail', sweep([[0, 0, 0], [0, -0.15, -0.2], [0, -0.55, -0.3], [0, -0.85, -0.26]], [0.08, 0.1, 0.08, 0.02], 5), p.mane));
  body.add(tail);
  return root;
}
