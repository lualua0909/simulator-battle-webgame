// Wind tornado look: nested open funnels painted with a procedural streak texture (thin gusts that
// wrap the funnel in a spiral and scroll up), a soft tinted haze outside and a bright additive core,
// a swirling dust ring at its foot and leaves / pebbles orbiting the column. Stock materials only,
// so WebGL and WebGPU both run it (same approach as fireWhirl.ts).
import * as THREE from 'three';
import { GLOW_LAYER } from './glow';

interface Layer {
  /** Funnel radius and height, relative to the whirl's. */
  widen: number;
  tall: number;
  /** Streak tiles around the funnel, and how far they wrap going up (turns). */
  wrap: number;
  twist: number;
  /** Texture scroll: up (tiles/s) and around (tiles/s); spin of the mesh (rad/s). */
  rise: number;
  swirl: number;
  spin: number;
  /** Streak brightness (vertex colour) and base opacity of the sheet. */
  light: number;
  alpha: number;
  /** How far the column bends sideways at mid height (× radius). */
  bend: number;
  /** Additive and blooming (the inner core); otherwise a tinted sheet. */
  glow: boolean;
  /** Which texture: soft haze or sharp gust streaks. */
  haze: boolean;
}

const LAYERS: readonly Layer[] = [
  { widen: 1.12, tall: 1, wrap: 1, twist: 0.35, rise: 0.25, swirl: 0.2, spin: -1.8, light: 0.9, alpha: 0.9, bend: 0.28, glow: false, haze: true },
  { widen: 1, tall: 0.98, wrap: 2, twist: 1.1, rise: 0.9, swirl: 0.35, spin: -3.2, light: 1, alpha: 1, bend: 0.22, glow: false, haze: false },
  { widen: 0.74, tall: 0.94, wrap: 2, twist: 1.6, rise: 1.4, swirl: 0.5, spin: -4.8, light: 1, alpha: 1, bend: 0.16, glow: false, haze: false },
  { widen: 0.5, tall: 0.9, wrap: 1, twist: 0.5, rise: 0.6, swirl: 0.3, spin: -5.5, light: 0.85, alpha: 0.85, bend: 0.1, glow: false, haze: true },
  { widen: 0.4, tall: 0.86, wrap: 1, twist: 2.2, rise: 2.2, swirl: 0.8, spin: -7, light: 1, alpha: 1, bend: 0.1, glow: true, haze: false },
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

function toTexture(data: Uint8Array, size: number, wrap: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size);
  if (wrap) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Gust sheet: thin streaks running around the funnel (along u), broken into dashes by noise, white
 * at their hearts and tinted at their edges. `haze` trades the streaks for a soft cloudy veil.
 */
function windTexture(color: THREE.Color, haze: boolean): THREE.DataTexture {
  const shape = lattice(8, 13);
  const breakup = lattice(4, 29);
  const fine = lattice(16, 47);
  const white = new THREE.Color('#ffffff');
  const c = new THREE.Color();
  const data = new Uint8Array(TEX * TEX * 4);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const u = x / TEX;
      const v = y / TEX;
      let a: number;
      let k: number;
      if (haze) {
        const n = shape(u * 8, v * 8) * 0.6 + fine(u * 16, v * 16) * 0.4;
        a = 0.08 + THREE.MathUtils.smoothstep(n, 0.3, 0.85) * 0.34;
        k = 0.2 + n * 0.4;
      } else {
        // Wavy horizontal lines: 9 per tile, each wobbling, dashed by low-frequency noise.
        const wob = (shape(u * 8, v * 8) - 0.5) * 0.9;
        const line = Math.abs(Math.sin((v * 7 + wob) * Math.PI));
        const thin = Math.max(0, 1 - line / 0.3) ** 1.2;
        const dash = THREE.MathUtils.smoothstep(breakup(u * 4, v * 4 + wob), 0.38, 0.68);
        a = thin * dash * (0.7 + 0.3 * fine(u * 16, v * 16));
        k = a;
      }
      c.copy(color).multiplyScalar(0.8 + 0.2 * k).lerp(white, THREE.MathUtils.smoothstep(k, 0.3, 0.9));
      const i = (y * TEX + x) * 4;
      data[i] = Math.min(255, c.r * 255);
      data[i + 1] = Math.min(255, c.g * 255);
      data[i + 2] = Math.min(255, c.b * 255);
      data[i + 3] = Math.min(255, a * 255);
    }
  }
  return toTexture(data, TEX, true);
}

