// Opt-in WebGPU backend for the battle engine, loaded only when picked (see BattleEngine.loadGpu).
// Stock materials convert themselves to node materials; only the two hand-written shaders need TSL twins.
import * as THREE from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, WebGPURenderer } from 'three/webgpu';
import { clamp, cos, mix, normalize, positionLocal, sin, uniform, varying, vec3 } from 'three/tsl';

export function createRenderer(antialias: boolean): WebGPURenderer {
  return new WebGPURenderer({ antialias });
}

/** Sky dome gradient, same maths as the engine's GLSL sky. `top`/`bottom` are read live. */
export function skyMaterial(top: THREE.Color, bottom: THREE.Color): THREE.Material {
  const dir = varying(normalize(positionLocal));
  const m = new MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  m.colorNode = mix(uniform(bottom), uniform(top), clamp(dir.y.mul(1.6).add(0.12), 0, 1));
  return m;
}

/** River surface with the same GPU ripples as createWater's onBeforeCompile. */
export function waterMaterial(params: THREE.MeshStandardMaterialParameters): { material: THREE.Material; time: { value: number } } {
  const time = uniform(0);
  const p = positionLocal;
  const m = new MeshStandardNodeMaterial(params);
  m.positionNode = p.add(vec3(0, sin(p.x.mul(0.9).add(time.mul(1.6))).mul(0.05).add(cos(p.z.mul(0.5).add(time.mul(1.1))).mul(0.06)), 0));
  return { material: m, time };
}
