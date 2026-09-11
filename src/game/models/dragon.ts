// Low-poly fire dragon: chained neck/tail pivots, jaw pivot, two-segment wings with
// double-sided membranes, mouth socket for the breath emitter.
import type * as THREE from 'three';
import type { DragonParams } from '@/shared/schema';
import { ball, beam, cone, detail, ell, mesh, modelRoot, part, shade, socket, sweep, triangles, type Vec3 } from './common';

export function createDragonModel(p: DragonParams): THREE.Group {
  const root = modelRoot('dragon', 'dragon');
  const scale = shade(p.body, 0.8);

  const body = part('body', [0, 1.9, 0]);
  root.add(body);
  body.add(mesh('torso', ell(0.85, 0.75, 1.7), p.body));
  body.add(mesh('belly', ell(0.7, 0.55, 1.5), p.belly, [0, -0.25, 0.05]));
  for (let i = 0; i < 6; i++) {
    const z = 1.1 - i * 0.45;
    body.add(detail(mesh(`back-spike-${i}`, cone(0.1, 0.32, 4), p.horn, [0, 0.72 - Math.abs(z) * 0.08, z], [-0.3, 0, 0])));
  }

  // neck chain → head → jaw
  const neck1 = part('neck1', [0, 0.3, 1.5]);
  neck1.add(mesh('neck-1', sweep([[0, 0, -0.2], [0, 0.35, 0.35], [0, 0.6, 0.7]], [0.46, 0.4, 0.35]), p.body));
  const neck2 = part('neck2', [0, 0.6, 0.7]);
  neck2.add(mesh('neck-2', sweep([[0, 0, 0], [0, 0.3, 0.4], [0, 0.45, 0.75]], [0.35, 0.32, 0.3]), p.body));
  const head = part('head', [0, 0.45, 0.75]);
  head.add(mesh('skull', ell(0.36, 0.3, 0.5), p.body, [0, 0.06, 0.2]));
  head.add(mesh('snout', ell(0.24, 0.16, 0.45), p.body, [0, 0.0, 0.66]));
  head.add(detail(mesh('nostril-ridge', ell(0.2, 0.07, 0.2), scale, [0, 0.12, 0.92])));
  for (const s of [1, -1]) {
    head.add(detail(mesh(`eye-${s}`, ball(0.07, 0), p.eye, [0.24 * s, 0.17, 0.42], [0, 0, 0], { emissive: 0.5 })));
    head.add(mesh(`horn-${s}`, sweep([[0.18 * s, 0.22, 0.05], [0.28 * s, 0.4, -0.25], [0.3 * s, 0.45, -0.65]], [0.09, 0.06, 0.005], 5), p.horn));
    head.add(detail(mesh(`cheek-spike-${s}`, cone(0.05, 0.25, 4), p.horn, [0.3 * s, -0.05, 0.1], [-1.3, 0, 0.5 * s])));
  }
  const jaw = part('jaw', [0, -0.12, 0.25]);
  jaw.add(mesh('jaw', ell(0.22, 0.08, 0.45), p.belly, [0, -0.04, 0.35]));
  for (const s of [1, -1]) jaw.add(detail(mesh(`fang-${s}`, cone(0.03, 0.1, 4), '#ffffff', [0.12 * s, 0.05, 0.62])));
  head.add(jaw);
  head.add(socket('mouth', [0, -0.05, 1.05]));
  neck2.add(head);
  neck1.add(neck2);
  body.add(neck1);

  // tail chain (tapers to a spade)
  const radii = [0.45, 0.35, 0.25, 0.15, 0.06];
  let parent: THREE.Object3D = body;
  let at: Vec3 = [0, 0.1, -1.55];
  for (let i = 0; i < 4; i++) {
    const seg = part(`tail${i + 1}`, at);
    const end: Vec3 = [0, i === 0 ? -0.15 : -0.05, -0.95];
    seg.add(mesh(`tail-${i + 1}`, sweep([[0, 0, 0.1], [0, end[1] * 0.5, -0.5], end], [radii[i], (radii[i] + radii[i + 1]) / 2, radii[i + 1]]), p.body));
    if (i === 3) seg.add(mesh('tail-spade', cone(0.3, 0.5, 3), p.horn, [0, -0.05, -1.15], [-Math.PI / 2, 0, 0]));
    parent.add(seg);
    parent = seg;
    at = end;
  }

  // wings — reflection across x for the right side
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'L' : 'R';
    const wing = part(`wing${side}`, [0.6 * s, 0.55, 0.4]);
    const elbow: Vec3 = [1.8 * s, 0.45, -0.2];
    wing.add(mesh(`wing-arm-${side}`, beam([0, 0, 0], elbow, 0.13, 0.08), p.body));
    const tip = part(`wingTip${side}`, elbow);
    const fingers: Vec3[] = [
      [1.9 * s, 0.15, -0.25],
      [1.5 * s, -0.05, -1.15],
      [0.55 * s, -0.05, -1.35],
    ];
    fingers.forEach((f, i) => tip.add(detail(mesh(`wing-finger-${side}-${i}`, beam([0, 0, 0], f, 0.06, 0.02, 4), p.body))));
    tip.add(detail(mesh(`wing-claw-${side}`, cone(0.05, 0.16, 4), p.horn, [0, 0.1, 0.05])));
    const o: Vec3 = [0, 0, 0];
    tip.add(mesh(`wing-membrane-outer-${side}`, triangles([o, fingers[0], fingers[1]], [o, fingers[1], fingers[2]]), p.wing, [0, 0, 0], [0, 0, 0], { doubleSide: true }));
    const trailing: Vec3 = [elbow[0] + fingers[2][0], elbow[1] + fingers[2][1], elbow[2] + fingers[2][2]];
    const bodyBack: Vec3 = [0.05 * s, -0.25, -1.35];
    wing.add(mesh(`wing-membrane-inner-${side}`, triangles([[0, 0, 0.15], elbow, trailing], [[0, 0, 0.15], trailing, bodyBack]), p.wing, [0, 0, 0], [0, 0, 0], { doubleSide: true }));
    wing.add(tip);
    body.add(wing);
  }

  // legs
  for (const [key, z, r] of [['F', 0.95, 0.2], ['B', -0.85, 0.26]] as const) {
    for (const s of [1, -1] as const) {
      const side = s > 0 ? 'L' : 'R';
      const leg = part(`leg${key}${side}`, [0.58 * s, -0.4, z]);
      leg.add(mesh(`thigh-${key}${side}`, beam([0, 0.2, 0], [0, -0.6, 0.12], r + 0.04, r * 0.75), p.body));
      const shin = part(`shin${key}${side}`, [0, -0.6, 0.12]);
      shin.add(mesh(`shin-${key}${side}`, beam([0, 0, 0], [0, -0.72, -0.06], r * 0.75, r * 0.55), p.body));
      shin.add(mesh(`foot-${key}${side}`, ell(0.16, 0.08, 0.24), scale, [0, -0.78, 0.06]));
      for (const t of [-0.08, 0, 0.08]) shin.add(detail(mesh(`claw-${key}${side}-${t}`, cone(0.03, 0.12, 4), p.horn, [t, -0.8, 0.3], [Math.PI / 2, 0, 0])));
      leg.add(shin);
      body.add(leg);
    }
  }
  return root;
}
