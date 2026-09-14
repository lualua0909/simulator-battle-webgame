// Hand-held weapons and shields.
// Weapon frame: grip at the origin; in the humanoid guard pose +Y is up and +Z forward.
import * as THREE from 'three';
import type { HumanoidParams } from '@/shared/schema';
import { ball, beam, box, cone, cyl, detail, jitter, mesh, metal, shade, socket, sweep } from './common';

export type WeaponKind = HumanoidParams['weapon'];
export type OffhandKind = HumanoidParams['offhand'];

interface WeaponColors {
  wood: string;
  metal: string;
  orb: string;
  shield: string;
}

export function createWeaponModel(kind: WeaponKind, c: WeaponColors): THREE.Group | null {
  const g = new THREE.Group();
  g.name = `weapon-${kind}`;
  const dark = shade(c.wood, 0.7);
  switch (kind) {
    case 'none':
      return null;
    case 'club':
      g.add(mesh('club-handle', cyl(0.032, 0.03, 0.46), c.wood, [0, 0.15, 0]));
      g.add(mesh('club-head', jitter(new THREE.IcosahedronGeometry(0.09, 1).scale(0.9, 1.8, 0.9), 0.03, 11), dark, [0, 0.46, 0]));
      break;
    case 'bigclub':
      g.add(mesh('bigclub-handle', cyl(0.05, 0.045, 0.9), c.wood, [0, 0.3, 0]));
      g.add(mesh('bigclub-head', jitter(new THREE.IcosahedronGeometry(0.16, 1).scale(1, 1.9, 1), 0.05, 12), dark, [0, 0.8, 0]));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.add(detail(metal(`bigclub-spike-${i}`, cone(0.035, 0.12, 4), c.metal, [Math.cos(a) * 0.15, 0.8 + (i % 2) * 0.12, Math.sin(a) * 0.15], [Math.sin(a) * 1.4, 0, -Math.cos(a) * 1.4])));
      }
      break;
    case 'sword':
    case 'greatsword': {
      const k = kind === 'greatsword' ? 1.65 : 1;
      g.add(mesh('sword-grip', cyl(0.024, 0.024, 0.17 * k), dark, [0, 0.02 * k, 0]));
      g.add(metal('sword-pommel', ball(0.035 * k, 0), c.metal, [0, -0.08 * k, 0]));
      g.add(metal('sword-guard', box(0.22 * k, 0.035, 0.05), c.metal, [0, 0.11 * k, 0]));
      g.add(metal('sword-blade', box(0.065 * k, 0.62 * k, 0.018), c.metal, [0, 0.43 * k, 0]));
      g.add(metal('sword-tip', cone(0.046 * k, 0.1 * k, 4), c.metal, [0, 0.79 * k, 0], [0, Math.PI / 4, 0]));
      break;
    }
    case 'katana':
      g.add(mesh('katana-grip', cyl(0.022, 0.022, 0.24), '#1e1e22', [0, 0.02, 0]));
      g.add(metal('katana-tsuba', cyl(0.06, 0.06, 0.018, 8), c.metal, [0, 0.15, 0]));
      g.add(metal('katana-blade', box(0.04, 0.78, 0.012), '#e6ecf2', [0, 0.55, 0.012], [0.04, 0, 0]));
      g.add(metal('katana-tip', cone(0.028, 0.1, 3), '#e6ecf2', [0, 0.98, 0.03], [0.06, Math.PI / 4, 0]));
      break;
    case 'axe':
      g.add(mesh('axe-handle', cyl(0.03, 0.03, 0.8), c.wood, [0, 0.28, 0]));
      g.add(metal('axe-blade', box(0.26, 0.2, 0.035), c.metal, [0.12, 0.58, 0]));
      g.add(metal('axe-edge', box(0.04, 0.3, 0.03), c.metal, [0.26, 0.58, 0]));
      break;
    case 'spear':
      g.add(mesh('spear-shaft', cyl(0.022, 0.022, 1.9), c.wood, [0, 0.35, 0]));
      g.add(metal('spear-tip', cone(0.05, 0.22, 4), c.metal, [0, 1.4, 0]));
      break;
    case 'lance':
      g.add(mesh('lance-shaft', cyl(0.025, 0.07, 2.4), c.shield, [0, 0.85, 0]));
      g.add(metal('lance-tip', cone(0.03, 0.2, 5), c.metal, [0, 2.15, 0]));
      g.add(metal('lance-guard', cyl(0.05, 0.14, 0.22, 7), c.metal, [0, 0.12, 0]));
      break;
    case 'hammer':
      g.add(mesh('hammer-handle', cyl(0.03, 0.03, 0.75), c.wood, [0, 0.25, 0]));
      g.add(metal('hammer-head', box(0.14, 0.14, 0.3), c.metal, [0, 0.62, 0]));
      break;
    case 'bow': {
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.6, -0.18), new THREE.Vector3(0, 0, 0.2), new THREE.Vector3(0, 0.6, -0.18));
      const pts = curve.getPoints(8).map((p) => [p.x, p.y, p.z] as [number, number, number]);
      g.add(mesh('bow-limbs', sweep(pts, [0.018, 0.026, 0.03, 0.032, 0.032, 0.032, 0.03, 0.026, 0.018], 5), c.wood));
      g.add(detail(mesh('bow-string', beam([0, -0.6, -0.18], [0, 0.6, -0.18], 0.006, 0.006, 3), '#e8e0c8')));
      break;
    }
    case 'staff':
      g.add(mesh('staff-shaft', cyl(0.026, 0.03, 1.6), c.wood, [0, 0.3, 0]));
      g.add(mesh('staff-orb', ball(0.085, 1), c.orb, [0, 1.18, 0], [0, 0, 0], { emissive: 0.6 }));
      g.add(detail(mesh('staff-cradle', cone(0.07, 0.1, 5), shade(c.wood, 0.8), [0, 1.1, 0], [Math.PI, 0, 0])));
      // Spells (lightning, flame) leave from the orb.
      g.add(socket('staff.tip', [0, 1.18, 0]));
      break;
    case 'musket': {
      // Flintlock musket: in the aim pose the barrel runs along +Z from the firing hand.
      const iron = shade(c.metal, 0.55);
      g.add(mesh('musket-butt', box(0.075, 0.15, 0.24), c.wood, [0, -0.045, -0.24], [0.18, 0, 0]));
      g.add(mesh('musket-wrist', box(0.05, 0.075, 0.18), c.wood, [0, -0.005, -0.05]));
      g.add(mesh('musket-forestock', box(0.06, 0.055, 0.62), c.wood, [0, 0.012, 0.33]));
      g.add(metal('musket-barrel', beam([0, 0.052, -0.08], [0, 0.052, 0.92], 0.02, 0.017, 6), iron));
      g.add(detail(metal('musket-muzzle-ring', cyl(0.025, 0.025, 0.035, 6), iron, [0, 0.052, 0.9], [Math.PI / 2, 0, 0])));
      g.add(detail(metal('musket-band', cyl(0.036, 0.036, 0.03, 6), c.metal, [0, 0.03, 0.46], [Math.PI / 2, 0, 0])));
      g.add(detail(metal('musket-lock', box(0.014, 0.045, 0.1), c.metal, [0.036, 0.03, 0.02])));
      g.add(detail(metal('musket-hammer', box(0.012, 0.05, 0.022), iron, [0.04, 0.075, -0.015], [-0.4, 0, 0])));
      g.add(detail(metal('musket-trigger-guard', new THREE.TorusGeometry(0.028, 0.006, 3, 8, Math.PI), c.metal, [0, -0.04, 0.02], [0, Math.PI / 2, Math.PI])));
      g.add(detail(metal('musket-bayonet', cone(0.014, 0.26, 4), c.metal, [0.022, 0.03, 1.06], [Math.PI / 2, 0, 0])));
      g.add(socket('muzzle', [0, 0.052, 0.95]));
      break;
    }
    case 'pitchfork':
      g.add(mesh('fork-shaft', cyl(0.024, 0.024, 1.5), c.wood, [0, 0.3, 0]));
      g.add(metal('fork-bar', box(0.26, 0.03, 0.03), c.metal, [0, 1.05, 0]));
      for (const x of [-0.12, 0, 0.12]) g.add(detail(metal(`fork-tine-${x}`, cone(0.014, 0.28, 4), c.metal, [x, 1.2, 0])));
      break;
    case 'stone':
      g.add(mesh('held-stone', jitter(new THREE.IcosahedronGeometry(0.11, 0), 0.04, 5), '#8d8a84', [0, 0.02, 0.04]));
      break;
  }
  return g;
}

