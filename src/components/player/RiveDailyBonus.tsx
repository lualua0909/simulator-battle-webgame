'use client';

// Full-screen Rive daily-bonus calendar (twz_daily_bonus_new_v49.riv, Main /
// Main SM, WebGL2 via @rive-app/react-webgl2, autoBind). The .riv file IS the
// whole UI — React renders nothing but the canvas: it feeds the week state
// into the bound view-model tree (prizeList1 slots, meter, timer), paints the
// LB chest webps into the slots' image nodes, and reacts to the file's own
// slot-tap triggers (smallPrizeClick/largePrizeClick → server claim → prize
// reveal modal). WZ_DB_* Rive events play the designer's sounds.
//
// Verified at runtime: slot taps and closeModalPrizeClaim are the only host-
// observable outputs. The file's X/CTA/info buttons emit nothing, so Escape
// and a top-right corner tap (where the file draws its X) close the modal.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EventType, useRive } from '@rive-app/react-webgl2';
import { liveBoxes, type BoxReward, type BoxStatus, type WeekSlot } from '@/shared/economy';
import type { ConfigBundle } from '@/shared/schema';
import RiveBoxReveal from './RiveBoxReveal';
import {
  DAILY_ARTBOARD,
  DAILY_STATE_MACHINE,
  RIVE_DAILY_SRC,
  VM_STATUS,
  childVm,
  dayConfig,
  decodedImage,
  fireVmTrigger,
  listItem,
  onVmTrigger,
  playRiveAudio,
  rootViewModel,
  setVmBoolean,
  setVmEnum,
  setVmImage,
  setVmNumber,
  setVmString,
  type RiveVMI,
} from './dailyBonusConfig';
import { usePlayer, useTick } from './PlayerProvider';

interface Props {
  bundle: ConfigBundle;
  thumbs: Record<string, string>;
  onClose(): void;
}

interface RevealState {
  tier: number;
  reward: BoxReward;
}

