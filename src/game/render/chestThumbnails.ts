// Transparent PNG thumbnails of the reward chests for the box menu (one shared context, cached).
import * as THREE from 'three';
import type { ChestVariant } from '@/shared/schema';
import { CHEST_PRESETS, createChestModel } from '../models/chest';

const cache = new Map<ChestVariant, Promise<string>>();

export function chestThumbnail(variant: ChestVariant): Promise<string> {
  let p = cache.get(variant);
  if (!p) {
    p = Promise.resolve().then(() => render(variant));
    cache.set(variant, p);
  }
  return p;
}

function render(variant: ChestVariant): string {
  const size = 192;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#eef6ff', '#4a3a66', 1.7));
  const key = new THREE.DirectionalLight('#fff1dc', 2.7);
  key.position.set(2.5, 4, 3.5);
  scene.add(key);
  const chest = createChestModel(CHEST_PRESETS[variant]);
  chest.rotation.y = -0.38;
  scene.add(chest);
  const bounds = new THREE.Box3().setFromObject(chest);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getSize(new THREE.Vector3()).length() * 0.5;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  const dist = (radius / Math.tan((camera.fov * Math.PI) / 360)) * 1.02;
  camera.position.set(center.x, center.y + dist * 0.38, center.z + dist);
  camera.lookAt(center);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  chest.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  renderer.dispose();
  renderer.forceContextLoss();
  return url;
}
