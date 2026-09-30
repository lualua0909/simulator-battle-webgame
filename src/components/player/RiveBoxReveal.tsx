'use client';

// Prize-reveal modal (box_prize_reveal_modal_v25.riv, "Box Prize Reveal Modal" /
// "Box Prize Reveal Modal SM", WebGL2 via @rive-app/react-webgl2, autoBind).
// The .riv file IS the whole UI — React renders nothing but the canvas: the
// already-rolled server reward is fed into boxPrize1..6 (coins as the currency
// slot, unit cards with the game's own thumbnails), then openModal plays the
// reveal. The end of the sequence (boxOut), the CTA or Escape closes.
//
// Verified at runtime: tierNum selects the chest (6 = LB 0 … 10), numOfPrize
// sets the visible slot count, openModal starts the sequence, and the first chest
// tap (root boxClick) is what opens the chest and plays the prize reveals.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EventType, useRive } from '@rive-app/react-webgl2';
import type { BoxReward } from '@/shared/economy';
import type { ConfigBundle } from '@/shared/schema';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import {
  BOX_REVEAL_ARTBOARD,
  BOX_REVEAL_STATE_MACHINE,
  RIVE_BOX_REVEAL_SRC,
  childVm,
  decodedImage,
  fireVmTrigger,
  onVmTrigger,
  playRiveAudio,
  rootViewModel,
  setVmBoolean,
  setVmImage,
  setVmNumber,
  setVmString,
  type RiveVMI,
} from './dailyBonusConfig';

interface Props {
  bundle: ConfigBundle;
  thumbs: Record<string, string>;
  /** 6 (base) … 10 (rarest): selects the chest inside the Rive modal. */
  tier: number;
  /** Server-rolled daily reward to present. */
  reward: BoxReward;
  /** Accessible name of the dialog. */
  label?: string;
  onClose(): void;
}

function riveEventName(data: unknown): string {
  if (typeof data === 'object' && data !== null && 'name' in data) {
    const n = (data as { name?: unknown }).name;
    return typeof n === 'string' ? n : '';
  }
  return '';
}

const MAX_SLOTS = 6;
const THUMB_WAIT_MS = 4000;
const BOX_OUT_CLOSE_MS = 700;

export default function RiveBoxReveal({ bundle, thumbs, tier, reward, label, onClose }: Props) {
  const { locale, unitName } = useLanguage();
  const [loaded, setLoaded] = useState(false);
  const { rive, RiveComponent } = useRive({
    src: RIVE_BOX_REVEAL_SRC,
    artboard: BOX_REVEAL_ARTBOARD,
    stateMachines: BOX_REVEAL_STATE_MACHINE,
    autoplay: true,
    autoBind: true,
    onLoad: () => setLoaded(true),
  });
  const [vmi, setVmi] = useState<RiveVMI | null>(null);
  useEffect(() => {
    setVmi(rootViewModel(rive));
  }, [rive]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const openedRef = useRef(false);

  // Portraits render async (seconds on a first visit) and usually land after the reward: hold the
  // chest closed until every card has its art, but never longer than THUMB_WAIT_MS.
  const [thumbWaitOver, setThumbWaitOver] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setThumbWaitOver(true), THUMB_WAIT_MS);
    return () => clearTimeout(t);
  }, []);

  // Reward data → file, then open. Idempotent: re-runs as thumbnails arrive (images bind live).
  useEffect(() => {
    if (!vmi) return;
    let cancelled = false;
    void (async () => {
      const units = new Map(bundle.units.map((u) => [u.id, u]));
      const cards = reward.cards.slice(0, MAX_SLOTS - 1);
      setVmNumber(vmi, 'tierNum', tier);
      setVmNumber(vmi, 'numOfPrize', 1 + cards.length);
      const coin = childVm(vmi, 'boxPrize1');
      setVmBoolean(coin, 'currencyPrize', true);
      const coinContent = childVm(coin, 'prizeContent');
      setVmNumber(coinContent, 'amount', reward.coins);
      for (let i = 0; i < cards.length; i++) {
        const slot = childVm(vmi, `boxPrize${i + 2}`);
        const unit = units.get(cards[i].unitId);
        // Non-currency slot: unit art + name + count.
        setVmBoolean(slot, 'currencyPrize', false);
        const content = childVm(slot, 'prizeContent');
        setVmBoolean(content, 'currencySwitch', false);
        setVmString(slot, 'titleText', unit ? unitName(unit.id, unit.name) : cards[i].unitId);
        setVmString(content, 'contentText', `x${cards[i].count}`);
        setVmNumber(content, 'amount', cards[i].count);
        const thumb = unit ? thumbs[unit.id] : undefined;
        if (thumb) {
          const img = await decodedImage(thumb);
          if (cancelled) return;
          setVmImage(slot, 'prizeImage', img);
        }
      }
      if (cancelled) return;
      const artReady = cards.every((c) => !units.has(c.unitId) || thumbs[c.unitId]);
      if (!openedRef.current && (artReady || thumbWaitOver)) {
        openedRef.current = true;
        fireVmTrigger(vmi, 'openModal');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vmi, tier, reward, thumbs, thumbWaitOver]);

  // CTA tap / end of sequence from the file → close. Not boxClick: that tap starts the reveal.
  useEffect(() => {
    if (!vmi) return;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanups = [
      // The sequence ends with boxOut and leaves an empty canvas: close once the chest has left.
      onVmTrigger(vmi, 'boxOut', () => {
        closeTimer = setTimeout(() => closeRef.current(), BOX_OUT_CLOSE_MS);
      }),
      onVmTrigger(childVm(vmi, 'cta'), 'ctaClick', () => closeRef.current()),
    ];
    return () => {
      clearTimeout(closeTimer);
      cleanups.forEach((fn) => fn());
    };
  }, [vmi]);

  // Audio cues from the file's timelines.
  useEffect(() => {
    if (!rive) return;
    const onEvent = (e: { data?: unknown }) => {
      const name = riveEventName(e.data);
      if (name) playRiveAudio(name);
    };
    rive.on(EventType.RiveEvent, onEvent);
    return () => {
      rive.off(EventType.RiveEvent, onEvent);
    };
  }, [rive]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <div className="game-ui fixed inset-0 z-50 bg-black/60" role="dialog" aria-label={label ?? (locale === 'vi' ? 'Hộp quà hằng ngày' : 'Daily gift box')}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-outline animate-pulse text-xl">…</span>
        </div>
      )}
      <RiveComponent className="h-full w-full" />
    </div>,
    document.body,
  );
}
