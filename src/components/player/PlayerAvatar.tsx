'use client';

// Profile photo, or a DiceBear "clay" avatar seeded by the uid when there is none (or it fails to load).
import { Avatar, Style } from '@dicebear/core';
import definition from '@dicebear/styles/clay.json' with { type: 'json' };
import { useMemo, useState } from 'react';
import type { AppUser } from '@/shared/users';

let clay: Style | null = null;

function clayAvatar(seed: string): string {
  clay ??= new Style(definition);
  return new Avatar(clay, { seed, size: 96 }).toDataUri();
}

export default function PlayerAvatar({ user, size = 44, className }: { user: Pick<AppUser, 'uid' | 'photoURL'>; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const fallback = useMemo(() => clayAvatar(user.uid), [user.uid]);
  const src = user.photoURL && !broken ? user.photoURL : fallback;
  return <img src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" draggable={false} onError={() => setBroken(true)} className={className} style={{ width: size, height: size }} />;
}
