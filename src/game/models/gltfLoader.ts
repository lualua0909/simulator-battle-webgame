// Shared GLTFLoader with Draco mesh decoding (decoder files live in public/draco,
// copied from three's examples/jsm/libs/draco so they always match the three version).
// Committed packs like voi-mamut.glb use KHR_draco_mesh_compression: without a
// DRACOLoader instance GLTFLoader throws "No DRACOLoader instance provided" and the
// model never appears (blank workshop preview, missing battle unit).
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let shared: GLTFLoader | null = null;

/** Process-wide loader for every runtime .glb (battle, previews, thumbnails, tint editor). */
export function getGLTFLoader(): GLTFLoader {
  if (!shared) {
    const draco = new DRACOLoader();
    // public/ is served at the site root (no basePath in use); the decoder loads lazily
    // on the first Draco mesh, so non-Draco packs pay nothing.
    draco.setDecoderPath('/draco/');
    shared = new GLTFLoader();
    shared.setDRACOLoader(draco);
  }
  return shared;
}
