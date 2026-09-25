// The shared runtime loader must carry a Draco decoder: Draco-compressed packs
// (e.g. voi-mamut.glb) throw "No DRACOLoader instance provided" and render blank
// when loaded with a bare `new GLTFLoader()`.
import assert from 'node:assert/strict';
import test from 'node:test';
import { getGLTFLoader } from '@/game/models/gltfLoader';

test('shared glb loader is a singleton with a Draco decoder attached', () => {
  const a = getGLTFLoader();
  assert.equal(getGLTFLoader(), a, 'expected one shared loader');
  const draco = (a as unknown as { dracoLoader?: unknown }).dracoLoader;
  assert.ok(draco, 'GLTFLoader has no DRACOLoader (Draco packs would fail to load)');
});
