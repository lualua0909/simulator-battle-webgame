// Deterministic gates run on every spec before any vision review (img2threejs: scripts
// enforce, vision judges). They measure the baked template — exactly what the game draws,
// animates and ragdolls — so a pass here means the model is safe to put in a battle.
import * as THREE from 'three';
import { checkSculptSpec, type SculptSpec } from '@/shared/sculpt';
import { bakeModel, type ModelTemplate } from '../models/bake';
import { buildSculptModel } from './build';
import { RIG_CONTRACTS, rigOfKind, type ReferenceRig, type SculptKind } from './rigs';

export type GateLevel = 'pass' | 'warn' | 'fail';

export interface GateResult {
  id: string;
  label: string;
  level: GateLevel;
  details: string[];
}

export interface ModelStats {
  triangles: number;
  meshes: number;
  parts: number;
  height: number;
  width: number;
  depth: number;
}

export interface GateReport {
  verdict: GateLevel;
  gates: GateResult[];
  stats: ModelStats | null;
}

const BUDGET = { static: { warn: 1500, fail: 6000 }, animated: { warn: 5000, fail: 12000 } };

export function verdictOf(gates: GateResult[]): GateLevel {
  return gates.some((g) => g.level === 'fail') ? 'fail' : gates.some((g) => g.level === 'warn') ? 'warn' : 'pass';
}

function gate(id: string, label: string, fails: string[], warns: string[] = [], passNote?: string): GateResult {
  const level: GateLevel = fails.length ? 'fail' : warns.length ? 'warn' : 'pass';
  return { id, label, level, details: [...fails, ...warns, ...(level === 'pass' && passNote ? [passNote] : [])] };
}

export function runSculptGates(spec: SculptSpec, kind: SculptKind, reference: ReferenceRig | null): GateReport {
  const issues = checkSculptSpec(spec);
  const structure = gate(
    'structure',
    'Cấu trúc spec',
    issues.filter((i) => i.level === 'fail').map((i) => i.message),
    issues.filter((i) => i.level === 'warn').map((i) => i.message),
    `${spec.nodes.length} node, ${spec.materials.length} vật liệu`,
  );
  if (structure.level === 'fail') return { verdict: 'fail', gates: [structure], stats: null };

  let root: THREE.Group;
  let template: ModelTemplate;
  try {
    root = buildSculptModel(spec);
    template = bakeModel(root);
  } catch (e) {
    return { verdict: 'fail', gates: [{ ...structure, level: 'fail', details: [`không dựng được: ${e instanceof Error ? e.message : String(e)}`] }], stats: null };
  }
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root, true);
  const size = bounds.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite)) {
    return { verdict: 'fail', gates: [{ ...structure, level: 'fail', details: ['hình học có toạ độ không hợp lệ (NaN/Infinity) — kiểm tra các điểm trùng nhau hoặc kích thước 0'] }], stats: null };
  }
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const triangles = template.parts.reduce((n, p) => n + (p.geometry ? p.geometry.getAttribute('position').count / 3 : 0), 0);
  const stats: ModelStats = { triangles, meshes: meshes.length, parts: template.parts.length - 1, height: size.y, width: size.x, depth: size.z };

  const gates = [
    structure,
    rigGate(spec, kind, template, reference),
    socketGate(spec, template),
    groundGate(bounds),
    sizeGate(size.y, reference),
    attachmentGate(meshes, size.y),
    budgetGate(spec, stats),
    pivotGate(template, size.y, reference),
  ].filter((g): g is GateResult => g !== null);
  return { verdict: verdictOf(gates), gates, stats };
}

function rigGate(spec: SculptSpec, kind: SculptKind, t: ModelTemplate, reference: ReferenceRig | null): GateResult {
  const fails: string[] = [];
  const warns: string[] = [];
  const expected = rigOfKind(kind);
  if (spec.rig !== expected) fails.push(`rig "${spec.rig}" không khớp loại ${kind} (cần "${expected}")`);
  const contract = RIG_CONTRACTS[expected];
  const byName = new Map(t.parts.filter((p) => p.segment === 0).map((p) => [p.local, p]));
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  for (const [name, rule] of Object.entries(contract.parts)) {
    const p = byName.get(name);
    if (!p) {
      if (rule.required) fails.push(`thiếu part bắt buộc "${name}" (${rule.note})`);
      continue;
    }
    const parent = p.parent >= 0 ? t.parts[p.parent].local : 'root';
    let allowed = rule.parents;
    if (name === 'weapon') allowed = [spec.weaponStyle === 'bow' ? 'forearmL' : 'forearmR'];
    if (!allowed.includes(parent)) fails.push(`part "${name}" phải nằm dưới ${allowed.join(' hoặc ')}, đang nằm dưới "${parent}"`);
    if (!rule.heldItem) {
      p.rest.decompose(pos, quat, scl);
      if (2 * Math.acos(Math.min(1, Math.abs(quat.w))) > 0.01) fails.push(`part "${name}" phải có rotation [0,0,0] (kể cả các node cha); xoay mesh bên trong thay vì xoay khớp`);
    }
  }
  const extra = [...byName.keys()].filter((n) => n !== 'root' && !(n in contract.parts));
  if (expected === 'static' && extra.length) warns.push(`model tĩnh không cần part (${extra.join(', ')}); game gộp thành một mesh`);
  else if (extra.length) warns.push(`part ngoài rig sẽ đứng yên theo cha: ${extra.join(', ')}`);

  if (expected === 'humanoid') {
    const hasWeapon = byName.has('weapon');
    if (spec.weaponStyle !== 'none' && !hasWeapon) warns.push(`weaponStyle "${spec.weaponStyle}" nhưng không có part "weapon"`);
    if (spec.weaponStyle === 'none' && hasWeapon) warns.push('có part "weapon" nhưng weaponStyle = "none"');
    if (reference && reference.assetId && reference.weaponStyle !== spec.weaponStyle) {
      warns.push(`asset gốc dùng kiểu vũ khí "${reference.weaponStyle}", model mới "${spec.weaponStyle}" — animation đòn đánh sẽ khác`);
    }
  }
  return gate('rig', 'Rig & animation', fails, warns, `${byName.size - 1} part khớp rig ${expected}`);
}

