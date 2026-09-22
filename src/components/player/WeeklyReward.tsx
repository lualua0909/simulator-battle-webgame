'use client';

// The 7-day (Mon..Sun) claim calendar for the daily box. Resets every Monday 00:00 (Vietnam time);
// a day left unclaimed shows as permanently missed for the rest of that week. This modal never
// claims the box itself — tapping today's cell hands off to the caller's onClaim, which opens
// <BoxOpening kind="daily"> for the actual tap-to-open animation and the server call.
import { Check, Gift, Lock, X, type LucideIcon } from 'lucide-react';
import { createElement, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { liveBoxes, type WeekSlot } from '@/shared/economy';
import type { ConfigBundle } from '@/shared/schema';
import { ChestThumb, CoinBar, countdown } from './PlayerHud';
import { usePlayer, useTick } from './PlayerProvider';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const WEEKDAY_LABEL_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_LABEL_VI = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const CELL_ICON: Record<WeekSlot['status'], LucideIcon> = { claimed: Check, missed: X, today: Gift, future: Lock };

interface Props {
  bundle: ConfigBundle;
  onClose(): void;
  onClaim(): void;
}

export default function WeeklyReward({ bundle, onClose, onClaim }: Props) {
  const { t, locale } = useLanguage();
  const CELL_LABEL: Record<WeekSlot['status'], string> =
    locale === 'vi'
      ? { claimed: 'Đã nhận', missed: 'Đã bỏ lỡ', today: 'Nhận ngay', future: 'Sắp tới' }
      : { claimed: 'Claimed', missed: 'Missed', today: 'Claim now', future: 'Upcoming' };
  const WEEKDAY_LABEL = locale === 'vi' ? WEEKDAY_LABEL_VI : WEEKDAY_LABEL_EN;
  const { player, boxes, now } = usePlayer();
  useTick(1000);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!boxes) return null;
  const status = liveBoxes(boxes, now());
  const chest = bundle.settings.economy.dailyBox.chest;

  return createPortal(
    <div className="game-ui box-backdrop fixed inset-0 z-40 flex flex-col items-center overflow-y-auto px-4 pb-6 pt-4">
      <button className="btn absolute left-3 top-3 px-3 py-1 text-xl" onClick={onClose} aria-label={t('common.close')}>
        <X />
      </button>
      <div className="absolute right-3 top-3">
        <CoinBar value={player?.coins ?? 0} />
      </div>
      <h2 className="text-outline mt-14 text-center text-3xl sm:mt-2">{t('weekly.title')}</h2>
      <ChestThumb variant={chest} wobble size={120} />
      <div className="mt-4 grid w-full max-w-lg grid-cols-7 gap-2">
        {status.daily.week.map((slot, i) => (
          <button
            key={slot.date}
            disabled={slot.status !== 'today'}
            onClick={slot.status === 'today' ? onClaim : undefined}
            className={`week-cell week-cell-${slot.status}`}
            title={CELL_LABEL[slot.status]}
          >
            <span className="text-outline text-xs">{WEEKDAY_LABEL[i]}</span>
            <span className="text-2xl leading-none">{createElement(CELL_ICON[slot.status])}</span>
          </button>
        ))}
      </div>
      <p className="text-outline mt-4 text-center">
        {status.daily.ready ? <>Hộp hôm nay hết hạn sau {countdown(status.daily.resetAt - now())}</> : <>Hộp mới sau {countdown(status.daily.resetAt - now())}</>}
      </p>
    </div>,
    document.body,
  );
}
