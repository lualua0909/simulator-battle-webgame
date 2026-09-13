// Firestore-backed user profiles and the Firebase session cookie.
import { cookies } from 'next/headers';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { FieldValue, Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore';
import { ROLE, USERS_COLLECTION, type AppUser, type Role } from '@/shared/users';
import { adminAuth, firestore } from './firebase';

export const SESSION_COOKIE = 'sb_session';
/** Firebase caps session cookies at 14 days. */
export const SESSION_MAX_AGE = 14 * 24 * 3600;

const users = () => firestore().collection(USERS_COLLECTION);

const millis = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : null);

export function toAppUser(snap: DocumentSnapshot): AppUser | null {
  const d = snap.data();
  if (!d) return null;
  return {
    uid: snap.id,
    email: d.email ?? null,
    displayName: d.displayName ?? null,
    photoURL: d.photoURL ?? null,
    role: ([0, 1, 2].includes(d.role) ? d.role : ROLE.user) as Role,
    providers: Array.isArray(d.providers) ? d.providers : [],
    disabled: Boolean(d.disabled),
    fcmTokens: Array.isArray(d.fcmTokens) ? d.fcmTokens : [],
    createdAt: millis(d.createdAt),
    updatedAt: millis(d.updatedAt),
    lastLoginAt: millis(d.lastLoginAt),
  };
}

/** Emails that become root on first sign-in (bootstrap), comma separated. */
function rootEmails(): string[] {
  return (process.env.FIREBASE_ROOT_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function getUser(uid: string): Promise<AppUser | null> {
  return toAppUser(await users().doc(uid).get());
}

export async function listUsers(): Promise<AppUser[]> {
  const snap = await users().orderBy('createdAt', 'desc').get();
  return snap.docs.map((d) => toAppUser(d)!);
}

/** Creates the profile on first sign-in (role 2, or 0 for FIREBASE_ROOT_EMAILS), refreshes it afterwards. */
export async function syncUserOnLogin(token: DecodedIdToken, displayName?: string): Promise<AppUser> {
  const ref = users().doc(token.uid);
  const record = await adminAuth().getUser(token.uid);
  const email = record.email?.toLowerCase() ?? null;
  const profile = {
    email,
    displayName: record.displayName || displayName || null,
    photoURL: record.photoURL ?? null,
    providers: record.providerData.map((p) => p.providerId),
    lastLoginAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  // Unverified email/password accounts could squat a root address, so only verified emails qualify.
  const isRoot = Boolean(email && record.emailVerified && rootEmails().includes(email));
  await firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) tx.update(ref, isRoot ? { ...profile, role: ROLE.root } : profile);
    else tx.set(ref, { ...profile, role: isRoot ? ROLE.root : ROLE.user, disabled: false, fcmTokens: [], createdAt: FieldValue.serverTimestamp() });
  });
  return (await getUser(token.uid))!;
}

export async function addFcmToken(uid: string, token: string): Promise<void> {
  await users().doc(uid).update({ fcmTokens: FieldValue.arrayUnion(token), updatedAt: FieldValue.serverTimestamp() });
}

export async function removeFcmTokens(uid: string, tokens: string[]): Promise<void> {
  if (tokens.length) await users().doc(uid).update({ fcmTokens: FieldValue.arrayRemove(...tokens) });
}

/** Signed-in, enabled user behind the session cookie, or null. */
export async function currentUser(): Promise<AppUser | null> {
  const jar = await cookies();
  const cookie = jar.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const decoded = await adminAuth().verifySessionCookie(cookie, true);
    const user = await getUser(decoded.uid);
    return user && !user.disabled ? user : null;
  } catch {
    return null;
  }
}
