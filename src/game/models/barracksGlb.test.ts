import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { cloneBarracks, playBarracksDoor, releaseBarracks, stepBarracks } from './barracksGlb';
import { getGLTFLoader } from './gltfLoader';

test('barracks stays grounded when battle placement replaces root transforms', async (t) => {
  const scene = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
  body.position.set(4, 0, -3);
  scene.add(body);
  const door = new THREE.Group();
  door.name = 'Door';
  scene.add(door);
  const clip = new THREE.AnimationClip('Door_OpenClose', 1, [
    new THREE.NumberKeyframeTrack('Door.rotation[y]', [0, 0.5, 1], [0, 1, 0]),
  ]);
  t.mock.method(getGLTFLoader(), 'loadAsync', async () => ({ scene, animations: [clip] }) as GLTF);
  const url = '/test/barracks-grounding.glb';
  assert.equal(cloneBarracks(url), null);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const inst = cloneBarracks(url)!;
  assert.ok(inst);
  inst.group.scale.setScalar(3.75);
  inst.group.position.set(-3, 0.4, 2);
  inst.group.rotation.y = Math.PI / 2;
  const box = new THREE.Box3().setFromObject(inst.group);
  assert.ok(Math.abs(box.min.y - 0.4) < 1e-6, `building base is at ${box.min.y}`);
  const center = box.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(center.x + 3) < 1e-6);
  assert.ok(Math.abs(center.z - 2) < 1e-6);
  playBarracksDoor(inst);
  stepBarracks(inst, 0.5);
  assert.equal(inst.group.getObjectByName('Door')!.rotation.y, 1);
  const other = cloneBarracks(url)!;
  assert.equal(other.group.getObjectByName('Door')!.rotation.y, 0);
  releaseBarracks(inst);
  releaseBarracks(other);
  body.geometry.dispose();
  (body.material as THREE.Material).dispose();
});
