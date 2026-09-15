// Low-poly velociraptor (raptor rig): horizontal biped with a stiff counter-balance tail,
// tiny arms, big sickle-clawed hind legs and a jawed snout with a mouth socket.
//
// The battle renderer prefers an uploaded .glb for this kind (skeletal clips from the file,
// normalised to ~2 m tall); this procedural model covers thumbnails, ghosts and previews, so
// it is authored at the same ~2 m scale.
import * as THREE from 'three';
import type { RaptorParams } from '@/shared/schema';
import { ball, beam, cone, detail, ell, mesh, modelRoot, part, shade, socket, sweep, type Vec3 } from './common';

export function createRaptorModel(p: RaptorParams): THREE.Group {
  const root = modelRoot('raptor', 'raptor');
  const dark = shade(p.body, 0.8);

  // ---------------------------------------------------------------- torso (horizontal, hips at ~1.1 m)
  const body = part('body', [0, 1.12, 0]);
  root.add(body);
  body.add(mesh('torso', ell(0.34, 0.36, 0.72), p.body));
  body.add(mesh('belly', ell(0.28, 0.27, 0.58), p.belly, [0, -0.15, 0.06]));
  body.add(mesh('rump', ell(0.3, 0.3, 0.34), p.body, [0, 0.02, -0.55]));
  for (let i = 0; i < 3; i++) {
    body.add(detail(mesh(`back-stripe-${i}`, cone(0.07, 0.2, 4), p.back, [0, 0.36 - i * 0.02, 0.35 - i * 0.4], [-0.25, 0, 0])));
  }

  // ---------------------------------------------------------------- neck → head → jaw
  const neck = part('neck', [0, 0.22, 0.6]);
  neck.add(mesh('neck', beam([0, -0.05, -0.1], [0, 0.3, 0.2], 0.2, 0.15), p.body));
  const head = part('head', [0, 0.3, 0.2]);
  head.add(mesh('skull', ell(0.19, 0.17, 0.24), p.body, [0, 0.04, 0.1]));
  head.add(mesh('snout', ell(0.11, 0.09, 0.26), p.body, [0, -0.01, 0.42]));
  head.add(detail(mesh('snout-top', ell(0.1, 0.05, 0.24), p.back, [0, 0.07, 0.4])));
  for (const s of [1, -1]) {
    head.add(detail(mesh(`eye-${s}`, ball(0.035, 0), p.eye, [0.13 * s, 0.09, 0.28])));
    head.add(detail(mesh(`brow-${s}`, ball(0.05, 0), p.back, [0.13 * s, 0.13, 0.26])));
    for (const t of [0.36, 0.48]) head.add(detail(mesh(`tooth-top-${s}-${t}`, cone(0.015, 0.06, 3), '#f4f1e8', [0.07 * s, -0.09, t], [Math.PI, 0, 0])));
  }
  const jaw = part('jaw', [0, -0.09, 0.12]);
  jaw.add(mesh('jaw', ell(0.09, 0.05, 0.3), p.belly, [0, -0.02, 0.22]));
  head.add(jaw);
  head.add(socket('mouth', [0, -0.04, 0.68]));
  neck.add(head);
  body.add(neck);

  // ---------------------------------------------------------------- tail chain (stiff, counter-balances the head)
  let parent: THREE.Object3D = body;
  let at: Vec3 = [0, 0.08, -0.62];
  const segs: Array<[Vec3, number, number]> = [
    [[0, 0.06, -0.62], 0.2, 0.15],
    [[0, 0.08, -0.62], 0.15, 0.1],
    [[0, 0.1, -0.6], 0.1, 0.03],
  ];
  segs.forEach(([end, r0, r1], i) => {
    const seg = part(`tail${i + 1}`, at);
    seg.add(mesh(`tail-${i + 1}`, sweep([[0, 0, 0.08], [0, end[1] * 0.5, end[2] * 0.5], end], [r0, (r0 + r1) / 2, r1]), i === 0 ? p.body : p.back));
    if (i === 2) seg.add(detail(mesh('tail-tip', cone(0.05, 0.22, 4), p.back, [0, end[1] + 0.05, end[2] - 0.05], [-Math.PI / 2 - 0.2, 0, 0])));
    parent.add(seg);
    parent = seg;
    at = end;
  });

  // ---------------------------------------------------------------- tiny arms
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'L' : 'R';
    const arm = part(`arm${side}`, [0.26 * s, -0.14, 0.42]);
    arm.add(mesh(`arm-${side}`, beam([0, 0, 0], [0.02 * s, -0.28, 0.08], 0.055, 0.04), p.body));
    for (const c of [-0.03, 0.03]) arm.add(detail(mesh(`claw-arm-${side}-${c}`, cone(0.015, 0.09, 3), '#f4f1e8', [0.02 * s + c, -0.32, 0.12], [Math.PI / 2 + 0.3, 0, 0])));
    body.add(arm);
  }

  // ---------------------------------------------------------------- big hind legs (thigh forward, shin back, clawed foot)
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'L' : 'R';
    const thigh = part(`thigh${side}`, [0.24 * s, -0.22, 0.02]);
    thigh.add(mesh(`thigh-${side}`, beam([0, 0.12, -0.05], [0, -0.42, 0.14], 0.14, 0.09), p.body));
    const shin = part(`shin${side}`, [0, -0.42, 0.14]);
    shin.add(mesh(`shin-${side}`, beam([0, 0, 0], [0, -0.36, -0.1], 0.08, 0.05), dark));
    shin.add(mesh(`foot-${side}`, ell(0.09, 0.05, 0.2), dark, [0, -0.4, 0.05]));
    for (const t of [-0.07, 0, 0.07]) {
      const up = t === 0 ? 0.06 : 0; // middle toe carries the raised sickle claw
      shin.add(detail(mesh(`claw-${side}-${t}`, cone(0.02, t === 0 ? 0.14 : 0.1, 3), '#f4f1e8', [t, -0.4 + up, 0.3], [Math.PI / 2 - 0.2, 0, 0])));
    }
    thigh.add(shin);
    body.add(thigh);
  }
  return root;
}
