// Daily-bonus Rive wiring: asset paths, day → tier mapping and ViewModel
// (data binding) helpers. Verified at runtime against the shipped .riv files
// with the @rive-app/webgl2 runtime (WebGL2):
//
// - Calendar (twz_daily_bonus_new_v49.riv, Main / Main SM): root VM `Main`.
//   Week slots live at allPrizeList/prizeList1/prize1to6List[0..5] (SmallPrize
//   VM) + prize7List[0] (LargePrize VM). Progress at meter/*, countdown at
//   timer/time (string). Slot taps arrive as smallPrizeClick/largePrizeClick
//   trigger callbacks; closeModalPrizeClaim fires alongside a slot tap.
// - Reveal (box_prize_reveal_modal_v25.riv): root VM BoxPrizeRevealModal with
//   tierNum, numOfPrize and boxPrize1..6 (BoxPrize VMs: currencyPrize,
//   prizeImage, titleText, prizeContent{amount, contentText}). Chest tap
//   arrives as the root boxClick trigger callback.
// - WZ_DB_* Rive events are audio cues (mp3s in public/audio/daily-bonus).
//
// The file's top-right X / bottom CTA / info buttons emit nothing observable,
// so the host closes via Escape (+ a top-right corner tap fallback, see
// RiveDailyBonus) and claims via slot taps.

import { decodeImage, type Rive, type ViewModelInstance } from '@rive-app/react-webgl2';

export const RIVE_DAILY_SRC = '/rive/twz_daily_bonus_new_v49.riv';
export const RIVE_BOX_REVEAL_SRC = '/rive/box_prize_reveal_modal_v25.riv';

export const DAILY_ARTBOARD = 'Main';
export const DAILY_STATE_MACHINE = 'Main SM';
export const BOX_REVEAL_ARTBOARD = 'Box Prize Reveal Modal';
export const BOX_REVEAL_STATE_MACHINE = 'Box Prize Reveal Modal SM';

/** Bound root view-model instance; null until the file loads (autoBind). */
export type RiveVMI = ViewModelInstance;
export type RiveImage = Awaited<ReturnType<typeof decodeImage>>;

export interface DailyBonusDay {
  /** 0-based index in the Mon…Sun week (displayed as Day 1…7). */
  index: number;
  /** Chest tier (6 = base … 10 = rarest); Day 1–3 share LB 0. */
  tier: number;
  /** Chest artwork, ascending rarity, painted into the slot's image node. */
  image: string;
}

export const DAILY_BONUS_DAYS: DailyBonusDay[] = [
  { index: 0, tier: 6, image: '/rive/daily-gifts/day1.webp' },
  { index: 1, tier: 6, image: '/rive/daily-gifts/day2.webp' },
  { index: 2, tier: 6, image: '/rive/daily-gifts/day3.webp' },
  { index: 3, tier: 7, image: '/rive/daily-gifts/day4.webp' },
  { index: 4, tier: 8, image: '/rive/daily-gifts/day5.webp' },
  { index: 5, tier: 9, image: '/rive/daily-gifts/day6.webp' },
  { index: 6, tier: 10, image: '/rive/daily-gifts/day7.webp' },
];

export function dayConfig(index: number): DailyBonusDay {
  return DAILY_BONUS_DAYS[index] ?? DAILY_BONUS_DAYS[0];
}

/** Week-slot status → SmallPrize/LargePrize status enum in the file. */
export const VM_STATUS = {
  claimed: 'Collected',
  today: 'Ready',
  missed: 'Off',
  future: 'NotReady',
  /** The future slot right after today ("1 day away" pin state). */
  next: '1DayAway',
} as const;

// ---------------------------------------------------------------------------
// View-model navigation. Every helper fails soft (null/false) so a renamed
// property in Rive Studio degrades to "no sync" instead of a crash.

/** Root instance bound to the artboard (needs `autoBind: true` in useRive). */
export function rootViewModel(rive: Rive | null): ViewModelInstance | null {
  if (!rive) return null;
  try {
    return rive.viewModelInstance;
  } catch {
    return null;
  }
}

/** Nested view-model child, or null. */
export function childVm(inst: ViewModelInstance | null, name: string): ViewModelInstance | null {
  if (!inst) return null;
  try {
    return inst.viewModel(name);
  } catch {
    return null;
  }
}

/** `index`-th element of a view-model list, or null. */
export function listItem(inst: ViewModelInstance | null, list: string, index: number): ViewModelInstance | null {
  if (!inst) return null;
  try {
    return inst.list(list)?.instanceAt(index) ?? null;
  } catch {
    return null;
  }
}

