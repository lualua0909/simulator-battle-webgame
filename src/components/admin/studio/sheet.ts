'use client';

// Render sheet for the img2threejs review loop: the model as the game draws it (baked
// vertex colours, idle pose with any held weapon raised in guard) from the front, front
// three-quarter, its left side (+X) and back, on a 0.5 m grid — the layout the review
// prompt describes.
import * as THREE from 'three';
import { bakeModel } from '@/game/models/bake';
import { Poser, type AttackStyle } from '@/game/render/animate';
import { buildSculptModel } from '@/game/sculpt/build';
import type { SculptSpec } from '@/shared/sculpt';

const VIEWS = [
  { label: 'Trước', yaw: 0 },
  { label: '¾ trước', yaw: 35 },
  { label: 'Bên trái (+X)', yaw: 90 },
  { label: 'Sau', yaw: 180 },
];

export async function renderSheet(spec: SculptSpec, cell = 512): Promise<string> {
  const template = bakeModel(buildSculptModel(spec));
  const style: AttackStyle = spec.weaponStyle === 'bow' ? 'bow' : spec.weaponStyle === 'thrust' ? 'thrust' : 'swing';
  const poses = template.parts.map(() => new THREE.Matrix4());
  new Poser(template, style).compute({ time: 0, speed: 0, phase: 0, attack: -1, airborne: false, stunned: false, leanX: 0, leanZ: 0, seed: 0, refSpeed: 1 }, poses);

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  const model = new THREE.Group();
  template.parts.forEach((p, i) => {
    if (!p.geometry) return;
    const m = new THREE.Mesh(p.geometry, material);
    m.matrixAutoUpdate = false;
    m.matrix.copy(poses[i]);
    model.add(m);
  });

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(cell, cell);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dfe6ec');
    scene.add(new THREE.HemisphereLight('#f4f8ff', '#8a7a5a', 1.7));
    const key = new THREE.DirectionalLight('#fff4de', 2.2);
    scene.add(key, key.target, model);

    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model, true);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.2) * 0.5;
    const extent = Math.ceil((radius * 3.2) / 0.5) * 0.5;
    scene.add(new THREE.GridHelper(extent * 2, Math.round((extent * 2) / 0.5), '#7a8794', '#aab4be'));

    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, radius * 50);
    const dist = (radius / Math.tan((camera.fov * Math.PI) / 360)) * 1.25;
    const canvas = document.createElement('canvas');
    canvas.width = cell * 2;
    canvas.height = cell * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 18px sans-serif';
    VIEWS.forEach((view, i) => {
      const yaw = (view.yaw * Math.PI) / 180;
      const pitch = (12 * Math.PI) / 180;
      camera.position.set(center.x + Math.sin(yaw) * Math.cos(pitch) * dist, center.y + Math.sin(pitch) * dist, center.z + Math.cos(yaw) * Math.cos(pitch) * dist);
      camera.lookAt(center);
      // Key light rides with the camera, up and to one side, so every view reads its form.
      key.position.copy(camera.position).add(new THREE.Vector3(Math.cos(yaw) * radius * 2, radius * 3, -Math.sin(yaw) * radius * 2));
      key.target.position.copy(center);
      renderer.render(scene, camera);
      const x = (i % 2) * cell;
      const y = Math.floor(i / 2) * cell;
      ctx.drawImage(renderer.domElement, x, y);
      ctx.fillStyle = 'rgba(31,26,20,0.75)';
      ctx.fillRect(x + 8, y + 8, 150, 30);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(view.label, x + 16, y + 30);
    });
    ctx.strokeStyle = '#1f1a14';
    ctx.lineWidth = 2;
    ctx.strokeRect(cell, 0, 0, cell * 2);
    ctx.strokeRect(0, cell, cell * 2, 0);
    ctx.fillStyle = 'rgba(31,26,20,0.75)';
    ctx.fillRect(cell * 2 - 220, cell * 2 - 38, 212, 30);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`cao ${size.y.toFixed(2)} m · ô lưới 0.5 m`, cell * 2 - 212, cell * 2 - 16);
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    for (const p of template.parts) p.geometry?.dispose();
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
