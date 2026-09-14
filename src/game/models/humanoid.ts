// Stylized low-poly soldier (wobbly-battle look: bean torso, dot eyes, stubby limbs).
//
// Reference-free build: there is no photo to measure, so proportions come from the
// img2threejs canon table (forge/stage2_spec/humanoid_proportions.py, 4-head column):
//   head = 0.25 H, upper arm = 0.125 H, forearm = 0.125 H, shin = 0.125 H.
// The canon does not supply hip line, thigh length or shoulder width for 4-head figures;
// those three are marked DESIGN below rather than presented as measurements.
import * as THREE from 'three';
import type { HumanoidParams } from '@/shared/schema';
import {
  ball,
  box,
  cone,
  cyl,
  detail,
  dome,
  ell,
  jitter,
  limb,
  mesh,
  metal,
  modelRoot,
  part,
  shade,
  socket,
  type Vec3,
} from './common';
import { createOffhandModel, createWeaponModel } from './weapons';

export const HUMANOID_HEIGHT = 1.8;
const H = HUMANOID_HEIGHT;
export const HIP_Y = 0.5; // DESIGN: short legs, ~1.1 head units
const HEAD_R = (0.25 * H) / 2 - 0.025; // canon head height 0.45 incl. hair
const UPPER_ARM = 0.125 * H; // canon
const FOREARM = 0.125 * H; // canon
const SHIN = 0.125 * H; // canon
const THIGH = 0.12 * H; // DESIGN
const SHOULDER_X = 0.29; // DESIGN (× bulk)
const TORSO_TOP = 0.8; // neck height above the waist pivot

/** Weapon socket: in the guard pose (forearm raised forward) weapon +Y = up, +Z = forward. */
const HAND_ROT: Vec3 = [Math.PI / 2, 0, 0];

export function createHumanoidModel(p: HumanoidParams): THREE.Group {
  const b = p.bulk;
  const root = modelRoot('humanoid', 'humanoid');
  root.userData.weapon = p.weapon;
  root.userData.offhand = p.offhand;
  root.userData.weaponHand = p.weapon === 'bow' ? 'L' : 'R';

  const bareChest = p.armor === 'loincloth';
  const torsoColor = p.armor === 'robe' ? p.armorColor : bareChest ? p.skin : p.shirt;
  const sleeve = p.armor === 'robe' ? p.armorColor : bareChest ? p.skin : p.shirt;
  const plate = p.armor === 'plate';

  // ---- hips + legs
  const hips = part('hips', [0, HIP_Y, 0]);
  root.add(hips);
  hips.add(mesh('pelvis', ell(0.24 * b, 0.14, 0.2 * b), p.pants, [0, 0.03, 0]));

  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'L' : 'R';
    const thigh = part(`thigh${side}`, [0.13 * b * s, 0, 0]);
    thigh.add(mesh(`thigh-${side}`, limb(0.09 * Math.sqrt(b), THIGH), p.pants));
    const shin = part(`shin${side}`, [0, -(THIGH + 0.014), 0]);
    shin.add(mesh(`shin-${side}`, limb(0.078, SHIN - 0.06), plate ? p.armorColor : p.pants));
    shin.add(mesh(`boot-${side}`, ell(0.09, 0.065, 0.14), p.boots, [0, -0.2, 0.04]));
    thigh.add(shin);
    hips.add(thigh);
  }

  // ---- torso
  const torso = part('torso', [0, 0.05, 0]);
  hips.add(torso);
  torso.add(mesh('torso', ell(0.3 * b, 0.42, 0.25 * b), torsoColor, [0, 0.38, 0]));

  switch (p.armor) {
    case 'vest':
      torso.add(mesh('vest', ell(0.315 * b, 0.3, 0.265 * b), p.armorColor, [0, 0.47, 0]));
      break;
    case 'plate':
      torso.add(metal('breastplate', ell(0.32 * b, 0.4, 0.27 * b), p.armorColor, [0, 0.41, 0]));
      break;
    case 'robe':
      hips.add(mesh('robe-skirt', cyl(0.27 * b, 0.38 * b, 0.55, 8), p.armorColor, [0, -0.2, 0]));
      torso.add(detail(mesh('robe-sash', new THREE.TorusGeometry(0.275 * b, 0.035, 4, 10), shade(p.armorColor, 0.7), [0, 0.1, 0], [Math.PI / 2, 0, 0])));
      break;
    case 'loincloth':
      hips.add(mesh('loin-front', box(0.22 * b, 0.28, 0.03), p.armorColor, [0, -0.1, 0.19 * b]));
      hips.add(mesh('loin-back', box(0.22 * b, 0.26, 0.03), p.armorColor, [0, -0.1, -0.19 * b]));
      torso.add(detail(mesh('strap', box(0.08, 0.62, 0.52 * b), p.shirt, [0, 0.42, 0], [0, 0, 0.62])));
      break;
    case 'fur':
      torso.add(mesh('fur-mantle', jitter(new THREE.TorusGeometry(0.25 * b, 0.11, 5, 10), 0.05, 3), p.armorColor, [0, 0.66, 0], [Math.PI / 2, 0, 0]));
      break;
  }
  if (p.armor !== 'robe' && p.armor !== 'loincloth') {
    torso.add(detail(mesh('belt', new THREE.TorusGeometry(0.29 * b, 0.032, 4, 10), '#3a2a1c', [0, 0.1, 0], [Math.PI / 2, 0, 0])));
  }

  // ---- cape
  if (p.cape) {
    const cape = part('cape', [0, 0.7, -0.2 * b]);
    cape.add(mesh('cape', box(0.46 * b, 0.85, 0.03), p.capeColor, [0, -0.42, 0], [0.12, 0, 0]));
    torso.add(cape);
  }

  // ---- arms
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'L' : 'R';
    const arm = part(`arm${side}`, [SHOULDER_X * b * s, 0.62, 0]);
    arm.add(mesh(`upper-arm-${side}`, limb(0.075, UPPER_ARM), sleeve));
    if (plate || p.armor === 'fur') {
      arm.add(metal(`pauldron-${side}`, ell(0.13, 0.09, 0.13), p.armorColor, [0.02 * s, 0.02, 0]));
    }
    const fore = part(`forearm${side}`, [0, -(UPPER_ARM + 0.015), 0]);
    fore.add(mesh(`forearm-${side}`, limb(0.068, FOREARM - 0.03), plate ? p.armorColor : p.armor === 'robe' ? sleeve : p.skin));
    fore.add(mesh(`hand-${side}`, ball(0.08, 1), plate ? shade(p.armorColor, 0.85) : p.skin, [0, -0.22, 0]));
    const handPos: Vec3 = [0, -0.23, 0];
    fore.add(socket(`hand.${side}`, handPos, HAND_ROT));
    arm.add(fore);
    torso.add(arm);

    const colors = { wood: p.woodColor, metal: p.metalColor, orb: p.orbColor, shield: p.shieldColor };
    const held = side === root.userData.weaponHand ? createWeaponModel(p.weapon, colors) : side === 'L' ? createOffhandModel(p.offhand, colors) : null;
    if (held) {
      const grip = part(side === root.userData.weaponHand ? 'weapon' : 'offhand', handPos);
      grip.rotation.set(...HAND_ROT);
      held.children.slice().forEach((c) => grip.add(c));
      fore.add(grip);
    }
  }

  // ---- head
  const head = part('head', [0, TORSO_TOP, 0]);
  torso.add(head);
  buildHead(head, p);
  head.add(socket('head.top', [0, HEAD_R * 2 + 0.02, 0]));

  return root;
}

