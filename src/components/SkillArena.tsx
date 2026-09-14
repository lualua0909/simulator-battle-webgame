'use client';

// Live practice-arena preview: the real battle engine runs one caster against training dummies
// and restarts the round in a loop, so skills look exactly as they will in a battle.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { ConfigBundle, UnitDef, WeaponDef } from '@/shared/schema';
import { ARENA_MAP_ID, buildArena, roundLength } from '@/game/arena';
import { BattleEngine } from '@/game/render/engine';

interface Props {
  bundle: ConfigBundle;
  caster: UnitDef;
  /** Ability drafts that override saved documents. */
  abilities?: WeaponDef[];
  className?: string;
}

export default function SkillArena({ bundle, caster, abilities = [], className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const key = JSON.stringify([caster, abilities, bundle.version]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const arena = buildArena(bundle, caster, abilities);
    const weapons = new Map(arena.bundle.weapons.map((w) => [w.id, w]));
    const round = roundLength([caster.weaponId, ...caster.skillIds].map((id) => weapons.get(id)).filter((w): w is WeaponDef => !!w)) * 1000;
    let timer = 0;
    let engine: BattleEngine | null = null;
    const start = () => {
      if (!engine) return;
      window.clearTimeout(timer);
      engine.startBattle(arena.armies, 1 + Math.floor(Math.random() * 100000));
      timer = window.setTimeout(start, round);
    };
    engine = new BattleEngine(el, arena.bundle, {
      onResult: () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(start, 1500);
      },
    });
    engine.loadMap(ARENA_MAP_ID);
    engine.showZones([]);
    // Flyers need a lower, wider shot to stay in frame.
    const lift = caster.flying ? caster.altitude : 0;
    engine.rts.jumpTo({ target: new THREE.Vector3(arena.centerX, 0, 0), yaw: Math.PI / 2 + 0.55, pitch: lift ? 0.22 : 0.38, distance: 9 + arena.span * 0.8 + lift * 1.6 });
    start();
    return () => {
      window.clearTimeout(timer);
      engine?.dispose();
      engine = null;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} className={className ?? 'h-full w-full'} />;
}