export function createOffhandModel(kind: OffhandKind, c: WeaponColors): THREE.Group | null {
  if (kind === 'none') return null;
  const g = new THREE.Group();
  g.name = `offhand-${kind}`;
  const rim = shade(c.shield, 0.6);
  if (kind === 'shield-round' || kind === 'buckler') {
    const r = kind === 'buckler' ? 0.2 : 0.34;
    g.add(mesh('shield-face', cyl(r, r, 0.05, 10), c.shield, [0, 0, 0.08], [Math.PI / 2, 0, 0]));
    g.add(detail(metal('shield-boss', ball(r * 0.25, 0), c.metal, [0, 0, 0.12])));
    g.add(detail(mesh('shield-rim', new THREE.TorusGeometry(r, 0.025, 4, 10), rim, [0, 0, 0.08])));
  } else {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.38);
    shape.lineTo(0.26, 0.28);
    shape.lineTo(0.22, -0.1);
    shape.lineTo(0, -0.46);
    shape.lineTo(-0.22, -0.1);
    shape.lineTo(-0.26, 0.28);
    shape.closePath();
    const face = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
    g.add(mesh('shield-face', face, c.shield, [0, 0, 0.06]));
    g.add(detail(metal('shield-cross-v', box(0.06, 0.7, 0.02), shade(c.metal, 0.9), [0, -0.03, 0.12])));
    g.add(detail(metal('shield-cross-h', box(0.4, 0.06, 0.02), shade(c.metal, 0.9), [0, 0.15, 0.12])));
  }
  return g;
}