function hms(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${String(h).padStart(2, '0')}:${mm}:${ss}`;
}

function riveEventName(data: unknown): string {
  if (typeof data === 'object' && data !== null && 'name' in data) {
    const n = (data as { name?: unknown }).name;
    return typeof n === 'string' ? n : '';
  }
  return '';
}

function slotStatus(slot: WeekSlot['status'], isNext: boolean): string {
  switch (slot) {
    case 'claimed':
      return VM_STATUS.claimed;
    case 'today':
      return VM_STATUS.today;
    case 'missed':
      return VM_STATUS.missed;
    default:
      return isNext ? VM_STATUS.next : VM_STATUS.future;
  }
}

export default function RiveDailyBonus({ bundle, thumbs, onClose }: Props) {
  const { boxes, now, act } = usePlayer();
  // Queue of boxes to reveal one after another (Sunday opens 3).
  const [reveals, setReveals] = useState<RevealState[]>([]);
  const reveal = reveals[0] ?? null;
  const [calHidden, setCalHidden] = useState(false);
  const [session, setSession] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useTick(1000);

  const { rive, RiveComponent, canvas: riveCanvas } = useRive({
    src: RIVE_DAILY_SRC,
    artboard: DAILY_ARTBOARD,
    stateMachines: DAILY_STATE_MACHINE,
    autoplay: true,
    autoBind: true,
    onLoad: () => setLoaded(true),
  });
  const [vmi, setVmi] = useState<RiveVMI | null>(null);
  useEffect(() => {
    setVmi(rootViewModel(rive));
  }, [rive]);

  const status: BoxStatus | null = boxes ? liveBoxes(boxes, now()) : null;
  const todayIndex = status?.daily.week.findIndex((s) => s.status === 'today') ?? -1;
  // The future slot right after today gets the file's "1 day away" skin.
  const nextIndex = todayIndex >= 0 && status?.daily.week[todayIndex + 1]?.status === 'future' ? todayIndex + 1 : -1;

  const statusRef = useRef(status);
  statusRef.current = status;
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const claimingRef = useRef(false);
  const pendingClaimRef = useRef(false);
  const openedRef = useRef(false);
  const lastReadyRef = useRef<boolean | null>(null);

  const prizeListOf = (root: RiveVMI | null): RiveVMI | null => childVm(childVm(root, 'allPrizeList'), 'prizeList1');
  const smallSlot = (root: RiveVMI | null, i: number): RiveVMI | null => listItem(prizeListOf(root), 'prize1to6List', i);
  const largeSlot = (root: RiveVMI | null): RiveVMI | null => listItem(prizeListOf(root), 'prize7List', 0);

  // Images + open animation, once per session (art never changes mid-week).
  useEffect(() => {
    if (!vmi) return;
    let cancelled = false;
    openedRef.current = false;
    void (async () => {
      for (let i = 0; i < 6; i++) {
        const slot = smallSlot(vmi, i);
        fireVmTrigger(slot, 'loadingStart');
        // Slots 1 and 3 default to isLootbox=true (embedded art path), which
        // hides the custom image — force the giftbox path on every slot.
        setVmBoolean(slot, 'isLootbox', false);
        const img = await decodedImage(dayConfig(i).image);
        if (cancelled) return;
        setVmImage(slot, 'smallPrizeImage', img);
        fireVmTrigger(slot, 'loadingFinish');
      }
      const large = largeSlot(vmi);
      fireVmTrigger(large, 'loadingStart');
      setVmBoolean(large, 'isLootbox1', false);
      setVmBoolean(large, 'isLootbox2', false);
      setVmBoolean(large, 'isLootbox3', false);
      const img7 = await decodedImage(dayConfig(6).image);
      if (cancelled) return;
      setVmImage(large, 'largePrize1Image', img7);
      fireVmTrigger(large, 'loadingFinish');
      openedRef.current = true;
      fireVmTrigger(vmi, 'openModal');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vmi, session]);

  // Server state → file, every tick (idempotent; catches midnight rollover).
  useEffect(() => {
    if (!vmi || !status) return;
    const week = status.daily.week;
    for (let i = 0; i < 6; i++) {
      const slot = smallSlot(vmi, i);
      setVmNumber(slot, 'prizeIndex', i + 1);
      setVmNumber(slot, 'tierNum', dayConfig(i).tier);
      setVmEnum(slot, 'smallPrizeStatus', slotStatus(week[i]?.status ?? 'future', i === nextIndex));
    }
    const large = largeSlot(vmi);
    setVmNumber(large, 'tierNum', dayConfig(6).tier);
    setVmEnum(large, 'largePrizeStatus', slotStatus(week[6]?.status ?? 'future', false));
    const claimed = week.filter((s) => s.status === 'claimed').length;
    const meter = childVm(vmi, 'meter');
    setVmNumber(meter, 'meterRound', 1);
    setVmNumber(meter, 'completedDay', claimed);
    setVmNumber(meter, 'meterValue', claimed / Math.max(1, week.length));
    setVmString(childVm(vmi, 'timer'), 'time', hms(status.daily.resetAt - now()));
    // Triggers replay their animation on every fire, so only fire on change.
    if (lastReadyRef.current !== status.daily.ready) {
      lastReadyRef.current = status.daily.ready;
      fireVmTrigger(vmi, status.daily.ready ? 'uiReady' : 'uiNotReady');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vmi, status, session]);

  // Slot taps from the file → server claim → reveal modal.
  useEffect(() => {
    if (!vmi) return;
    const cleanups: Array<() => void> = [];
    const claim = (index: number) => {
      const s = statusRef.current;
      if (!s?.daily.ready || s.daily.week[index]?.status !== 'today' || claimingRef.current) return;
      claimingRef.current = true;
      pendingClaimRef.current = true;
      void act({ action: 'open-box', kind: 'daily' })
        .then(({ reward }) => {
          pendingClaimRef.current = false;
          if (reward) {
            // Sunday: regular day-1 boxes first, the premium day-7 box last.
            const boxes = reward.boxes ?? [reward];
            setReveals(boxes.map((r, i) => ({ tier: i === boxes.length - 1 ? dayConfig(index).tier : dayConfig(0).tier, reward: r })));
            setCalHidden(true);
          }
        })
        .catch((err: unknown) => {
          pendingClaimRef.current = false;
          // eslint-disable-next-line no-console
          console.warn('[daily-bonus] open-box refused:', err instanceof Error ? err.message : err);
        })
        .finally(() => {
          claimingRef.current = false;
        });
    };
    for (let i = 0; i < 6; i++) {
      const slot = smallSlot(vmi, i);
      if (slot) cleanups.push(onVmTrigger(slot, 'smallPrizeClick', () => claim(i)));
    }
    const large = largeSlot(vmi);
    if (large) cleanups.push(onVmTrigger(large, 'largePrizeClick', () => claim(6)));
    // The file's X / CTA may report through these triggers; close if they fire.
    for (const name of ['closeModal', 'ctaClose']) {
      cleanups.push(
        onVmTrigger(vmi, name, () => {
          if (!pendingClaimRef.current && !revealRef.current) closeRef.current();
        }),
      );
    }
    // The file yields to the prize claim alongside a slot tap: hide the
    // calendar; the reveal overlay (or the un-hide on failure) takes over.
    cleanups.push(
      onVmTrigger(vmi, 'closeModalPrizeClaim', () => {
        if (pendingClaimRef.current || revealRef.current) setCalHidden(true);
      }),
    );
    return () => {
      cleanups.forEach((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vmi, session]);

  // Audio cues from the file's timelines.
  useEffect(() => {
    if (!rive) return;
    const seen = new Set<string>();
    const onEvent = (e: { data?: unknown }) => {
      const name = riveEventName(e.data);
      if (!name) return;
      if (!seen.has(name)) {
        seen.add(name);
        // eslint-disable-next-line no-console
        console.info('[daily-bonus] Rive event:', name);
      }
      playRiveAudio(name);
    };
    rive.on(EventType.RiveEvent, onEvent);
    return () => {
      rive.off(EventType.RiveEvent, onEvent);
    };
  }, [rive]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !revealRef.current) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Fallback: the file's own X emits nothing observable, so a tap where the
  // file draws its X (top-right corner) closes from the host side. NOTE: never
  // pass ref= to RiveComponent — it would overwrite the hook's internal canvas
  // ref and the Rive instance would never be created (black screen).
  const onCanvasTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (revealRef.current) return;
    const el = riveCanvas;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Map into artboard space (default Fit.Contain, centered) — the canvas is
    // full-screen, so canvas fractions miss the artboard's own corner.
    const ab = rive?.bounds;
    const aw = ab ? ab.maxX - ab.minX : rect.width;
    const ah = ab ? ab.maxY - ab.minY : rect.height;
    const scale = Math.min(rect.width / Math.max(1, aw), rect.height / Math.max(1, ah));
    const left = rect.left + (rect.width - aw * scale) / 2;
    const top = rect.top + (rect.height - ah * scale) / 2;
    const x = (e.clientX - left) / Math.max(1, aw * scale);
    const y = (e.clientY - top) / Math.max(1, ah * scale);
    if (x > 0.75 && x <= 1 && y >= 0 && y < 0.15) closeRef.current();
  };

  // Frame the canvas to the artboard's aspect so the glass card hugs the calendar.
  const ab = rive?.bounds;
  const artW = ab ? Math.max(1, ab.maxX - ab.minX) : 9;
  const artH = ab ? Math.max(1, ab.maxY - ab.minY) : 16;

  if (!boxes || !status) return null;

  const closeReveal = () => {
    if (reveals.length > 1) {
      setReveals((q) => q.slice(1));
      return;
    }
    setReveals([]);
    setCalHidden(false);
    setSession((s) => s + 1);
  };

  return createPortal(
    <div className="game-ui fixed inset-0 z-40 bg-black/40 backdrop-blur-md">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-outline animate-pulse text-xl">…</span>
        </div>
      )}
      <div className={calHidden ? 'hidden' : 'flex h-full w-full items-center justify-center p-4'}>
        <div className="max-h-full max-w-full" style={{ aspectRatio: `${artW} / ${artH}`, height: `min(100%, calc((100vw - 2rem) * ${artH} / ${artW}))` }}>
          <RiveComponent onPointerDown={onCanvasTap} className="h-full w-full" />
        </div>
      </div>
      {reveal && <RiveBoxReveal key={reveals.length} bundle={bundle} thumbs={thumbs} tier={reveal.tier} reward={reveal.reward} onClose={closeReveal} />}
    </div>,
    document.body,
  );
}