/** Dust ring swept round the whirl's foot: a bright annulus torn into curling arms. */
function ringTexture(color: THREE.Color): THREE.DataTexture {
  const n = 128;
  const noise = lattice(8, 71);
  const data = new Uint8Array(n * n * 4);
  const dust = color.clone().lerp(new THREE.Color('#e8dcc0'), 0.45);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x / (n - 1) - 0.5;
      const dy = y / (n - 1) - 0.5;
      const d = Math.hypot(dx, dy) * 2;
      const ang = Math.atan2(dy, dx) / (Math.PI * 2) + 0.5;
      // Arms curl outward: the angle shifts with the distance.
      const arm = 0.5 + 0.5 * Math.cos((ang * 5 + d * 1.6) * Math.PI * 2 + noise(ang * 8, d * 4) * 3);
      const band = Math.max(0, 1 - Math.abs(d - 0.62) / 0.36);
      const a = band * band * (0.35 + 0.65 * arm) * (d < 1 ? 1 : 0);
      const i = (y * n + x) * 4;
      data[i] = dust.r * 255;
      data[i + 1] = dust.g * 255;
      data[i + 2] = dust.b * 255;
      data[i + 3] = Math.min(255, a * 200);
    }
  }
  return toTexture(data, n, false);
}

/** Open funnel, narrow at the ground and flaring up, bent into a gentle arc; UVs wrap in a spiral. */
function funnel(radius: number, height: number, layer: Layer): THREE.BufferGeometry {
  const seg = 32;
  const rows = 18;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const r = radius * layer.widen * (0.3 + 1.2 * t ** 1.6);
    const off = Math.sin(t * Math.PI) * radius * layer.bend;
    // Solid in the middle, dissolving into the ground and into the sky.
    const fade = THREE.MathUtils.smoothstep(t, 0, 0.1) * (1 - THREE.MathUtils.smoothstep(t, 0.72, 1)) * layer.alpha;
    const k = layer.light;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * r + off, t * height * layer.tall, Math.sin(a) * r);
      uv.push((i / seg) * layer.wrap + t * layer.twist, t * 1.6);
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
  g.computeVertexNormals();
  return g;
}

/**
 * Fades a sheet where it is seen edge-on, so the funnel's outline dissolves softly instead of
 * stacking into a hard rim. WebGL only (WebGPU node materials skip onBeforeCompile and keep the rim).
 */
function softEdges(material: THREE.MeshBasicMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFacing;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFacing = abs(dot(normalize(normalMatrix * normal), normalize(-mvPosition.xyz)));');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFacing;')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a *= smoothstep(0.08, 0.7, vFacing);');
  };
}

