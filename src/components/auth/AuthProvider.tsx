'use client';

import { signOut as fbSignOut, type User } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { firebaseAuth, getFcmToken } from '@/lib/firebase';
import { PING_INTERVAL_MS, type AppUser } from '@/shared/users';
import AuthModal, { type AuthView } from './AuthModal';

type AuthCtx = {
  user: AppUser | null;
  loading: boolean;
  openAuth: (view?: AuthView) => void;
  /** Exchanges a Firebase sign-in for the server session. Throws the server's message on failure. */
  completeSignIn: (fbUser: User, displayName?: string) => Promise<AppUser>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth needs <AuthProvider>');
  return ctx;
}

async function postSession(fbUser: User, displayName?: string): Promise<AppUser> {
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: await fbUser.getIdToken(), displayName }),
  });
  const data = (await res.json().catch(() => ({}))) as { user?: AppUser; error?: string };
  if (!res.ok || !data.user) throw new Error(data.error ?? 'Đăng nhập thất bại');
  return data.user;
}

async function syncFcm(user: AppUser, ask: boolean) {
  try {
    const token = await getFcmToken(ask);
    if (token && !user.fcmTokens.includes(token)) {
      await fetch('/api/auth/fcm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    }
  } catch (e) {
    console.warn('FCM:', e);
  }
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<AuthView | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch('/api/auth/session', { cache: 'no-store' }).catch(() => null);
      let u = ((await res?.json().catch(() => null)) as { user?: AppUser | null } | null)?.user ?? null;
      // Session cookie gone but Firebase still signed in on this device: re-issue it.
      if (!u) {
        const auth = firebaseAuth();
        await auth.authStateReady();
        if (auth.currentUser) u = await postSession(auth.currentUser).catch(() => null);
      }
      if (!alive) return;
      setUser(u);
      setLoading(false);
      if (u) void syncFcm(u, false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Presence: the server stamps lastActiveAt on every ping; the CMS shows the user online for 5 minutes after it.
  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    const ping = () => void fetch('/api/auth/ping', { method: 'POST' }).catch(() => undefined);
    ping();
    const timer = setInterval(ping, PING_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [uid]);

  const completeSignIn = useCallback(async (fbUser: User, displayName?: string) => {
    let u: AppUser;
    try {
      u = await postSession(fbUser, displayName);
    } catch (e) {
      await fbSignOut(firebaseAuth());
      throw e;
    }
    setUser(u);
    void syncFcm(u, true);
    return u;
  }, []);

  const signOut = useCallback(async () => {
    await Promise.all([fbSignOut(firebaseAuth()), fetch('/api/auth/session', { method: 'DELETE' })]);
    setUser(null);
  }, []);

  const value = useMemo<AuthCtx>(() => ({ user, loading, openAuth: (v = 'signin') => setView(v), completeSignIn, signOut }), [user, loading, completeSignIn, signOut]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Opened from the game screens, so it wears the game look. */}
      {view && (
        <div className="game-ui">
          <AuthModal initialView={view} onClose={() => setView(null)} />
        </div>
      )}
    </Ctx.Provider>
  );
}
