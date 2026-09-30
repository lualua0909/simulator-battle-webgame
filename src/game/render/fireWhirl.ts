// Fire tornado look: nested open funnels painted with a procedural flame texture that scrolls up
// and around (a spiral of licking tongues), blended additively so the layers stack into a hot core,
// plus a glowing scorch disc at its foot. Stock materials only, so WebGL and WebGPU both run it.
import * as THREE from 'three';
import { GLOW_LAYER } from './glow';

interface Layer {
  /** Funnel radius and height, relative to the whirl's. */
  widen: number;
  tall: number;
  /** Flame tongues around the funnel, and how far they wrap going up (turns). */
  tongues: number;
  twist: number;
  /** Texture scroll: up (tiles/s) and around (tiles/s); spin of the mesh (rad/s). */
  rise: number;
  swirl: number;
  spin: number;
  heat: number;
  /** Additive and blooming (the hot inner layers); otherwise a sheet of flame that hides what is behind. */
  glow: boolean;
}

const LAYERS: readonly Layer[] = [
  { widen: 1, tall: 1, tongues: 2, twist: 0.6, rise: 0.8, swirl: 0.1, spin: -2.4, heat: 0.55, glow: false },
  { widen: 0.68, tall: 0.92, tongues: 2, twist: 0.9, rise: 1.3, swirl: 0.18, spin: -4, heat: 0.85, glow: false },
  { widen: 0.34, tall: 0.75, tongues: 1, twist: 1.2, rise: 2, swirl: 0.3, spin: -6.5, heat: 0.9, glow: true },
];

const TEX = 128;

/** Tileable value noise on a `period`-cell lattice. */
function lattice(period: number, seed: number): (x: number, y: number) => number {
  const cells = new Float32Array(period * period);
  let s = seed;
  for (let i = 0; i < cells.length; i++) {
    s = (s * 16807) % 2147483647;
    cells[i] = s / 2147483647;
  }
  const at = (i: number, j: number) => cells[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}

/** Flame sheet: tall tongues of heat (tiles both ways), coloured from ember red to white-hot. */
function flameTexture(color: THREE.Color): THREE.DataTexture {
  const octaves = [lattice(6, 7), lattice(12, 19), lattice(24, 41)];
  const low = color.clone().multiplyScalar(0.3);
  const mid = color.clone();
  const high = color.clone().lerp(new THREE.Color('#ffe9a0'), 0.6);
  const c = new THREE.Color();
  const data = new Uint8Array(TEX * TEX * 4);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const u = x / TEX;
      const v = y / TEX;
      // Stretched vertically so the heat rises in tongues rather than blobs.
      let n = 0;
      let amp = 0.55;
      let wsum = 0;
      for (let o = 0; o < octaves.length; o++) {
        const period = 6 << o;
        n += octaves[o](u * period, v * period * 0.35 + o * 1.7) * amp;
        wsum += amp;
        amp *= 0.5;
      }
      n /= wsum;
      // Two broad tongues per tile, their edges torn by the noise.
      const tongue = 0.5 + 0.5 * Math.cos(u * Math.PI * 2 * 2 + n * 6);
      const heat = THREE.MathUtils.smoothstep(n * 0.8 + tongue * 0.45, 0.4, 1);
      if (heat < 0.5) c.copy(low).lerp(mid, heat * 2).multiplyScalar(heat * 2);
      else c.copy(mid).lerp(high, (heat - 0.5) * 2);
      const i = (y * TEX + x) * 4;
      data[i] = Math.min(255, c.r * 255);
      data[i + 1] = Math.min(255, c.g * 255);
      data[i + 2] = Math.min(255, c.b * 255);
      data[i + 3] = heat * 255;
    }
  }
  const tex = new THREE.DataTexture(data, TEX, TEX);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Soft radial glow for the burning ground under the whirl. */