/** Deterministic 0..1 sequence for the debris layout. */
function seq(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Shared geometry, textures and materials of every wind whirl of one size and colour. */
export class WindWhirlKit {
  private readonly shells: { geometry: THREE.BufferGeometry; material: THREE.MeshBasicMaterial; layer: Layer }[] = [];
  private readonly ring: { geometry: THREE.BufferGeometry; material: THREE.MeshBasicMaterial };
  private readonly bits: { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial };
  private readonly sources: THREE.DataTexture[];
  private tickedAt = -1;

  constructor(
    readonly radius: number,
    readonly height: number,
    color: string,
  ) {
    const c = new THREE.Color(color);
    const streaks = windTexture(c, false);
    const haze = windTexture(c, true);
    this.sources = [streaks, haze];
    for (const layer of LAYERS) {
      // Each layer scrolls its own copy (the image is shared).
      const map = (layer.haze ? haze : streaks).clone();
      map.needsUpdate = true;
      const material = new THREE.MeshBasicMaterial({
        map,
        vertexColors: true,
        transparent: true,
        blending: layer.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      softEdges(material);
      this.shells.push({ geometry: funnel(radius, height, layer), material, layer });
    }
    this.ring = {
      geometry: new THREE.CircleGeometry(radius * 1.9, 40).rotateX(-Math.PI / 2),
      material: new THREE.MeshBasicMaterial({ map: ringTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    };
    // Leaves and pebbles caught in the wind: one merged geometry, laid out in a rising spiral.
    const rnd = seq(97);
    const leaf = new THREE.TetrahedronGeometry(1).scale(1, 0.25, 0.6);
    const pebble = new THREE.IcosahedronGeometry(0.8, 0);
    const parts: THREE.BufferGeometry[] = [];
    const paint = (g: THREE.BufferGeometry, hex: string) => {
      const col = new THREE.Color(hex);
      const n = g.getAttribute('position').count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g;
    };
    for (let d = 0; d < 22; d++) {
      const t = rnd() * 0.85 + 0.05;
      const a = d * 2.4 + rnd();
      const r = radius * (0.3 + 1.2 * t ** 1.6) * (1.05 + rnd() * 0.35);
      const s = 0.07 + rnd() * 0.1;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * r, t * height, Math.sin(a) * r),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)),
        new THREE.Vector3(s, s, s),
      );
      const isLeaf = d % 3 !== 0;
      const hex = isLeaf ? ['#7fb04a', '#a8c65a', '#d8b44a'][d % 3 === 1 ? 0 : rnd() < 0.5 ? 1 : 2] : '#8a7560';
      parts.push(paint((isLeaf ? leaf : pebble).clone().toNonIndexed().applyMatrix4(m), hex));
    }
    leaf.dispose();
    pebble.dispose();
    const merged = new THREE.BufferGeometry();
    const total = parts.reduce((n, g) => n + g.getAttribute('position').count, 0);
    const p = new Float32Array(total * 3);
    const cc = new Float32Array(total * 3);
    let o = 0;
    for (const g of parts) {
      p.set(g.getAttribute('position').array as Float32Array, o * 3);
      cc.set(g.getAttribute('color').array as Float32Array, o * 3);
      o += g.getAttribute('position').count;
      g.dispose();
    }
    merged.setAttribute('position', new THREE.BufferAttribute(p, 3));
    merged.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    merged.computeVertexNormals();
    this.bits = { geometry: merged, material: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, side: THREE.DoubleSide }) };
  }

  /** A new whirl's meshes; `spin` holds the shells, `debris` the orbiting leaves the renderer turns. */
  build(): { group: THREE.Group; spin: THREE.Mesh[]; ring: THREE.Mesh; debris: THREE.Mesh } {
    const group = new THREE.Group();
    const spin: THREE.Mesh[] = [];
    this.shells.forEach(({ geometry, material, layer }, i) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      // Outer haze first, then the streak sheets, the glowing core last.
      mesh.renderOrder = 3 + i;
      mesh.rotation.y = i * 2.1;
      if (layer.glow) mesh.layers.enable(GLOW_LAYER);
      group.add(mesh);
      spin.push(mesh);
    });
    const ring = new THREE.Mesh(this.ring.geometry, this.ring.material);
    ring.position.y = 0.05;
    ring.renderOrder = 2;
    group.add(ring);
    const debris = new THREE.Mesh(this.bits.geometry, this.bits.material);
    debris.frustumCulled = false;
    group.add(debris);
    return { group, spin, ring, debris };
  }

  /** Scrolls the gusts (once per frame however many whirls share this kit). */
  tick(time: number): void {
    if (time === this.tickedAt) return;
    this.tickedAt = time;
    for (const { material, layer } of this.shells) material.map!.offset.set(time * layer.swirl, -time * layer.rise);
  }

  /** Turns and sways one whirl: shells spin at their own rates, the column whips, the ring and debris orbit. */
  animate(parts: { spin: readonly THREE.Mesh[]; ring: THREE.Mesh; debris: THREE.Mesh }, time: number, phase: number): void {
    parts.spin.forEach((mesh, i) => {
      const layer = this.shells[i].layer;
      mesh.rotation.y = time * layer.spin + i * 2.1 + phase;
      const sway = this.radius * 0.05 * (i + 1);
      mesh.position.x = Math.sin(time * 2.1 + i * 0.8 + phase) * sway;
      mesh.position.z = Math.cos(time * 1.6 + i * 1.1 + phase) * sway;
    });
    parts.ring.rotation.y = -time * 2.6 + phase;
    parts.ring.scale.setScalar(1 + 0.06 * Math.sin(time * 5 + phase));
    parts.debris.rotation.y = -time * 3.4 + phase;
    parts.debris.position.y = Math.sin(time * 2.7 + phase) * 0.15;
  }

  dispose(): void {
    for (const { geometry, material } of this.shells) {
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
    }
    this.ring.geometry.dispose();
    this.ring.material.map?.dispose();
    this.ring.material.dispose();
    this.bits.geometry.dispose();
    this.bits.material.dispose();
    for (const t of this.sources) t.dispose();
  }
}
