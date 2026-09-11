'use client';

// Live previews for the CMS editor. They consume the unsaved draft, so every tweak is
// visible before saving.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  ARMOR_CLASSES,
  botSchema,
  mapSchema,
  particleSchema,
  type AssetDef,
  type ConfigBundle,
  type ProjectileDef,
  type UnitDef,
  type WeaponDef,
} from '@/shared/schema';
import { ENUM_LABELS, isEnvKind } from '@/shared/fields';
import { generateBotArmy, unitPower } from '@/game/bot/generate';
import { createAssetModel, createUnitModel } from '@/game/models';
import { bakeModel, type ModelTemplate } from '@/game/models/bake';
import { createProjectileModel } from '@/game/models/projectiles';
import { ParticleSystem } from '@/game/render/particles';
import { createScenery } from '@/game/render/scenery';
import { createSkirt, createTerrainMesh, createWater, createZoneOverlay } from '@/game/render/terrainMesh';
import { armyCost } from '@/game/sim/army';
import { Terrain } from '@/game/sim/terrain';
import ModelViewer, { type PreviewAnim } from '../ModelViewer';

type Doc = Record<string, unknown>;

/** Deferred, structurally-stable copy of a draft document. */
function useDraft<T>(doc: Doc): [T, string] {
  const deferred = useDeferredValue(doc);
  const key = JSON.stringify(deferred);
  return [useMemo(() => JSON.parse(key) as T, [key]), key];
}

function tryBake(build: () => THREE.Object3D): ModelTemplate | null {
  try {
    return bakeModel(build());
  } catch (e) {
    console.warn('preview failed', e);
    return null;
  }
}

function AnimButtons({ anim, setAnim }: { anim: PreviewAnim; setAnim(a: PreviewAnim): void }) {
  return (
    <div className="flex gap-1">
      {(['idle', 'walk', 'attack'] as const).map((a) => (
        <button key={a} type="button" className={`btn px-2 py-0.5 text-xs ${anim === a ? 'btn-gold' : ''}`} onClick={() => setAnim(a)}>
          {a === 'idle' ? 'Đứng' : a === 'walk' ? 'Đi' : 'Đánh'}
        </button>
      ))}
    </div>
  );
}