function glowTexture(color: THREE.Color): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  const hot = color.clone().lerp(new THREE.Color('#ffd890'), 0.5);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x / (n - 1) - 0.5, y / (n - 1) - 0.5) * 2;
      const k = Math.max(0, 1 - d) ** 2;
      const i = (y * n + x) * 4;
      data[i] = Math.min(255, hot.r * k * 255);
      data[i + 1] = Math.min(255, hot.g * k * 255);
      data[i + 2] = Math.min(255, hot.b * k * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n);
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Open funnel, narrow at the ground and flaring up; UVs wrap in a spiral; heat fades at both ends. */
function funnel(radius: number, height: number, layer: Layer): THREE.BufferGeometry {
  const seg = 28;
  const rows = 14;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const r = radius * layer.widen * (0.35 + 0.95 * t ** 1.5);
    // Bright licks at the foot, dissolving smoke-dark towards the top.
    const fade = THREE.MathUtils.smoothstep(t, 0, 0.12) * (1 - THREE.MathUtils.smoothstep(t, 0.3, 0.95));
    const k = layer.heat * (1.15 - 0.45 * t);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * r, t * height * layer.tall, Math.sin(a) * r);
      uv.push((i / seg) * layer.tongues + t * layer.twist, t);
      col.push(k, k, k, fade);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const b = a + seg + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(index);
  return g;
}

/** Shared geometry, textures and materials of every fire whirl of one size and colour. */
export class FireWhirlKit {
  private readonly shells: { geometry: THREE.BufferGeometry; material: THREE.MeshBasicMaterial; layer: Layer }[] = [];
  private readonly ground: { geometry: THREE.BufferGeometry; material: THREE.MeshBasicMaterial };
  private readonly flame: THREE.DataTexture;
  private tickedAt = -1;

  constructor(
    readonly radius: number,
    readonly height: number,
    color: string,
  ) {
    const c = new THREE.Color(color);
    this.flame = flameTexture(c);
    for (const layer of LAYERS) {
      // Each layer scrolls its own copy (the image is shared).
      const map = this.flame.clone();
      map.needsUpdate = true;
      const material = new THREE.MeshBasicMaterial({
        map,
        vertexColors: true,
        transparent: true,
        blending: layer.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.shells.push({ geometry: funnel(radius, height, layer), material, layer });
    }
    this.ground = {
      geometry: new THREE.CircleGeometry(radius * 1.3, 32).rotateX(-Math.PI / 2),
      material: new THREE.MeshBasicMaterial({ map: glowTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    };
  }

  /** A new whirl's meshes; `spin` holds the shells the renderer turns each frame. */
  build(): { group: THREE.Group; spin: THREE.Mesh[]; ground: THREE.Mesh } {
    const group = new THREE.Group();
    const spin: THREE.Mesh[] = [];
    this.shells.forEach(({ geometry, material, layer }, i) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3 + i;
      mesh.rotation.y = i * 2.1;
      if (layer.glow) mesh.layers.enable(GLOW_LAYER);
      group.add(mesh);
      spin.push(mesh);
    });
    const ground = new THREE.Mesh(this.ground.geometry, this.ground.material);
    ground.position.y = 0.06;
    ground.renderOrder = 2;
    ground.layers.enable(GLOW_LAYER);
    group.add(ground);
    return { group, spin, ground };
  }

  /** Scrolls the flames (once per frame however many whirls share this kit). */
  tick(time: number): void {
    if (time === this.tickedAt) return;
    this.tickedAt = time;
    for (const { material, layer } of this.shells) {
      const map = material.map!;
      map.offset.set(time * layer.swirl, -time * layer.rise);
    }
    this.ground.material.opacity = 0.5 + 0.15 * Math.sin(time * 13) * Math.sin(time * 7.3);
  }

  /** Turns and sways one whirl's shells (the core wanders a little inside the outer sheet). */
  animate(spin: readonly THREE.Mesh[], time: number, phase: number): void {
    spin.forEach((mesh, i) => {
      const layer = this.shells[i].layer;
      mesh.rotation.y = time * layer.spin + i * 2.1 + phase;
      const sway = this.radius * 0.06 * i;
      mesh.position.x = Math.sin(time * 2.3 + i + phase) * sway;
      mesh.position.z = Math.cos(time * 1.7 + i * 1.3 + phase) * sway;
    });
  }

  dispose(): void {
    for (const { geometry, material } of this.shells) {
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
    }
    this.flame.dispose();
    this.ground.geometry.dispose();
    this.ground.material.map?.dispose();
    this.ground.material.dispose();
  }
}
