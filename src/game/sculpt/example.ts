// A complete, gate-passing humanoid sculpt spec in the compact form Claude writes (defaults
// omitted). It is the few-shot example in the studio prompt and a test fixture; its pivots
// match the procedural humanoid the game animates (models/humanoid.ts).
import type { z } from 'zod';
import type { sculptSpecSchema } from '@/shared/sculpt';

export const EXAMPLE_HUMANOID_SPEC: z.input<typeof sculptSpecSchema> = {
  name: 'Example Knight',
  rig: 'humanoid',
  weaponStyle: 'swing',
  materials: [
    { id: 'skin', color: '#f2c29b' },
    { id: 'tunic', color: '#2f5fb3' },
    { id: 'pants', color: '#4a4f58' },
    { id: 'leather', color: '#5a3a22' },
    { id: 'steel', color: '#c9ced6', roughness: 0.45, metalness: 0.35 },
    { id: 'red', color: '#b3262e' },
    { id: 'ink', color: '#141414' },
  ],
  nodes: [
    { name: 'hips', type: 'part', position: [0, 0.5, 0] },
    { name: 'pelvis', parent: 'hips', type: 'mesh', position: [0, 0.03, 0], shape: { type: 'ellipsoid', radii: [0.24, 0.14, 0.2] }, material: 'pants' },
    { name: 'thighL', parent: 'hips', type: 'part', position: [0.13, 0, 0], mirror: true },
    { name: 'thighMeshL', parent: 'thighL', type: 'mesh', shape: { type: 'capsule', from: [0, 0, 0], to: [0, -0.216, 0], radius: 0.09 }, material: 'pants' },
    { name: 'shinL', parent: 'thighL', type: 'part', position: [0, -0.23, 0] },
    { name: 'shinMeshL', parent: 'shinL', type: 'mesh', shape: { type: 'capsule', from: [0, 0, 0], to: [0, -0.165, 0], radius: 0.078 }, material: 'pants' },
    { name: 'bootL', parent: 'shinL', type: 'mesh', position: [0, -0.2, 0.04], shape: { type: 'ellipsoid', radii: [0.09, 0.065, 0.14] }, material: 'leather' },

    { name: 'torso', parent: 'hips', type: 'part', position: [0, 0.05, 0] },
    { name: 'chest', parent: 'torso', type: 'mesh', position: [0, 0.38, 0], shape: { type: 'ellipsoid', radii: [0.3, 0.42, 0.25] }, material: 'tunic' },
    { name: 'breastplate', parent: 'torso', type: 'mesh', position: [0, 0.43, 0.02], shape: { type: 'ellipsoid', radii: [0.31, 0.36, 0.25] }, material: 'steel' },
    { name: 'belt', parent: 'torso', type: 'mesh', position: [0, 0.1, 0], rotation: [1.5708, 0, 0], shape: { type: 'torus', radius: 0.29, tube: 0.032 }, material: 'leather', detail: true },

    { name: 'armL', parent: 'torso', type: 'part', position: [0.29, 0.62, 0], mirror: true },
    { name: 'upperArmL', parent: 'armL', type: 'mesh', shape: { type: 'capsule', from: [0, 0, 0], to: [0, -0.225, 0], radius: 0.075 }, material: 'tunic' },
    { name: 'pauldronL', parent: 'armL', type: 'mesh', position: [0.02, 0.02, 0], shape: { type: 'ellipsoid', radii: [0.13, 0.09, 0.13] }, material: 'steel' },
    { name: 'forearmL', parent: 'armL', type: 'part', position: [0, -0.24, 0] },
    { name: 'forearmMeshL', parent: 'forearmL', type: 'mesh', shape: { type: 'capsule', from: [0, 0, 0], to: [0, -0.195, 0], radius: 0.068 }, material: 'steel' },
    { name: 'handL', parent: 'forearmL', type: 'mesh', position: [0, -0.22, 0], shape: { type: 'sphere', radius: 0.08 }, material: 'skin' },
    { name: 'hand.L', parent: 'forearmL', type: 'socket', position: [0, -0.23, 0], rotation: [1.5708, 0, 0] },
    { name: 'offhand', parent: 'forearmL', type: 'part', position: [0, -0.23, 0], rotation: [1.5708, 0, 0], oneSided: true },
    { name: 'shieldBoard', parent: 'offhand', type: 'mesh', position: [0, 0, 0.1], rotation: [1.5708, 0, 0], shape: { type: 'cylinder', radiusTop: 0.3, radiusBottom: 0.3, height: 0.05, radialSegments: 10 }, material: 'red' },
    { name: 'shieldBoss', parent: 'offhand', type: 'mesh', position: [0, 0, 0.13], shape: { type: 'sphere', radius: 0.07, detail: 0 }, material: 'steel', detail: true },

    { name: 'weapon', parent: 'forearmR', type: 'part', position: [0, -0.23, 0], rotation: [1.5708, 0, 0] },
    { name: 'grip', parent: 'weapon', type: 'mesh', shape: { type: 'cylinder', radiusTop: 0.022, radiusBottom: 0.022, height: 0.2, radialSegments: 6 }, material: 'leather' },
    { name: 'crossguard', parent: 'weapon', type: 'mesh', position: [0, 0.1, 0], shape: { type: 'box', size: [0.22, 0.04, 0.05] }, material: 'steel' },
    { name: 'blade', parent: 'weapon', type: 'mesh', position: [0, 0.12, 0], shape: { type: 'extrude', outline: [[-0.035, 0], [0.035, 0], [0.035, 0.55], [0, 0.64], [-0.035, 0.55]], depth: 0.02 }, material: 'steel' },
    { name: 'pommel', parent: 'weapon', type: 'mesh', position: [0, -0.11, 0], shape: { type: 'sphere', radius: 0.035, detail: 0 }, material: 'steel', detail: true },

    { name: 'head', parent: 'torso', type: 'part', position: [0, 0.8, 0] },
    { name: 'skull', parent: 'head', type: 'mesh', position: [0, 0.19, 0], shape: { type: 'sphere', radius: 0.2 }, material: 'skin' },
    { name: 'eyeL', parent: 'head', type: 'mesh', position: [0.075, 0.21, 0.176], shape: { type: 'sphere', radius: 0.034, detail: 0 }, material: 'ink', detail: true, mirror: true },
    { name: 'helmet', parent: 'head', type: 'mesh', position: [0, 0.21, 0], shape: { type: 'dome', radius: 0.225 }, material: 'steel' },
    { name: 'noseGuard', parent: 'head', type: 'mesh', position: [0, 0.21, 0.215], shape: { type: 'box', size: [0.03, 0.12, 0.03] }, material: 'steel', detail: true },
    { name: 'plume', parent: 'head', type: 'mesh', shape: { type: 'sweep', points: [[0, 0.42, 0], [0, 0.52, -0.08], [0, 0.5, -0.22]], radii: [0.035, 0.012], radialSegments: 5 }, material: 'red' },
    { name: 'head.top', parent: 'head', type: 'socket', position: [0, 0.44, 0] },

    { name: 'cape', parent: 'torso', type: 'part', position: [0, 0.7, -0.2] },
    { name: 'capeCloth', parent: 'cape', type: 'mesh', position: [0, -0.42, 0], rotation: [0.12, 0, 0], shape: { type: 'box', size: [0.46, 0.85, 0.03] }, material: 'red' },
  ],
};
