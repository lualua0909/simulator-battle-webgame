// Unit portrait thumbnails rendered from the real procedural models (one shared context).
import * as THREE from 'three';
import type { ConfigBundle } from '@/shared/schema';
import { getUnitTemplate } from '../models';
import { attackStyleFor, Poser } from './animate';

const cache = new Map<string, Promise<Record<string, string>>>();

export function unitThumbnails(bundle: ConfigBundle): Promise<Record<string, string>> {
  let p = cache.get(bundle.version);
  if (!p) {
    p = render(bundle);
    cache.set(bundle.version, p);
  }
  return p;
}

async function render(bundle: ConfigBundle): Promise<Record<string, string>> {
  const size = 112;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#f2f8ff', '#6b5a3a', 1.8));
  const sun = new THREE.DirectionalLight('#fff4de', 2.4);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  const assets = new Map(bundle.assets.map((a) => [a.id, a]));
  const weapons = new Map(bundle.weapons.map((w) => [w.id, w]));
  const out: Record<string, string> = {};
  for (const unit of bundle.units) {
    const template = getUnitTemplate(unit, assets);
    const poses = template.parts.map(() => new THREE.Matrix4());
    new Poser(template, attackStyleFor(template, weapons.get(unit.weaponId))).compute(
      { time: 0.4, speed: 0, phase: 0, attack: -1, airborne: false, stunned: false, leanX: 0, leanZ: 0, seed: 0, refSpeed: 1 },
      poses,
    );
    const group = new THREE.Group();
    template.parts.forEach((p, i) => {
      if (!p.geometry) return;
      const m = new THREE.Mesh(p.geometry, material);
      m.matrixAutoUpdate = false;
      m.matrix.copy(poses[i]);
      group.add(m);
    });
    scene.add(group);
    const b = template.bounds;
    const center = b.getCenter(new THREE.Vector3());
    const radius = b.getSize(new THREE.Vector3()).length() * 0.5;
    const dist = radius / Math.tan((camera.fov * Math.PI) / 360) * 1.02;
    camera.position.set(center.x + Math.sin(0.6) * dist, center.y + dist * 0.25, center.z + Math.cos(0.6) * dist);
    camera.lookAt(center);
    renderer.render(scene, camera);
    out[unit.id] = renderer.domElement.toDataURL('image/png');
    scene.remove(group);
    await new Promise((r) => setTimeout(r, 0));
  }
  material.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
