'use client';

// Footer "Request new unit": user tải 1 ảnh 2D + viết mô tả → POST /api/unit-requests → Firestore.
// Ảnh được thu nhỏ + nén ngay trên trình duyệt để request nhỏ gọn.
import { Check, ImagePlus, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { UNIT_REQUEST_IMAGE_MAX_CHARS, UNIT_REQUEST_IMAGE_MAX_SIDE } from '@/shared/unitRequest';

/** Thu nhỏ về cạnh dài ≤ MAX_SIDE, nén webp (Safari không encode webp → jpeg), giảm chất lượng tới khi vừa giới hạn. */
async function compressImage(file: File): Promise<string | null> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, UNIT_REQUEST_IMAGE_MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    let url = canvas.toDataURL('image/webp', q);
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', q);
    if (url.length <= UNIT_REQUEST_IMAGE_MAX_CHARS) return url;
  }
  return null;
}

export default function UnitRequestModal({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const { user, openAuth } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) return setError(t('unitRequest.errImage'));
    try {
      const url = await compressImage(file);
      if (!url) return setError(t('unitRequest.errTooBig'));
      setImage(url);
    } catch {
      setError(t('unitRequest.errImage'));
    }
  };

  const submit = async () => {
    if (!image) return setError(t('unitRequest.errNoImage'));
    if (description.trim().length < 10) return setError(t('unitRequest.errDescription'));
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/unit-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image, description }) });
      if (res.status === 401) {
        openAuth('signin');
        throw new Error(t('unitRequest.signin'));
      }
      if (res.status === 429) throw new Error(t('unitRequest.errLimit'));
      if (!res.ok) throw new Error(t('unitRequest.errSend'));
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="game-ui fixed inset-0 z-50 flex bg-ink/60 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="unit-request-title" onClick={onClose}>
      <div
        className="flex h-dvh w-full flex-col gap-3 overflow-y-auto overscroll-contain bg-paper p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] text-left text-ink sm:h-auto sm:max-h-[92vh] sm:max-w-lg sm:rounded-2xl sm:border-2 sm:border-ink sm:p-6 sm:shadow-[0_6px_0_0_rgba(31,26,20,0.85)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h2 id="unit-request-title" className="font-display min-w-0 flex-1 break-words text-2xl">
            {t('unitRequest.title')}
          </h2>
          <button type="button" className="min-h-[40px] min-w-[40px] rounded-lg px-2 py-1 text-lg font-bold hover:bg-white" onClick={onClose} aria-label={t('common.close')}>
            <X />
          </button>
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="text-5xl text-green-700"><Check /></span>
            <p className="text-lg font-bold">{t('unitRequest.sent')}</p>
            <button type="button" className="btn btn-gold px-6" onClick={onClose}>{t('common.close')}</button>
          </div>
        ) : (
          <>
            <div>
              <p className="text-sm font-bold">{t('unitRequest.exampleTitle')}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/unit-request-example.webp" alt={t('unitRequest.exampleAlt')} width={737} height={207} className="mt-1 w-full rounded-xl border-2 border-ink/20 bg-white" />
              <ul className="mt-2 list-disc pl-5 text-sm opacity-80">
                <li>{t('unitRequest.tip1')}</li>
                <li>{t('unitRequest.tip2')}</li>
                <li>{t('unitRequest.tip3')}</li>
              </ul>
            </div>

            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex min-h-32 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-ink/40 bg-white p-2 font-bold hover:border-ink"
            >
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt={t('unitRequest.previewAlt')} className="max-h-56 w-auto object-contain" />
              ) : (
                <span><ImagePlus /> {t('unitRequest.upload')}</span>
              )}
            </button>

            <label className="flex flex-col gap-1 text-sm font-bold">
              {t('unitRequest.descLabel')}
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                rows={4}
                placeholder={t('unitRequest.descPlaceholder')}
                className="rounded-xl border-2 border-ink/30 bg-white p-2 font-normal focus:border-ink focus:outline-none"
              />
            </label>

            {error && <p className="text-sm font-bold text-red-team">{error}</p>}

            {user ? (
              <button type="button" className="btn btn-gold py-3 text-lg" disabled={busy} onClick={() => void submit()}>
                {busy ? t('unitRequest.sending') : <><Send /> {t('unitRequest.submit')}</>}
              </button>
            ) : (
              <button type="button" className="btn btn-gold py-3 text-lg" onClick={() => openAuth('signin')}>
                {t('unitRequest.signin')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
