'use client';

import { ArrowLeft, X } from 'lucide-react';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, updateProfile } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { authErrorMessage, firebaseAuth, googleProvider } from '@/lib/firebase';
import type { AppUser } from '@/shared/users';
import { useAuth } from './AuthProvider';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export type AuthView = 'signin' | 'signup' | 'forgot';

/** Centered dialog on desktop, fullscreen sheet below `sm`. Without onClose it cannot be dismissed. */
export default function AuthModal({ initialView = 'signin', onClose, onSignedIn }: { initialView?: AuthView; onClose?: () => void; onSignedIn?: (user: AppUser) => void }) {
  const { t, locale } = useLanguage();
  const TITLES: Record<AuthView, string> = { signin: t('auth.signin'), signup: t('auth.signup'), forgot: t('auth.forgot') };
  const { completeSignIn } = useAuth();
  const [view, setView] = useState<AuthView>(initialView);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const go = (v: AuthView) => {
    setView(v);
    setError(null);
    setNotice(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const done = (user: AppUser) => {
    onSignedIn?.(user);
    onClose?.();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const auth = firebaseAuth();
    if (view === 'signin') {
      void run(async () => {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        done(await completeSignIn(cred.user));
      });
    } else if (view === 'signup') {
      if (password !== confirm) return setError(t('auth.passwordMismatch'));
      void run(async () => {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
        done(await completeSignIn(cred.user, name.trim() || undefined));
      });
    } else {
      void run(async () => {
        await sendPasswordResetEmail(auth, email.trim());
        setNotice(t('auth.resetSent'));
      });
    }
  };

  const google = () =>
    run(async () => {
      const cred = await signInWithPopup(firebaseAuth(), googleProvider());
      done(await completeSignIn(cred.user));
    });

  return (
    <div className="fixed inset-0 z-50 flex bg-ink/60 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="auth-title" onClick={onClose}>
      <div
        className="flex h-full w-full flex-col overflow-y-auto bg-paper p-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:h-auto sm:max-h-[92vh] sm:max-w-md sm:rounded-2xl sm:border-2 sm:border-ink sm:p-6 sm:shadow-[0_6px_0_0_rgba(31,26,20,0.85)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          {view === 'forgot' && (
            <button type="button" className="rounded-lg px-2 py-1 text-lg font-bold hover:bg-white" onClick={() => go('signin')} aria-label={t('common.back')}>
              <ArrowLeft />
            </button>
          )}
          <h2 id="auth-title" className="font-display text-2xl">
            {TITLES[view]}
          </h2>
          {onClose && (
            <button type="button" className="ml-auto rounded-lg px-2 py-1 text-xl font-bold hover:bg-white" onClick={onClose} aria-label={t('common.close')}>
              <X />
            </button>
          )}
        </div>

        {view !== 'forgot' && (
          <div className="mb-4 grid grid-cols-2 rounded-xl border-2 border-ink bg-white p-1 text-sm font-bold">
            {(['signin', 'signup'] as const).map((v) => (
              <button key={v} type="button" className={`rounded-lg py-1.5 ${view === v ? 'bg-ink text-white' : ''}`} onClick={() => go(v)}>
                {TITLES[v]}
              </button>
            ))}
          </div>
        )}

        <form className="flex flex-col gap-3" onSubmit={submit}>
          {view === 'forgot' && <p className="text-sm opacity-80">{t('auth.forgot')}: {t('auth.email')}</p>}
          {view === 'signup' && (
            <label className="flex flex-col gap-1 text-sm font-bold">
              {t('auth.name')}
              <input className="field py-2 text-base" autoComplete="nickname" maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t('auth.email')}
            <input className="field py-2 text-base" type="email" required autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {view !== 'forgot' && (
            <label className="flex flex-col gap-1 text-sm font-bold">
              <span className="flex items-center">
                {t('auth.password')}
                {view === 'signin' && (
                  <button type="button" className="ml-auto text-xs font-bold underline" onClick={() => go('forgot')}>
                    {t('auth.forgotLink')}
                  </button>
                )}
              </span>
              <input
                className="field py-2 text-base"
                type="password"
                required
                minLength={6}
                autoComplete={view === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          {view === 'signup' && (
            <label className="flex flex-col gap-1 text-sm font-bold">
              {t('auth.confirmPassword')}
              <input className="field py-2 text-base" type="password" required minLength={6} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
          )}

          {error && <p className="text-sm font-bold text-red-team">{error}</p>}
          {notice && <p className="text-sm font-bold text-green-700">{notice}</p>}

          <button className="btn btn-gold mt-1" disabled={busy}>
            {busy ? t('common.loading') : view === 'forgot' ? t('auth.resetBtn') : TITLES[view]}
          </button>
        </form>

        {view !== 'forgot' && (
          <>
            <div className="my-4 flex items-center gap-3 text-xs font-bold opacity-50">
              <span className="h-px flex-1 bg-ink" />
              {locale === 'vi' ? 'hoặc' : 'or'}
              <span className="h-px flex-1 bg-ink" />
            </div>
            <button type="button" className="btn" disabled={busy} onClick={() => void google()}>
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
              </svg>
              {t('auth.continueGoogle')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
