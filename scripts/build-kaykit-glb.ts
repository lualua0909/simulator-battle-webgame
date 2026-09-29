// Packs the KayKit models (sources in assets/kaykit-hex/) the diorama map uses into one public/models/kaykit-hex.glb:
// one texture, one material, quantized + meshopt-compressed geometry, a root node per model name.
//   npx tsx scripts/build-kaykit-glb.ts
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { KAYKIT_MODELS, kaykitSource } from '../src/game/render/kaykitModels';

const SRC = path.join(process.cwd(), 'assets/kaykit-hex');
const OUT = path.join(process.cwd(), 'public/models/kaykit-hex.glb');

async function main() {
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('kaykit');
  let material: ReturnType<Document['createMaterial']> | null = null;
  for (const name of KAYKIT_MODELS) {
    const src = await io.read(path.join(SRC, kaykitSource(name)));
    const srcMat = src.getRoot().listMaterials()[0];
    if (!material) {
      // Every KayKit model shares the one palette texture: copy it once.
      const tex = srcMat.getBaseColorTexture()!;
      const image = doc.createTexture('hexagons_medieval').setImage(tex.getImage()!).setMimeType(tex.getMimeType());
      material = doc.createMaterial('kaykit').setBaseColorTexture(image).setRoughnessFactor(srcMat.getRoughnessFactor()).setMetallicFactor(srcMat.getMetallicFactor());
    }
    const mesh = doc.createMesh(name);
    for (const srcMesh of src.getRoot().listMeshes()) {
      for (const srcPrim of srcMesh.listPrimitives()) {
        const prim = doc.createPrimitive().setMaterial(material);
        for (const semantic of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
          const a = srcPrim.getAttribute(semantic);
          if (a) prim.setAttribute(semantic, doc.createAccessor().setType(a.getType()).setArray(a.getArray()!.slice()).setBuffer(buffer));
        }
        const idx = srcPrim.getIndices();
        if (idx) prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(idx.getArray()!.slice()).setBuffer(buffer));
        mesh.addPrimitive(prim);
      }
    }
    // The pack's nodes carry no transforms; keep the model name on the node the runtime looks up.
    scene.addChild(doc.createNode(name).setMesh(mesh));
  }
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await doc.transform(weld(), dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(OUT, doc);
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${KAYKIT_MODELS.length} models)`);
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