export function setVmNumber(inst: ViewModelInstance | null, name: string, value: number): boolean {
  if (!inst) return false;
  try {
    const p = inst.number(name);
    if (!p) return false;
    p.value = value;
    return true;
  } catch {
    return false;
  }
}

export function setVmString(inst: ViewModelInstance | null, name: string, value: string): boolean {
  if (!inst) return false;
  try {
    const p = inst.string(name);
    if (!p) return false;
    p.value = value;
    return true;
  } catch {
    return false;
  }
}

export function setVmEnum(inst: ViewModelInstance | null, name: string, value: string): boolean {
  if (!inst) return false;
  try {
    const p = inst.enum(name);
    if (!p) return false;
    p.value = value;
    return true;
  } catch {
    return false;
  }
}

export function setVmBoolean(inst: ViewModelInstance | null, name: string, value: boolean): boolean {
  if (!inst) return false;
  try {
    const p = inst.boolean(name);
    if (!p) return false;
    p.value = value;
    return true;
  } catch {
    return false;
  }
}

/** Fire a view-model trigger (host → Rive). Never fakes user taps: only call
 * with triggers the file documents as host-driven (openModal, loading*,
 * uiReady, numAnimTrigger…). */
export function fireVmTrigger(inst: ViewModelInstance | null, name: string): boolean {
  if (!inst) return false;
  try {
    const p = inst.trigger(name);
    if (!p) return false;
    p.trigger();
    return true;
  } catch {
    return false;
  }
}

/** Observe a trigger the file fires (slot taps, box tap). Returns unsubscribe. */
export function onVmTrigger(inst: ViewModelInstance | null, name: string, cb: () => void): () => void {
  if (!inst) return () => {};
  try {
    const p = inst.trigger(name);
    if (!p) return () => {};
    const handler = () => cb();
    p.on(handler);
    return () => {
      try {
        p.off(handler);
      } catch {
        // detach is best-effort on unmount.
      }
    };
  } catch {
    return () => {};
  }
}

// ---------------------------------------------------------------------------
// Images (decoded once per URL, shared by both components).

const imageCache = new Map<string, Promise<RiveImage | null>>();

export function decodedImage(url: string): Promise<RiveImage | null> {
  let p = imageCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => decodeImage(new Uint8Array(buf)))
      .catch(() => null);
    imageCache.set(url, p);
  }
  return p;
}

export function setVmImage(inst: ViewModelInstance | null, name: string, image: RiveImage | null): boolean {
  if (!inst || !image) return false;
  try {
    const p = inst.image(name);
    if (!p) return false;
    p.value = image;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Audio: Rive event name -> bundled mp3 (designer's files, public/audio).
// The file fires these as Rive events on its timelines (verified at runtime).

const AUDIO_BASE = '/audio/daily-bonus';
export const RIVE_AUDIO: Record<string, string> = {
  WZ_DB_PageSlide: '',
  WZ_DB_DayTask_Complete: '',
  WZ_DB_LootBox_Appear: `${AUDIO_BASE}/WZ_DB_LootBox_Appear.mp3`,
  WZ_DB_LootBox_PowerUp_Reveal_01: `${AUDIO_BASE}/WZ_DB_LootBox_PowerUp_Reveal_01.mp3`,
  WZ_DB_LootBox_PowerUp_Reveal_02: `${AUDIO_BASE}/WZ_DB_LootBox_PowerUp_Reveal_02.mp3`,
  WZ_DB_LootBox_PowerUp_Reveal_03: `${AUDIO_BASE}/WZ_DB_LootBox_PowerUp_Reveal_03.mp3`,
  WZ_DB_LootBox_PowerUp_Reveal_04: `${AUDIO_BASE}/WZ_DB_LootBox_PowerUp_Reveal_04.mp3`,
  WZ_DB_RevealButton_Select_Currency: `${AUDIO_BASE}/WZ_DB_RevealButton_Select_Currency.mp3`,
  WZ_DB_RevealButton_Shimmer: `${AUDIO_BASE}/WZ_DB_RevealButton_Shimmer.mp3`,
};

/** Fire-and-forget sound for a Rive event; silent when unmapped. */
export function playRiveAudio(eventName: string): void {
  const src = RIVE_AUDIO[eventName];
  if (!src) return;
  try {
    void new Audio(src).play().catch(() => {});
  } catch {
    // Audio is cosmetic; never break the claim flow.
  }
}