function socketGate(spec: SculptSpec, t: ModelTemplate): GateResult | null {
  const contract = RIG_CONTRACTS[spec.rig];
  const names = Object.keys(contract.sockets);
  if (!names.length) return null;
  const missing = names.filter((n) => !t.sockets[n]);
  const reason: Record<string, string> = { saddle: 'không đặt được người cưỡi', mouth: 'lửa sẽ phun từ giữa thân' };
  return gate(
    'sockets',
    'Socket',
    [],
    missing.map((n) => `thiếu socket "${n}" — ${reason[n] ?? contract.sockets[n].note}`),
    `có ${names.join(', ')}`,
  );
}

function groundGate(bounds: THREE.Box3): GateResult {
  const h = bounds.max.y - bounds.min.y;
  if (!(h > 0.05)) return gate('ground', 'Chạm đất', ['model gần như rỗng hoặc dẹt (cao < 5 cm)']);
  const off = bounds.min.y;
  const fails = Math.abs(off) > Math.max(0.03, 0.08 * h) ? [`đáy model ở y = ${off.toFixed(3)} m; chân phải chạm y = 0`] : [];
  const warns = !fails.length && Math.abs(off) > Math.max(0.01, 0.02 * h) ? [`đáy model lệch mặt đất ${off.toFixed(3)} m`] : [];
  return gate('ground', 'Chạm đất', fails, warns, `đáy y = ${off.toFixed(3)} m`);
}

function sizeGate(height: number, reference: ReferenceRig | null): GateResult | null {
  if (!reference || !(reference.height > 0)) return null;
  const ratio = height / reference.height;
  const warns = ratio < 0.6 || ratio > 1.6 ? [`cao ${height.toFixed(2)} m, model gốc ${reference.height.toFixed(2)} m (×${ratio.toFixed(2)}) — nên dựng đúng cỡ gốc, chỉnh tỉ lệ bằng scale của asset`] : [];
  return gate('size', 'Kích thước', [], warns, `cao ${height.toFixed(2)} m (gốc ${reference.height.toFixed(2)} m)`);
}

/** Meshes whose padded boxes touch nothing else read as floating debris. */
function attachmentGate(meshes: THREE.Mesh[], height: number): GateResult | null {
  if (meshes.length < 2) return null;
  const pad = Math.max(0.01, height * 0.01);
  const boxes = meshes.map((m) => new THREE.Box3().setFromObject(m, true).expandByScalar(pad));
  const group = meshes.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[i].intersectsBox(boxes[j])) group[find(i)] = find(j);
    }
  }
  const clusters = new Map<number, string[]>();
  meshes.forEach((m, i) => {
    const k = find(i);
    clusters.set(k, [...(clusters.get(k) ?? []), m.name]);
  });
  if (clusters.size === 1) return gate('attachment', 'Liền khối', [], [], 'mọi mesh đều chạm nhau');
  const sorted = [...clusters.values()].sort((a, b) => b.length - a.length);
  const loose = sorted.slice(1).flat();
  return gate('attachment', 'Liền khối', [], [`${loose.length} mesh lơ lửng không chạm phần chính: ${loose.slice(0, 10).join(', ')}${loose.length > 10 ? '…' : ''}`]);
}

function budgetGate(spec: SculptSpec, stats: ModelStats): GateResult {
  const b = spec.rig === 'static' ? BUDGET.static : BUDGET.animated;
  const fails = stats.triangles > b.fail ? [`${stats.triangles} tam giác vượt trần ${b.fail}`] : [];
  const warns: string[] = [];
  if (!fails.length && stats.triangles > b.warn) warns.push(`${stats.triangles} tam giác (khuyên dưới ${b.warn}; game vẽ hàng trăm lính cùng lúc)`);
  if (stats.parts > 30) warns.push(`${stats.parts} part — mỗi part là một lượt vẽ riêng`);
  return gate('budget', 'Ngân sách tam giác', fails, warns, `${stats.triangles} tam giác, ${stats.meshes} mesh`);
}

/** Joint layout compared with the procedural model it replaces, normalised by height. */
function pivotGate(t: ModelTemplate, height: number, reference: ReferenceRig | null): GateResult | null {
  if (!reference || !reference.parts.length || !(height > 0)) return null;
  const pos = new THREE.Vector3();
  const off: string[] = [];
  for (const ref of reference.parts) {
    const p = t.parts.find((x) => x.segment === 0 && x.local === ref.name);
    if (!p) continue;
    pos.setFromMatrixPosition(p.rest).divideScalar(height);
    const d = Math.hypot(pos.x - ref.pivot[0] / reference.height, pos.y - ref.pivot[1] / reference.height, pos.z - ref.pivot[2] / reference.height);
    if (d > 0.12) off.push(`${ref.name} (lệch ${(d * 100).toFixed(0)}% chiều cao)`);
  }
  return gate('pivots', 'Khớp so với rig gốc', [], off.length ? [`khớp đặt khác xa model gốc, animation có thể trông lạ: ${off.join(', ')}`] : [], 'vị trí khớp gần model gốc');
}
