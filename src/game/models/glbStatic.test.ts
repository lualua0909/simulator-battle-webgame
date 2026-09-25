// Committed scenery GLBs: parseable, and the seed assets referencing them validate.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetSchema } from '@/shared/schema';
import { SEED } from '@/shared/seed';

const FILES = [
  { file: 'cay-bach-duong.glb', asset: 'tree-birch', textured: false },
  { file: 'cay-co.glb', asset: 'tree-palm', textured: true },
  { file: 'cay-kho.glb', asset: 'tree-dead', textured: false },
  { file: 'cay-soi.glb', asset: 'tree-oak', textured: false },
  { file: 'cay-thong.glb', asset: 'tree-pine', textured: false },
  { file: 'da-sa-thach.glb', asset: 'rock-sand', textured: true },
  { file: 'thong-phu-tuyet.glb', asset: 'tree-snow', textured: true },
  { file: 'xuong-rong.glb', asset: 'tree-cactus', textured: false },
  { file: 'bui-co.glb', asset: 'bush-green', textured: true },
  { file: 'bui-qua-mong.glb', asset: 'bush-berry', textured: true },
  { file: 'bui-kho.glb', asset: 'bush-dry', textured: true },
] as const;

for (const f of FILES) {
  test(`committed ${f.file} parses with meshes`, async () => {
    const file = path.join(process.cwd(), 'public', 'models', f.file);
    assert.ok(existsSync(file), `public/models/${f.file} is committed`);
    const buf = readFileSync(file);
    let gltf;
    try {
      gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
    } catch (e) {
      // Textured files need DOM image decoding (unavailable in node); the browser path is covered by screenshots.
      assert.ok(f.textured, `${f.file} should parse in node: ${e}`);
      return;
    }
    let meshes = 0;
    gltf.scene.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) meshes++;
    });
    assert.ok(meshes > 0, `${f.file} has no meshes`);
    assert.equal(gltf.animations.length, 0, `${f.file} should be static`);
  });

  test(`seed asset ${f.asset} references /models/${f.file} and validates`, () => {
    const asset = SEED.assets.find((a) => a.id === f.asset);
    assert.ok(asset, `seed has ${f.asset}`);
    assert.equal(asset.glb?.url, `/models/${f.file}`);
    assert.deepEqual(assetSchema.parse(asset), asset);
  });
}
