'use client';

import { useMemo } from 'react';
import { SKINNED_GLB_KINDS, type AssetDef, type ConfigBundle, type UnitDef } from '@/shared/schema';
import { bakeModel } from '@/game/models/bake';
import { createUnitModel } from '@/game/models';
import { unitEquipment } from '@/game/models/equipment';
import ModelViewer from '@/components/ModelViewer';
import SkinnedModelViewer from '@/components/SkinnedModelViewer';

// Fixed three-quarter view (no turntable), framed tight so every unit fills the card.
const CARD_YAW = 30;
const CARD_FIT = 0.95;

/** Live 3D artwork used by the detail card. The list keeps its cached PNGs for performance. */
export default function UnitCardModel({ unit, bundle }: { unit: UnitDef; bundle: ConfigBundle }) {
  const assets = useMemo(() => new Map(bundle.assets.map((asset) => [asset.id, asset])), [bundle.assets]);
  const asset = assets.get(unit.modelId);
  const gear = useMemo(() => unitEquipment(unit, assets), [unit, assets]);
  const skinned = asset?.glb && (SKINNED_GLB_KINDS as readonly string[]).includes(asset.kind) ? asset : undefined;
  const template = useMemo(() => {
    if (skinned) return null;
    try {
      return bakeModel(createUnitModel(unit, assets));
    } catch {
      return null;
    }
  }, [assets, skinned, unit]);

  if (skinned?.glb) {
    return <SkinnedModelViewer url={skinned.glb.url} scale={skinned.scale} tint={skinned.glb.tint} hide={skinned.glb.hide} equipment={gear.model} anim="idle" yaw={CARD_YAW} fit={CARD_FIT} transparent showGround={false} className="unit-card-live-model" />;
  }
  return <ModelViewer template={template} weapon={bundle.weapons.find((weapon) => weapon.id === unit.weaponId)} anim="idle" yaw={CARD_YAW} fit={CARD_FIT} transparent showGround={false} className="unit-card-live-model" />;
}
