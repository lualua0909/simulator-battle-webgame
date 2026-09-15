// Low-poly fire dragon: chained neck/tail pivots, jaw pivot, two-segment wings with
// double-sided membranes, mouth socket for the breath emitter.
import * as THREE from 'three';
import type { DragonParams } from '@/shared/schema';
import { ball, beam, cone, detail, ell, implicit, mesh, modelRoot, part, sdCapsule, sdEllipsoid, shade, smoothUnion, socket, subtract, sweep, triangles, type Sdf, type Vec3 } from './common';

export function createDragonModel(p: DragonParams): THREE.Group {
  if (p.type === 'baby') return createBabyDragonModel(p);
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

// Baby dragon rebuilt with img2threejs from the Clash of Clans reference
// (.img2threejs/baby-dragon/spec.json): smooth high-poly implicit skin — obese belly blended
// into chest and neck, long forward snout with a wide-open grin (real gape carved out),
// broad lolling tongue, lidded eyes set high and back, brown ear flaps, small scalloped bat
// wings, chubby arms and dangling legs. Same joint names as the western dragon so the flight
// and breath animations drive it. Authored in model space and moved into each part frame.
function createBabyDragonModel(p: DragonParams): THREE.Group {
  const root = modelRoot('dragon', 'dragon', true);
  const skin = new THREE.Color(p.body);
  const belly = new THREE.Color(p.belly);
  const brown = new THREE.Color(p.horn);
  const tip = new THREE.Color(p.horn).lerp(new THREE.Color('#e0a080'), 0.35);
  const palate = new THREE.Color('#5a2a22');
  const smooth = { smooth: true };
  const CELL = 0.03;
  // Meshes are authored in model space; shift them into the frame of the part pivot at `o`.
  const at = (o: Vec3) => (m: THREE.Mesh) => {
    m.position.sub(new THREE.Vector3(...o));
    return m;
  };
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const E = sdEllipsoid;
  const C = sdCapsule;

  // ---------------------------------------------------------------- body (belly, chest, rump, haunches, shoulders)
  const B: Vec3 = [0, 0.95, 0];
  const body = part('body', B);
  root.add(body);
  const bodyField = smoothUnion(
    0.2,
    E([0, 0.95, 0.05], [0.64, 0.72, 0.66]),
    E([0, 1.45, 0.25], [0.52, 0.5, 0.52]),
    E([0, 0.8, -0.35], [0.56, 0.5, 0.52]),
    E([0.42, 0.62, -0.12], [0.3, 0.34, 0.4]),
    E([-0.42, 0.62, -0.12], [0.3, 0.34, 0.4]),
    E([0.42, 1.25, 0.42], [0.2, 0.2, 0.2]),
    E([-0.42, 1.25, 0.42], [0.2, 0.2, 0.2]),
    E([0, 1.62, 0.36], [0.42, 0.3, 0.44]),
  );
  const c = new THREE.Color();
  body.add(
    at(B)(mesh('body-skin', implicit(bodyField, [-0.8, 0.1, -1], [0.8, 2.3, 1], CELL, (x, y, z) => c.copy(skin).lerp(belly, 0.75 * clamp01((z - 0.2) / 0.4) * clamp01((1.6 - y) / 0.5))), '#ffffff', [0, 0, 0], [0, 0, 0], smooth)),
  );

  // ---------------------------------------------------------------- neck joints carry no geometry: the neck is blended into head and body
  const N1: Vec3 = [0, 1.75, 0.35];
  const N2: Vec3 = [0, 1.95, 0.42];
  const H: Vec3 = [0, 2.1, 0.5];
  const neck1 = part('neck1', [N1[0] - B[0], N1[1] - B[1], N1[2] - B[2]]);
  const neck2 = part('neck2', [N2[0] - N1[0], N2[1] - N1[1], N2[2] - N1[2]]);
  // The head sits lower and further forward than its authoring frame so the jaw overlaps the chest as in the reference.
  const head = part('head', [H[0] - N2[0], H[1] - N2[1] - 0.08, H[2] - N2[2] + 0.32]);

  // ---------------------------------------------------------------- head: thick round egg with a blunt snout bulb, gape and nostrils carved out
  const skull = smoothUnion(
    0.16,
    E([0, 2.35, 0.45], [0.52, 0.5, 0.52]),
    E([0, 1.82, 0.16], [0.46, 0.48, 0.56]),
    E([0, 2.25, 0.95], [0.44, 0.34, 0.55]),
    E([0, 2.27, 1.28], [0.4, 0.32, 0.32]),
    E([0.34, 2.12, 0.62], [0.22, 0.22, 0.28]),
    E([-0.34, 2.12, 0.62], [0.22, 0.22, 0.28]),
  );
  const lids = smoothUnion(0.05, skull, E([0.33, 2.7, 0.86], [0.18, 0.06, 0.17]), E([-0.33, 2.7, 0.86], [0.18, 0.06, 0.17]));
  // rounded flaps: capsules flattened across their width, sweeping up and back
  const flap = (s: number): Sdf => {
    const cap = C([0.34 * s, 2.66, 0.28], [0.42 * s, 2.74, -0.1], 0.15, 0.1);
    return (x, y, z) => cap(0.34 * s + (x - 0.34 * s) * 1.9, y, z);
  };
  const earL = flap(1);
  const earR = flap(-1);
  const withEars = smoothUnion(0.05, lids, earL, earR);
  const underJaw: Sdf = (x, y, z) => Math.max(y - 2.0, 0.5 - z);
  const gape = E([0, 2.02, 1.0], [0.36, 0.2, 0.68]);
  const nostrilL = E([0.12, 2.48, 1.5], [0.045, 0.04, 0.05]);
  const nostrilR = E([-0.12, 2.48, 1.5], [0.045, 0.04, 0.05]);
  const headField = subtract(subtract(subtract(subtract(withEars, underJaw), gape), nostrilL), nostrilR);
  head.add(
    at(H)(
      mesh(
        'head-skin',
        implicit(headField, [-0.75, 1.25, -0.5], [0.75, 3.1, 1.7], CELL, (x, y, z) => {
          // soft colour boundaries: blend by distance to each region's field
          c.copy(skin).lerp(brown, clamp01((0.035 - Math.min(earL(x, y, z), earR(x, y, z))) / 0.035));
          if (z > 0.56) c.lerp(palate, clamp01((0.03 - Math.min(Math.abs(gape(x, y, z)), y - 1.98)) / 0.04));
          return c.lerp(palate, clamp01((0.02 - Math.min(nostrilL(x, y, z), nostrilR(x, y, z))) / 0.02));
        }),
        '#ffffff',
        [0, 0, 0],
        [0, 0, 0],
        smooth,
      ),
    ),
  );
  // big round eyes: white sclera, brown iris, black pupil, glint — thin green lids are part of the skin
  for (const s of [1, -1]) {
    head.add(at(H)(detail(mesh(`sclera-${s}`, new THREE.SphereGeometry(0.17, 28, 18), '#f6f3ea', [0.33 * s, 2.52, 0.88], [0, 0, 0], smooth))));
    head.add(at(H)(detail(mesh(`iris-${s}`, new THREE.SphereGeometry(0.1, 24, 14).scale(1, 1, 0.45), p.eye, [0.38 * s, 2.57, 1.01], [-0.15, 0.35 * s, 0], smooth))));
    head.add(at(H)(detail(mesh(`pupil-${s}`, new THREE.SphereGeometry(0.052, 18, 10).scale(1, 1, 0.45), '#120c08', [0.395 * s, 2.58, 1.05], [-0.15, 0.35 * s, 0], smooth))));
    head.add(at(H)(detail(mesh(`glint-${s}`, new THREE.SphereGeometry(0.02, 10, 8), '#ffffff', [0.37 * s, 2.62, 1.07], [0, 0, 0], { smooth: true, emissive: 0.5 }))));
  }
  // upper teeth hanging from the gape rim
  const upperTeeth: Vec3[] = [];
  for (const z of [0.66, 0.86, 1.06, 1.26, 1.42]) {
    const x = 0.44 * Math.sqrt(Math.max(0, 1 - ((z - 0.95) / 0.62) ** 2)) - 0.08;
    upperTeeth.push([x, 1.98, z], [-x, 1.98, z]);
  }
  upperTeeth.push([0.13, 1.98, 1.54], [-0.13, 1.98, 1.54]);
  upperTeeth.forEach((t, i) => head.add(at(H)(detail(mesh(`tooth-top-${i}`, new THREE.SphereGeometry(0.058, 12, 8).scale(1, 1.5, 0.9), '#f4f1e8', t, [0, 0, 0], smooth)))));

  // ---------------------------------------------------------------- huge lower jaw (opened), hollow floor, lower teeth, big tongue
  const J: Vec3 = [0, 2.0, 0.5];
  const jaw = part('jaw', [J[0] - H[0], J[1] - H[1], J[2] - H[2]]);
  const jawSolid = smoothUnion(0.18, C([0, 1.72, 0.4], [0, 1.42, 1.28], 0.42, 0.3), E([0, 1.52, 0.9], [0.46, 0.32, 0.52]));
  const jawHollow = E([0, 1.84, 0.95], [0.34, 0.16, 0.56]);
  const jawField = subtract(jawSolid, jawHollow);
  jaw.add(
    at(J)(
      mesh(
        'jaw-skin',
        implicit(jawField, [-0.65, 0.95, -0.15], [0.65, 2.25, 1.75], CELL, (x, y, z) => c.copy(skin).lerp(belly, 0.5 * clamp01((1.4 - y) / 0.25)).lerp(palate, z > 0.5 ? clamp01((0.04 - jawHollow(x, y, z)) / 0.04) : 0)),
        '#ffffff',
        [0, 0, 0],
        [0, 0, 0],
        smooth,
      ),
    ),
  );
  for (const z of [0.8, 1.0, 1.2]) {
    // seat each tooth on the jaw rim: march down from above until the surface is reached
    let y = 2.2;
    while (y > 1.3 && jawField(0.28, y, z) > 0) y -= 0.005;
    y += 0.03;
    for (const s of [1, -1]) jaw.add(at(J)(detail(mesh(`tooth-bottom-${s}-${z}`, new THREE.SphereGeometry(0.052, 12, 8).scale(1, 1.5, 0.9), '#f4f1e8', [0.28 * s, y, z], [0, 0, 0], smooth))));
  }
  // broad flat tongue: a capsule chain squashed across X, lying in the jaw and hanging far out
  const tonguePath: Vec3[] = [[0.03, 1.76, 0.75], [0.08, 1.73, 1.2], [0.14, 1.62, 1.52], [0.2, 1.36, 1.7], [0.24, 1.08, 1.64], [0.24, 0.9, 1.5]];
  const tongueRadii = [0.12, 0.12, 0.12, 0.11, 0.1, 0.075];
  const tongueChain = smoothUnion(0.07, ...tonguePath.slice(1).map((q, k) => C(tonguePath[k], q, tongueRadii[k], tongueRadii[k + 1])), E([0.24, 0.87, 1.48], [0.07, 0.06, 0.07]));
  const tongueField: Sdf = (x, y, z) => tongueChain(0.14 + (x - 0.14) / 2.0, y, z);
  jaw.add(at(J)(mesh('tongue', implicit(tongueField, [-0.45, 0.7, 0.5], [0.7, 1.95, 1.95], 0.022, () => '#b8675a'), '#ffffff', [0, 0, 0], [0, 0, 0], smooth)));
  head.add(jaw);
  head.add(socket('mouth', [0 - H[0], 1.85 - H[1], 1.6 - H[2]]));
  neck2.add(head);
  neck1.add(neck2);
  body.add(neck1);

  // ---------------------------------------------------------------- short fat tail curling up (one continuous skin on tail1)
  const T1: Vec3 = [0, 0.7, -0.72];
  const tailPath: Vec3[] = [[0, 0.72, -0.55], [0, 0.66, -0.95], [0, 0.72, -1.22], [0, 0.86, -1.42], [0, 1.02, -1.55]];
  const tailRadii = [0.36, 0.26, 0.17, 0.09, 0.02];
  const tailField = smoothUnion(0.06, ...tailPath.slice(1).map((q, k) => C(tailPath[k], q, tailRadii[k], tailRadii[k + 1])));
  let parent: THREE.Object3D = body;
  let tailAt: Vec3 = [T1[0] - B[0], T1[1] - B[1], T1[2] - B[2]];
  for (let i = 0; i < 4; i++) {
    const seg = part(`tail${i + 1}`, tailAt);
    if (i === 0) seg.add(at(T1)(mesh('tail', implicit(tailField, [-0.45, 0.25, -1.65], [0.45, 1.15, -0.4], 0.025, () => skin), '#ffffff', [0, 0, 0], [0, 0, 0], smooth)));
    if (i === 0) for (const [k, h] of [[1, 0.18], [2, 0.14]] as const) seg.add(at(T1)(detail(mesh(`tail-spike-${k}`, new THREE.ConeGeometry(0.075, h, 16), p.horn, [0, tailPath[k][1] + tailRadii[k] + h * 0.3, tailPath[k][2]], [-0.45, 0, 0], smooth))));
    parent.add(seg);
    parent = seg;
    tailAt = [0, 0.02, -0.25];
  }

  // ---------------------------------------------------------------- bat wings high on the back: one thick curved leading bone, membrane with two scallops
  const wingColor = p.wing;
  const bone = shade(p.wing, 0.9);
  const bow = (a: Vec3, b: Vec3, pull: number, origin: Vec3): Vec3 => {
    const m: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    return [m[0] + (origin[0] - m[0]) * pull, m[1] + (origin[1] - m[1]) * pull, m[2] + (origin[2] - m[2]) * pull];
  };
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'L' : 'R';
    const wing = part(`wing${side}`, [0.3 * s, 0.85, -0.3]);
    const elbow: Vec3 = [0.42 * s, 0.64, -0.28];
    const armField = smoothUnion(0.05, E([0, 0, 0], [0.1, 0.1, 0.1]), C([0, 0, 0], elbow, 0.085, 0.07));
    wing.add(mesh(`wing-arm-${side}`, implicit(armField, [-0.5, -0.2, -0.5], [0.5, 0.9, 0.2], 0.02, () => bone), '#ffffff', [0, 0, 0], [0, 0, 0], smooth));
    const tipPart = part(`wingTip${side}`, elbow);
    const mid: Vec3 = [0.22 * s, 0.24, -0.32];
    const f0: Vec3 = [0.42 * s, 0.0, -0.74];
    const f1: Vec3 = [0.24 * s, -0.5, -0.6];
    const f2: Vec3 = [0.01 * s, -0.86, -0.12];
    const leading = smoothUnion(0.06, E([0, 0, 0], [0.075, 0.075, 0.075]), C([0, 0, 0], mid, 0.07, 0.055), C(mid, f0, 0.055, 0.025), C([0, 0, 0], f1, 0.025, 0.012));
    tipPart.add(mesh(`wing-bone-${side}`, implicit(leading, [-0.5, -0.65, -0.95], [0.5, 0.4, 0.15], 0.02, () => bone), '#ffffff', [0, 0, 0], [0, 0, 0], smooth));
    const o: Vec3 = [0, 0, 0];
    const s1 = bow(f0, f1, 0.22, o);
    const s2 = bow(f1, f2, 0.22, o);
    tipPart.add(mesh(`wing-membrane-outer-${side}`, triangles([o, mid, f0], [o, f0, s1], [o, s1, f1], [o, f1, s2], [o, s2, f2]), wingColor, [0, 0, 0], [0, 0, 0], { doubleSide: true, smooth: true }));
    const trailing: Vec3 = [elbow[0] + f2[0], elbow[1] + f2[1], elbow[2] + f2[2]];
    const root0: Vec3 = [0, 0, 0.02];
    wing.add(mesh(`wing-membrane-inner-${side}`, triangles([root0, elbow, trailing]), wingColor, [0, 0, 0], [0, 0, 0], { doubleSide: true, smooth: true }));
    wing.add(tipPart);
    body.add(wing);
  }

  // ---------------------------------------------------------------- chubby arms (front legs) and dangling hind legs
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'L' : 'R';
    // Authored pre-rotated: flight animation swings legF +0.7 and shinF +0.9 rad about X,
    // which brings the arms forward-down and the hands out in front of the belly.
    const arm = part(`legF${side}`, [0.5 * s, 0.33, 0.5]);
    const upper = smoothUnion(0.06, E([0, 0, 0], [0.19, 0.19, 0.19]), C([0, 0, 0], [0.03 * s, 0.02, 0.28], 0.17, 0.15));
    arm.add(mesh(`upper-arm-${side}`, implicit(upper, [-0.35, -0.3, -0.3], [0.35, 0.3, 0.5], CELL, () => skin), '#ffffff', [0, 0, 0], [0, 0, 0], smooth));
    const forearm = part(`shinF${side}`, [0.03 * s, 0.02, 0.28]);
    const fingers = [-0.12, -0.04, 0.04, 0.12].map((x) => C([x * s - 0.02 * s, 0.32, 0.07], [x * 1.2 * s - 0.02 * s, 0.48, 0.1], 0.075, 0.068));
    const hand = smoothUnion(0.05, C([0, 0, 0], [-0.02 * s, 0.18, 0.04], 0.16, 0.15), E([-0.02 * s, 0.3, 0.06], [0.21, 0.16, 0.15]), ...fingers);
    forearm.add(mesh(`hand-${side}`, implicit(hand, [-0.4, -0.2, -0.2], [0.4, 0.65, 0.35], 0.025, (x, y) => c.copy(skin).lerp(tip, clamp01((y - 0.33) / 0.1))), '#ffffff', [0, 0, 0], [0, 0, 0], smooth));
    arm.add(forearm);
    body.add(arm);

    const leg = part(`legB${side}`, [0.42 * s, -0.42, -0.05]);
    leg.add(mesh(`shin-${side}`, implicit(C([0, 0.1, 0], [0, -0.25, 0.06], 0.23, 0.19), [-0.35, -0.5, -0.35], [0.35, 0.4, 0.4], CELL, () => skin), '#ffffff', [0, 0, 0], [0, 0, 0], smooth));
    const foot = part(`shinB${side}`, [0, -0.25, 0.06]);
    const toes = [-0.11, 0, 0.11].map((x) => C([x, -0.1, 0.28], [x * 1.15, -0.12, 0.46], 0.08, 0.075));
    const footField = smoothUnion(0.05, C([0, 0.05, 0], [0, -0.05, 0.05], 0.19, 0.18), E([0, -0.08, 0.1], [0.24, 0.15, 0.32]), ...toes);
    foot.add(mesh(`foot-${side}`, implicit(footField, [-0.38, -0.35, -0.35], [0.38, 0.3, 0.62], 0.025, (x, y, z) => c.copy(skin).lerp(tip, clamp01((z - 0.22) / 0.12))), '#ffffff', [0, 0, 0], [0, 0, 0], smooth));
    leg.add(foot);
    body.add(leg);
  }
  return root;
}
