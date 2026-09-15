'use client';
import { useState } from 'react';
import TintEditor from '@/components/models/TintEditor';

export default function DebugTintPage() {
  const [tint, setTint] = useState<Record<string, string | { from: string; to: string }>>({ Wizard_Texture: { from: '#2e44a8', to: '#b3262e' } });
  return (
    <div className="game-ui max-w-xl p-4">
      <TintEditor glbUrl="/models/phap-su.glb" tint={tint} onChange={setTint} />
      <pre data-testid="tint-json" className="mt-2 text-xs">{JSON.stringify(tint)}</pre>
    </div>
  );
}