function buildHead(head: THREE.Group, p: HumanoidParams): void {
  const cy = 0.19;
  head.add(mesh('head', ball(HEAD_R, 1), p.skin, [0, cy, 0]));
  // A closed great helm hides the face; the visor slit stands in for the eyes.
  for (const s of p.head === 'greathelm' ? [] : [1, -1]) {
    head.add(detail(mesh(`eye-${s > 0 ? 'L' : 'R'}`, ball(0.034, 0), '#141414', [0.075 * s, cy + 0.02, HEAD_R - 0.024])));
    if (p.brows !== 'none') {
      const tilt = (p.brows === 'angry' ? 0.42 : -0.38) * s;
      head.add(detail(mesh(`brow-${s > 0 ? 'L' : 'R'}`, box(0.085, 0.022, 0.025), shade(p.hairColor, 0.8), [0.075 * s, cy + 0.08, HEAD_R - 0.03], [0, 0, tilt])));
    }
  }

  // hair (skipped under full helmets)
  const fullHelm = p.head === 'greathelm' || p.head === 'hood' || p.head === 'ninja';
  if (!fullHelm && p.hair !== 'none') {
    head.add(mesh('hair-cap', dome(HEAD_R + 0.012, 9, 3), p.hairColor, [0, cy + 0.02, -0.012], [-0.38, 0, 0]));
    if (p.hair === 'long') head.add(mesh('hair-long', ell(0.18, 0.24, 0.08), p.hairColor, [0, cy - 0.1, -0.13]));
    if (p.hair === 'mohawk') {
      for (let i = 0; i < 5; i++) {
        const a = -0.9 + i * 0.45;
        head.add(detail(mesh(`mohawk-${i}`, box(0.05, 0.12, 0.08), p.hairColor, [0, cy + Math.cos(a) * (HEAD_R + 0.04), Math.sin(a) * (HEAD_R + 0.04)], [a, 0, 0])));
      }
    }
    if (p.hair === 'topknot') head.add(mesh('topknot', ball(0.07, 0), p.hairColor, [0, cy + HEAD_R + 0.04, -0.05]));
  }
  if (p.beard !== 'none') {
    const long = p.beard === 'long';
    head.add(mesh('beard', ell(0.14, long ? 0.17 : 0.08, 0.09), p.hairColor, [0, cy - (long ? 0.15 : 0.1), HEAD_R - 0.07]));
  }

  const hc = p.headColor;
  switch (p.head) {
    case 'cap':
      head.add(mesh('cap', dome(HEAD_R + 0.02, 8, 3), hc, [0, cy + 0.03, 0]));
      break;
    case 'helmet':
    case 'horned':
      head.add(metal('helmet', dome(HEAD_R + 0.025, 8, 3), hc, [0, cy + 0.02, 0]));
      head.add(detail(metal('helmet-rim', new THREE.TorusGeometry(HEAD_R + 0.02, 0.02, 3, 10), shade(hc, 0.8), [0, cy + 0.03, 0], [Math.PI / 2, 0, 0])));
      head.add(detail(metal('nose-guard', box(0.03, 0.12, 0.03), hc, [0, cy + 0.02, HEAD_R + 0.01])));
      if (p.head === 'horned') {
        for (const s of [1, -1]) head.add(mesh(`horn-${s}`, cone(0.045, 0.24, 5), '#efe6cf', [0.2 * s, cy + 0.14, 0], [0, 0, -0.9 * s]));
      }
      break;
    case 'greathelm':
      head.add(metal('greathelm', cyl(HEAD_R + 0.025, HEAD_R + 0.03, 0.36, 8), hc, [0, cy + 0.02, 0]));
      head.add(metal('greathelm-top', dome(HEAD_R + 0.025, 8, 2), hc, [0, cy + 0.2, 0]));
      head.add(detail(mesh('visor-slit', box(0.26, 0.03, 0.03), '#101010', [0, cy + 0.04, HEAD_R + 0.02])));
      head.add(detail(metal('visor-ridge', box(0.03, 0.26, 0.03), shade(hc, 0.85), [0, cy - 0.02, HEAD_R + 0.025])));
      break;
    case 'crown':
      head.add(metal('crown-band', new THREE.CylinderGeometry(0.16, 0.15, 0.08, 10, 1, true), hc, [0, cy + 0.2, 0]));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        head.add(detail(metal(`crown-point-${i}`, cone(0.03, 0.08, 4), hc, [Math.sin(a) * 0.155, cy + 0.28, Math.cos(a) * 0.155])));
      }
      head.add(detail(mesh('crown-gem', ball(0.03, 0), '#d8283a', [0, cy + 0.2, 0.165])));
      break;
    case 'hood': {
      const hood = new THREE.SphereGeometry(HEAD_R + 0.035, 10, 6, (5 * Math.PI) / 6, (4 * Math.PI) / 3);
      head.add(mesh('hood', hood, hc, [0, cy + 0.02, -0.01], [0, 0, 0], { doubleSide: true }));
      head.add(mesh('hood-tip', cone(0.09, 0.2, 5), hc, [0, cy + 0.1, -0.22], [-1.2, 0, 0]));
      break;
    }
    case 'wizard':
      head.add(mesh('wizard-brim', cyl(0.34, 0.34, 0.025, 10), hc, [0, cy + 0.16, 0]));
      head.add(mesh('wizard-cone', cone(0.2, 0.55, 7), hc, [0, cy + 0.44, -0.04], [-0.22, 0, 0]));
      head.add(detail(mesh('wizard-band', cyl(0.205, 0.205, 0.05, 7), shade(hc, 1.6), [0, cy + 0.2, 0])));
      break;
    case 'headband':
      head.add(mesh('headband', new THREE.TorusGeometry(HEAD_R + 0.01, 0.028, 4, 10), hc, [0, cy + 0.08, 0], [Math.PI / 2 - 0.15, 0, 0]));
      head.add(detail(mesh('feather', ell(0.03, 0.16, 0.06), '#f4f1e8', [0.05, cy + 0.2, -0.17], [-0.5, 0, 0.2])));
      break;
    case 'strawhat':
      head.add(mesh('straw-hat', cone(0.42, 0.22, 10), hc, [0, cy + 0.26, 0]));
      break;
    case 'ninja':
      // Wrapped hood over the crown, a mask over mouth and nose, knot tails at the back.
      head.add(mesh('ninja-wrap', dome(HEAD_R + 0.02, 9, 3), hc, [0, cy + 0.035, -0.005], [-0.2, 0, 0]));
      head.add(mesh('ninja-mask', ell(HEAD_R + 0.015, 0.1, HEAD_R + 0.012), hc, [0, cy - 0.075, 0.004]));
      head.add(detail(mesh('ninja-band', new THREE.TorusGeometry(HEAD_R + 0.022, 0.018, 4, 10), shade(hc, 1.6), [0, cy + 0.1, 0], [Math.PI / 2 - 0.1, 0, 0])));
      for (const s of [1, -1]) head.add(detail(mesh(`ninja-tail-${s}`, box(0.035, 0.2, 0.012), shade(hc, 1.6), [0.04 * s, cy + 0.0, -HEAD_R - 0.03], [0.5, 0, 0.35 * s])));
      break;
    case 'none':
      break;
  }
}