function Frame({ title, children, tools }: { title: string; children: React.ReactNode; tools?: React.ReactNode }) {
  return (
    <div className="panel flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-sm">{title}</h3>
        {tools}
      </div>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ units

export function UnitPreview({ doc, bundle }: { doc: Doc; bundle: ConfigBundle }) {
  const [unit] = useDraft<UnitDef>(doc);
  const [anim, setAnim] = useState<PreviewAnim>('idle');
  const assets = useMemo(() => new Map(bundle.assets.map((a) => [a.id, a])), [bundle]);
  const template = useMemo(() => tryBake(() => createUnitModel(unit, assets)), [unit.modelId, unit.riderModelId, assets]); // eslint-disable-line react-hooks/exhaustive-deps
  const weapon = bundle.weapons.find((w) => w.id === unit.weaponId);
  const safe = { ...unit, hp: Number(unit.hp) || 1, cost: Number(unit.cost) || 1 };
  const { dps, ehp } = unitPower(safe, bundle);
  const eff = (u: UnitDef) => {
    const p = unitPower(u, bundle);
    return Math.sqrt(Math.max(0.001, p.dps) * p.ehp) / u.cost;
  };
  const mine = eff(safe);
  const all = bundle.units.filter((u) => u.id !== unit.id).map(eff);
  const rank = all.filter((e) => e > mine).length + 1;
  return (
    <Frame title="Xem trước" tools={<AnimButtons anim={anim} setAnim={setAnim} />}>
      <div className="h-80 overflow-hidden rounded-lg border-2 border-ink/20">
        <ModelViewer template={template} weapon={weapon} anim={anim} />
      </div>
      <dl className="grid grid-cols-2 gap-x-3 text-sm">
        <dt>Sát thương / giây</dt>
        <dd className="text-right font-bold">{dps.toFixed(1)}</dd>
        <dt>Máu hiệu dụng</dt>
        <dd className="text-right font-bold">{ehp.toFixed(0)}</dd>
        <dt>Hiệu quả / giá</dt>
        <dd className="text-right font-bold">
          {(mine * 100).toFixed(2)} <span className="text-xs font-normal opacity-60">(hạng {rank}/{all.length + 1})</span>
        </dd>
      </dl>
      {weapon && <WeaponTable weapon={weapon} bundle={bundle} />}
    </Frame>
  );
}

// ------------------------------------------------------------------ assets

export function AssetPreview({ doc }: { doc: Doc }) {
  const [asset, key] = useDraft<AssetDef>(doc);
  const [anim, setAnim] = useState<PreviewAnim>('idle');
  const [explode, setExplode] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const template = useMemo(() => tryBake(() => createAssetModel({ ...asset, scale: Number(asset.scale) || 1, seed: Number(asset.seed) || 0 })), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const env = isEnvKind(String(asset.kind));
  return (
    <Frame
      title="Xem trước"
      tools={
        <div className="flex items-center gap-2 text-xs">
          {!env && <AnimButtons anim={anim} setAnim={setAnim} />}
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={explode} onChange={(e) => setExplode(e.target.checked)} /> Tách rời
          </label>
        </div>
      }
    >
      <div className="h-96 overflow-hidden rounded-lg border-2 border-ink/20">
        <ModelViewer template={template} anim={env ? 'idle' : anim} explode={explode} onPick={setPicked} />
      </div>
      <p className="text-xs opacity-70">
        {template ? `${template.parts.length} bộ phận chuyển động · ${template.parts.reduce((n, p) => n + (p.geometry ? p.geometry.getAttribute('position').count / 3 : 0), 0)} tam giác` : 'Không dựng được mô hình'}
        {picked && (
          <>
            {' '}
            · đang chọn <b className="font-mono">{picked}</b>
          </>
        )}
      </p>
      <p className="text-xs opacity-60">Mô hình procedural dựng hoàn toàn bằng code (chuẩn img2threejs, không cần ảnh tham chiếu). Bấm vào mô hình để xem tên bộ phận.</p>
    </Frame>
  );
}

export function ProjectilePreview({ doc }: { doc: Doc }) {
  const [p, key] = useDraft<ProjectileDef>(doc);
  const template = useMemo(() => tryBake(() => createProjectileModel({ model: p.model, color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#ffffff', scale: Number(p.scale) || 1 })), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Frame title="Xem trước">
      <div className="h-64 overflow-hidden rounded-lg border-2 border-ink/20">
        <ModelViewer template={template} />
      </div>
    </Frame>
  );
}

// ------------------------------------------------------------------ weapons

function WeaponTable({ weapon, bundle }: { weapon: WeaponDef; bundle: ConfigBundle }) {
  const m = bundle.settings.damageMatrix[weapon.damageType];
  const perHit = Number(weapon.damage) || 0;
  const rate = (Number(weapon.volley) || 1) / (Number(weapon.cooldown) || 1);
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left opacity-60">
          <th>Mục tiêu</th>
          <th className="text-right">× giáp</th>
          <th className="text-right">/ đòn</th>
          <th className="text-right">/ giây</th>
        </tr>
      </thead>
      <tbody>
        {ARMOR_CLASSES.map((a) => (
          <tr key={a} className="border-t border-ink/10">
            <td>{ENUM_LABELS[a]}</td>
            <td className="text-right">{m?.[a] ?? '-'}</td>
            <td className="text-right font-bold">{(perHit * (m?.[a] ?? 1)).toFixed(0)}</td>
            <td className="text-right font-bold">{(perHit * (m?.[a] ?? 1) * rate).toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function WeaponPreview({ doc, bundle }: { doc: Doc; bundle: ConfigBundle }) {
  const [w] = useDraft<WeaponDef>(doc);
  const users = bundle.units.filter((u) => u.weaponId === w.id);
  const flight = w.attack === 'projectile' && w.projectileSpeed ? (Number(w.range) / Number(w.projectileSpeed)).toFixed(2) : null;
  return (
    <Frame title="Bảng sát thương">
      <WeaponTable weapon={w} bundle={bundle} />
      {flight && <p className="text-xs">Thời gian bay ở tầm tối đa: {flight}s</p>}
      <p className="text-xs opacity-70">Dùng bởi: {users.length ? users.map((u) => u.name).join(', ') : 'chưa có lính nào'}</p>
    </Frame>
  );
}

// ------------------------------------------------------------------ particles

export function ParticlePreview({ doc }: { doc: Doc }) {
  const [draft, key] = useDraft<Doc>(doc);
  const host = useRef<HTMLDivElement>(null);
  const [trail, setTrail] = useState(false);
  const trailRef = useRef(trail);
  trailRef.current = trail;
  useEffect(() => {
    const el = host.current;
    const parsed = particleSchema.safeParse(draft);
    if (!el || !parsed.success) return;
    const def = parsed.data;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#2b2f36');
    scene.add(new THREE.HemisphereLight('#ffffff', '#445', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.5);
    sun.position.set(3, 6, 2);
    scene.add(sun);
    const grid = new THREE.GridHelper(10, 10, '#666', '#444');
    scene.add(grid);
    const ps = new ParticleSystem(3000);
    scene.add(ps.group);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const timer = new THREE.Timer();
    let next = 0;
    let acc = 0;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      timer.update();
      const dt = Math.min(0.05, timer.getDelta());
      const t = timer.getElapsed();
      if (trailRef.current) {
        const x = Math.cos(t * 1.5) * 2.5;
        const z = Math.sin(t * 1.5) * 2.5;
        acc += def.rate * dt;
        const n = Math.floor(acc);
        acc -= n;
        if (n > 0) ps.emit(def, x, 1.5, z, { x: -Math.sin(t * 1.5), y: 0, z: Math.cos(t * 1.5) }, n);
      } else if (t >= next) {
        ps.emit(def, 0, 1, 0, { x: 1, y: 0.35, z: 0 });
        next = t + Math.max(0.8, def.lifetime[1] + 0.3);
      }
      ps.update(dt);
      camera.position.set(Math.sin(t * 0.2) * 7, 4, Math.cos(t * 0.2) * 7);
      camera.lookAt(0, 1, 0);
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ps.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Frame
      title="Xem trước (lặp lại)"
      tools={
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={trail} onChange={(e) => setTrail(e.target.checked)} /> Chế độ vệt bay
        </label>
      }
    >
      <div ref={host} className="h-80 overflow-hidden rounded-lg border-2 border-ink/20" />
    </Frame>
  );
}

// ------------------------------------------------------------------ maps

export function MapPreview({ doc, bundle }: { doc: Doc; bundle: ConfigBundle }) {
  const [draft, key] = useDraft<Doc>(doc);
  const host = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState('');
  useEffect(() => {
    const el = host.current;
    const parsed = mapSchema.safeParse(draft);
    if (!el) return;
    if (!parsed.success) {
      setInfo('Dữ liệu chưa hợp lệ');
      return;
    }
    const map = parsed.data;
    const terrain = new Terrain(map, bundle.assets);
    setInfo(`${terrain.obstacles.length} cây/đá/bụi · vùng triển khai ${(terrain.zones.blue.x1 - terrain.zones.blue.x0).toFixed(0)}m`);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(map.skyBottom);
    scene.fog = new THREE.Fog(map.skyBottom, map.size * 1.2, map.size * 4);
    scene.add(new THREE.HemisphereLight(map.skyTop, '#5a4a30', 1.3));
    const sun = new THREE.DirectionalLight('#fff1d8', 2.4);
    sun.position.set(-map.size * 0.4, map.size * 0.8, map.size * 0.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -map.size / 2 - 5;
    sc.right = sc.top = map.size / 2 + 5;
    sc.far = map.size * 3;
    scene.add(sun);
    const water = createWater(terrain);
    scene.add(createTerrainMesh(terrain), createSkirt(terrain), createScenery(terrain, new Map(bundle.assets.map((a) => [a.id, a]))), createZoneOverlay(terrain, 'blue', '#2f6fe0'), createZoneOverlay(terrain, 'red', '#d8373a'));
    if (water) scene.add(water.mesh);
    const camera = new THREE.PerspectiveCamera(45, 1, 1, map.size * 8);
    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const timer = new THREE.Timer();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      timer.update();
      const t = timer.getElapsed();
      water?.update(t);
      const d = map.size * 0.95;
      camera.position.set(Math.sin(t * 0.08) * d, map.size * 0.6, Math.cos(t * 0.08) * d);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [key, bundle]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Frame title="Xem trước địa hình">
      <div ref={host} className="h-80 overflow-hidden rounded-lg border-2 border-ink/20" />
      <p className="text-xs opacity-70">{info}</p>
    </Frame>
  );
}

// ------------------------------------------------------------------ bots

const ROLE_COLOR: Record<string, string> = { melee: '#d8373a', ranged: '#2f6fe0', support: '#2fa84f', siege: '#8e44ad' };

export function BotTester({ doc, bundle }: { doc: Doc; bundle: ConfigBundle }) {
  const [draft] = useDraft<Doc>(doc);
  const [mapId, setMapId] = useState(bundle.maps[0]?.id ?? '');
  const map = bundle.maps.find((m) => m.id === mapId) ?? bundle.maps[0];
  const [budget, setBudget] = useState(map?.budget ?? 3000);
  const [seed, setSeed] = useState(1);
  const terrain = useMemo(() => (map ? new Terrain(map, bundle.assets) : null), [map, bundle]);
  const parsed = botSchema.safeParse(draft);
  const army = useMemo(() => {
    if (!parsed.success || !terrain) return [];
    return generateBotArmy({ bot: parsed.data, content: bundle, terrain, side: 'red', budget: Math.round(budget * parsed.data.budgetMultiplier), seed });
  }, [parsed.success, parsed.data, terrain, bundle, budget, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = new Map<string, number>();
  for (const p of army) counts.set(p.unitId, (counts.get(p.unitId) ?? 0) + 1);
  const units = new Map(bundle.units.map((u) => [u.id, u]));
  const zone = terrain?.zones.red;
  return (
    <Frame
      title="Thử bot xếp quân"
      tools={
        <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => setSeed((s) => s + 1)}>
          🎲 Lần khác
        </button>
      }
    >
      {!parsed.success && <p className="text-sm text-red-team">Dữ liệu bot chưa hợp lệ</p>}
      <div className="flex gap-2 text-sm">
        <select className="field" value={mapId} onChange={(e) => setMapId(e.target.value)}>
          {bundle.maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <input className="field w-28" type="number" step={100} value={budget} onChange={(e) => setBudget(Number(e.target.value) || 0)} />
      </div>
      {zone && terrain && (
        <svg viewBox={`${zone.x0 - 2} ${zone.z0 - 2} ${zone.x1 - zone.x0 + 4} ${zone.z1 - zone.z0 + 4}`} className="h-56 w-full rounded-lg border-2 border-ink/20 bg-[#9cc47a]">
          <rect x={zone.x0} y={zone.z0} width={zone.x1 - zone.x0} height={zone.z1 - zone.z0} fill="#d8373a22" stroke="#d8373a" strokeWidth={0.4} />
          {terrain.obstacles
            .filter((o) => o.radius > 0 && terrain.inZone('red', o.x, o.z))
            .map((o, i) => (
              <circle key={`o${i}`} cx={o.x} cy={o.z} r={o.radius} fill="#5a6a4a" />
            ))}
          {army.map((p, i) => {
            const u = units.get(p.unitId);
            return <circle key={i} cx={p.x} cy={p.z} r={Math.max(0.5, u?.radius ?? 0.5)} fill={ROLE_COLOR[u?.role ?? 'melee']} stroke="#1f1a14" strokeWidth={0.15} />;
          })}
        </svg>
      )}
      <div className="flex flex-wrap gap-2 text-[11px]">
        {Object.entries(ROLE_COLOR).map(([r, c]) => (
          <span key={r} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
            {ENUM_LABELS[r]}
          </span>
        ))}
      </div>
      <ul className="max-h-40 overflow-y-auto text-sm">
        {[...counts.entries()]
          .sort((a, b) => (units.get(b[0])?.cost ?? 0) * b[1] - (units.get(a[0])?.cost ?? 0) * a[1])
          .map(([id, n]) => (
            <li key={id} className="flex justify-between border-b border-ink/10">
              <span>
                {units.get(id)?.name ?? id} × {n}
              </span>
              <span className="opacity-70">{(units.get(id)?.cost ?? 0) * n}</span>
            </li>
          ))}
      </ul>
      <p className="text-sm font-bold">
        {army.length} lính · {armyCost(bundle, army)} / {parsed.success ? Math.round(budget * parsed.data.budgetMultiplier) : budget} vàng
      </p>
    </Frame>
  );
}

export function FactionPreview({ doc, bundle }: { doc: Doc; bundle: ConfigBundle }) {
  const members = bundle.units.filter((u) => u.factionId === doc.id);
  return (
    <Frame title="Lính thuộc phe">
      <div className="h-3 rounded-full" style={{ background: String(doc.color) }} />
      <ul className="text-sm">
        {members.map((u) => (
          <li key={u.id} className="flex justify-between border-b border-ink/10">
            <span>{u.name}</span>
            <span className="opacity-60">{u.cost}</span>
          </li>
        ))}
        {members.length === 0 && <li className="opacity-60">Chưa có lính nào</li>}
      </ul>
    </Frame>
  );
}
