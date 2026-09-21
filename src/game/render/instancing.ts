// Instanced buffers are sized for the whole pool, but three.js re-sends the entire array
// whenever one is flagged without update ranges. These upload only what is drawn.
import type * as THREE from 'three';

/** Sets the draw count and uploads just the first `count` instances (nothing when empty). */
export function commitInstances(mesh: THREE.InstancedMesh, count: number): void {
  mesh.count = count;
  if (count === 0) return;
  markPrefix(mesh.instanceMatrix, count);
  if (mesh.instanceColor) markPrefix(mesh.instanceColor, count);
}

/** Uploads one rewritten instance slot (ranges accumulate until the next render). */
export function commitInstance(mesh: THREE.InstancedMesh, slot: number): void {
  const m = mesh.instanceMatrix;
  m.addUpdateRange(slot * m.itemSize, m.itemSize);
  m.needsUpdate = true;
}

function markPrefix(attr: THREE.InstancedBufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count * attr.itemSize);
  attr.needsUpdate = true;
}
