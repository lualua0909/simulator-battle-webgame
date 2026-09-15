'use client';

// Tint editor for an uploaded skeletal .glb: recolour per material, previewed live wherever
// the draft asset renders (the CMS preview, the workshop viewer, thumbnails and battles all
// read the same `glb.tint` record). Solid packs take a flat hex; textured packs repaint the
// `from` hue family toward `to`, keeping shading and leaving skin/trim/hair alone.
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AssetGlb } from '@/shared/schema';

type Tint = NonNullable<AssetGlb['tint']>;
type Rule = Tint[string];

interface MaterialInfo {
  name: string;
  hasMap: boolean;
  base: string;
}

const loaders = new Map<string, Promise<{ materials: MaterialInfo[]; suggested: string | null }>>();

function loadFile(url: string): Promise<{ materials: MaterialInfo[]; suggested: string | null }> {
  let p = loaders.get(url);
  if (!p) {
    p = new GLTFLoader()
      .loadAsync(url)
      .then((gltf) => {
        const materials: MaterialInfo[] = [];
        const seen = new Set<string>();
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
            const std = mat as THREE.MeshStandardMaterial;
            if (!std?.name || seen.has(std.name)) continue;
            seen.add(std.name);
            materials.push({ name: std.name, hasMap: !!std.map, base: `#${std.color?.getHexString() ?? 'ffffff'}` });
          }
        });
        return { materials, suggested: suggestFromScene(gltf.scene) };
      });
    loaders.set(url, p);
  }
  return p;
}

const tmpColor = new THREE.Color();
const tmpHSL = { h: 0, s: 0, l: 0 };

/** Dominant saturated hue of texture pixels as hex (suggested repaint `from`), or null. */
function suggestFrom(data: Uint8ClampedArray): string | null {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 64) {
    tmpColor.setRGB(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255).getHSL(tmpHSL);
    if (tmpHSL.s <= 0.35) continue;
    const bin = Math.floor(tmpHSL.h * 12) % 12;
    const b = bins.get(bin) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n++;
    b.r += data[i];
    b.g += data[i + 1];
    b.b += data[i + 2];
    bins.set(bin, b);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const b of bins.values()) if (!best || b.n > best.n) best = b;
  if (!best) return null;
  const toHex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${toHex(best.r / best.n)}${toHex(best.g / best.n)}${toHex(best.b / best.n)}`;
}

/** Suggested repaint source: dominant saturated hue of the first texture, if any. */
function suggestFromScene(root: THREE.Object3D): string | null {
  for (const tex of collectMaps(root)) {
    try {
      const img = tex.image as HTMLImageElement | ImageBitmap | undefined;
      if (!img?.width || !img?.height) continue;
      const canvas = document.createElement('canvas');
      const w = Math.min(128, img.width);
      const h = Math.min(128, img.height);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0, w, h);
      return suggestFrom(ctx.getImageData(0, 0, w, h).data);
    } catch {
      // Gợi ý màu chỉ là tiện ích; editor vẫn dùng được khi không đọc được texture.
    }
  }
  return null;
}

function collectMaps(root: THREE.Object3D): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  const seen = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const map = (mat as THREE.MeshStandardMaterial)?.map;
      if (map && !seen.has(map)) {
        seen.add(map);
        out.push(map);
      }
    }
  });
  return out;
}

interface Props {
  glbUrl: string;
  tint: Tint;
  onChange(tint: Tint): void;
}

export default function TintEditor({ glbUrl, tint, onChange }: Props) {
  const [materials, setMaterials] = useState<MaterialInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [suggested, setSuggested] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setMaterials(null);
    setFailed(false);
    void loadFile(glbUrl).then(
      ({ materials, suggested }) => {
        if (!alive) return;
        setMaterials(materials);
        setSuggested(suggested);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [glbUrl]);

  const setRule = (name: string, rule: Rule | null) => {
    const next = { ...tint };
    if (rule) next[name] = rule;
    else delete next[name];
    onChange(next);
  };

  const stale = Object.keys(tint).filter((k) => materials && !materials.some((m) => m.name === k));

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border-2 border-ink/20 bg-white/60 p-2 text-xs">
      <b>🎨 Màu model (xem thử trực tiếp ở khung bên cạnh)</b>
      {!materials && !failed && <p className="opacity-60">Đang đọc vật liệu trong file…</p>}
      {failed && <p className="font-bold text-red-team">Không đọc được file — kiểm tra lại URL upload.</p>}
      {materials?.map((m) => {
        const rule = tint[m.name];
        const mode = !rule ? 'off' : typeof rule === 'string' ? 'solid' : 'repaint';
        return (
          <div key={m.name} className="flex flex-wrap items-center gap-1.5 rounded border border-ink/15 bg-white/70 px-1.5 py-1">
            <span className="inline-block h-4 w-4 rounded border border-ink/30" style={{ background: m.base }} title={`màu gốc ${m.base}`} />
            <span className="min-w-0 flex-1 truncate font-mono">
              {m.name}
              {m.hasMap && <span className="ml-1 rounded bg-ink/10 px-1">texture</span>}
            </span>
            <select
              className="field py-0 text-xs"
              value={mode}
              onChange={(e) => {
                const next = e.target.value as 'off' | 'solid' | 'repaint';
                if (next === 'off') setRule(m.name, null);
                else if (next === 'solid') setRule(m.name, typeof rule === 'string' ? rule : m.base);
                else setRule(m.name, typeof rule === 'object' ? rule : { from: suggested ?? '#2e44a8', to: m.base });
              }}
            >
              <option value="off">— gốc —</option>
              <option value="solid">Màu phẳng</option>
              {m.hasMap && <option value="repaint">Vẽ lại vùng màu</option>}
            </select>
            {mode === 'solid' && typeof rule === 'string' && <input type="color" value={rule} onChange={(e) => setRule(m.name, e.target.value)} title="Màu thay thế" />}
            {mode === 'repaint' && typeof rule === 'object' && (
              <span className="flex items-center gap-1" title="Đổi mọi pixel cùng họ màu với «từ» sang màu «sang»; da, râu, viền không bị ảnh hưởng">
                <input type="color" value={rule.from} onChange={(e) => setRule(m.name, { ...rule, from: e.target.value })} title="Từ màu này" />
                <span>→</span>
                <input type="color" value={rule.to} onChange={(e) => setRule(m.name, { ...rule, to: e.target.value })} title="Sang màu này" />
              </span>
            )}
          </div>
        );
      })}
      {stale.length > 0 && (
        <p className="opacity-70">
          Màu cho vật liệu không còn trong file ({stale.join(', ')}) sẽ bị bỏ qua.{' '}
          <button className="underline" onClick={() => onChange(Object.fromEntries(Object.entries(tint).filter(([k]) => !stale.includes(k))))}>
            Dọn
          </button>
        </p>
      )}
      <p className="opacity-60">Màu phẳng nhân thẳng vào vật liệu (file màu phẳng như rồng). Vẽ lại vùng màu chỉ đổi họ màu đã chọn trong texture (áo choàng pháp sư), giữ nguyên da, râu, viền và nếp gấp.</p>
    </div>
  );
}
