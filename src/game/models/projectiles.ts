// Projectile models, authored pointing along +Z (velocity direction).
import type * as THREE from 'three';
import type { ProjectileDef } from '@/shared/schema';
import { ball, beam, box, cone, cyl, detail, faceColors, jitter, mesh, metal, modelRoot } from './common';

export function createProjectileModel(def: Pick<ProjectileDef, 'model' | 'color' | 'scale'>): THREE.Group {
  const root = modelRoot(`projectile-${def.model}`, 'static');
  const tint = def.color.toLowerCase() === '#ffffff' ? null : def.color;
  switch (def.model) {
    case 'arrow':
      root.add(mesh('arrow-shaft', beam([0, 0, -0.42], [0, 0, 0.36], 0.013, 0.013, 4), '#b58a55'));
      root.add(metal('arrow-head', cone(0.035, 0.1, 4), tint ?? '#9aa3ad', [0, 0, 0.4], [Math.PI / 2, 0, 0]));
      root.add(mesh('arrow-fletch-a', box(0.1, 0.004, 0.16), tint ?? '#efe6cf', [0, 0, -0.34]));
      root.add(mesh('arrow-fletch-b', box(0.004, 0.1, 0.16), tint ?? '#efe6cf', [0, 0, -0.34]));
      break;
    case 'spear':
      root.add(mesh('spear-shaft', beam([0, 0, -0.95], [0, 0, 0.8], 0.022, 0.022, 5), '#8a5a2b'));
      root.add(metal('spear-tip', cone(0.05, 0.22, 4), '#c9ced6', [0, 0, 0.9], [Math.PI / 2, 0, 0]));
      break;
    case 'stone':
      root.add(mesh('stone', faceColors(jitter(ball(0.12, 0), 0.05, 3), '#8d8a84', '#6a675f', 3), '#8d8a84'));
      break;
    case 'boulder':
      root.add(mesh('boulder', faceColors(jitter(ball(0.5, 1), 0.18, 4), '#8d8a84', '#5f5c56', 4), '#8d8a84'));
      break;
    case 'fireball':
      root.add(mesh('fireball-core', ball(0.22, 1), '#fff1a8', [0, 0, 0], [0, 0, 0], { emissive: 1 }));
      root.add(mesh('fireball-shell', jitter(ball(0.36, 1), 0.08, 5), tint ?? '#ff7a1a', [0, 0, 0], [0, 0, 0], { emissive: 0.8 }));
      break;
    case 'orb':
      root.add(mesh('orb', ball(0.2, 1), tint ?? '#b36bff', [0, 0, 0], [0, 0, 0], { emissive: 1 }));
      break;
    case 'bullet':
      // Tracer: a hot lead ball dragging a long glowing streak behind it.
      root.add(mesh('bullet-ball', ball(0.055, 0), tint ?? '#ffe7a0', [0, 0, 0.05], [0, 0, 0], { emissive: 1 }));
      root.add(mesh('bullet-streak', beam([0, 0, -1.8], [0, 0, 0.04], 0.008, 0.042, 5), tint ?? '#ffe7a0', [0, 0, 0], [0, 0, 0], { emissive: 1 }));
      break;
    case 'meteor':
      // Burning rock with a flame cone streaming back from the direction of travel.
      root.add(mesh('meteor-rock', faceColors(jitter(ball(0.45, 1), 0.16, 7), '#3a2a22', '#ff6a1a', 7, 0.85), '#3a2a22'));
      root.add(mesh('meteor-glow', jitter(ball(0.36, 1), 0.1, 9), '#ffd27a', [0, 0, 0.08], [0, 0, 0], { emissive: 1 }));
      root.add(mesh('meteor-flame', jitter(cone(0.46, 1.5, 7), 0.1, 11), tint ?? '#ff6a1a', [0, 0, -0.72], [-Math.PI / 2, 0, 0], { emissive: 0.9 }));
      root.add(detail(mesh('meteor-flame-core', cone(0.24, 1.0, 6), '#ffd27a', [0, 0, -0.5], [-Math.PI / 2, 0, 0], { emissive: 1 })));
      break;
    case 'shuriken':
      // Four-point star lying in the flight plane.
      for (let i = 0; i < 4; i++) root.add(metal(`shuriken-blade-${i}`, cone(0.045, 0.16, 3).rotateX(Math.PI / 2).translate(0, 0, 0.08).rotateY((i * Math.PI) / 2), tint ?? '#c9ced6'));
      root.add(metal('shuriken-hub', cyl(0.035, 0.035, 0.02, 6), '#3a3a40'));
      break;
  }
  root.scale.setScalar(def.scale);
  return root;
}
