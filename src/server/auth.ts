// Admin session: password from env, HMAC-signed expiring cookie.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'sb_admin';
export const SESSION_MAX_AGE = 7 * 24 * 3600;

/** null = admin disabled (production without ADMIN_PASSWORD). */
export function adminPassword(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (pw) return pw;
  return process.env.NODE_ENV === 'production' ? null : 'admin';
}

export function usingDefaultPassword(): boolean {
  return !process.env.ADMIN_PASSWORD && process.env.NODE_ENV !== 'production';
}

function secret(): string {
  return process.env.SESSION_SECRET || createHash('sha256').update(`sb-session:${adminPassword() ?? ''}`).digest('hex');
}

function sign(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

export function checkPassword(input: string): boolean {
  const pw = adminPassword();
  if (!pw) return false;
  const a = createHash('sha256').update(input).digest();
  const b = createHash('sha256').update(pw).digest();
  return timingSafeEqual(a, b);
}

export function createSession(): string {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_MAX_AGE);
  return `${exp}.${sign(exp)}`;
}

export function verifySession(token: string | undefined | null): boolean {
  if (!token || !adminPassword()) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(exp));
  const got = Buffer.from(sig);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const attempts = new Map<string, { count: number; resetAt: number }>();

/** 8 login attempts per minute per client key. */
export function allowLoginAttempt(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= 8;
}
